# Pass 1 — Onboarding & First-Run Journey Audit

**Role:** Principal Developer Experience Engineer
**Scope:** `apps/web` + onboarding APIs — the complete first-run customer journey from a clean database.
**Baseline:** `202fe7a` (`v2.7.1`), branch `main`, 2026-08-02.

## Method & honesty statement

This is a **static audit**. This checkout has no working local gates (Node 18, no
pnpm, no `node_modules`), so nothing below was exercised against a running stack.

- ✅ **Performed:** full read of every file cited, cross-file reference checks
  (route table vs. emitted links, error keys vs. message map, env flag vs. every
  consumer), and structural verification that the App Router can/cannot resolve a
  given path.
- ⬜ **Not performed (reviewer must do):** browser run of the flows, clipboard
  behaviour on a non-TLS origin, `curl … | bash` against a live instance,
  `pnpm turbo run typecheck` on the proposed diffs.

Findings are ranked by customer impact on a **cold start**. Every diff below is
written against the exact lines in the baseline commit.

---

## Summary

| # | Severity | Finding | File |
|---|---|---|---|
| 1 | **HIGH** | Installer's closing instruction points a brand-new user at a 404 (`/skills` is a hash route, not a path) | `lib/brain/installer-templates.ts:286` |
| 2 | **HIGH** | Invite-link copy button discards the once-only link when the Clipboard API is unavailable | `app/settings/org/page.tsx:677,685` |
| 3 | **HIGH** | Voucher error copy tells the user codes are case-sensitive; they are upper-cased server-side | `app/signin/page.tsx:64` |
| 4 | **MEDIUM** | Registration self-fetches over a hardcoded `http://localhost:3000` fallback with no error handling | `app/signin/page.tsx:237,382` |
| 5 | **MEDIUM** | `/settings` and `/signup` have no page — both 404 | `app/settings/`, `app/` |
| 6 | **MEDIUM** | `curl … \| bash` executes a truncated script on a mid-transfer failure (no function wrapper) | `lib/brain/installer-templates.ts:31` |
| 7 | **MEDIUM** | Voucher field on the GitHub form is labelled "required" even when the gate is off | `app/signin/page.tsx:657-663` |
| 8 | **MEDIUM** | Oracle "copy answer" gives no visual feedback and throws on an insecure origin | `components/brain/oracle.tsx:203` |
| 9 | **LOW** | The "already exists" hint expands and prints the user's live bearer token | `lib/brain/installer-templates.ts:79` |
| 10 | **LOW** | PowerShell installer lacks the smoke-test, legacy reconcile, and install-ping the bash one has | `lib/brain/installer-templates.ts:291-371` |
| 11 | **LOW** | Invite-signup error branch parses JSON without a fallback | `app/signin/page.tsx:246` |

**Verified healthy** (no action): voucher gating logic and atomicity, registration
rate-limiting and enumeration ordering, MCP config snippet escaping, dashboard /
skills / sessions empty states.

---

## 1. Registration & voucher gating

### ✅ What is correct

The gate itself is well built, and I want to be specific about why, because these
are the parts a reviewer should *not* spend time on:

- **`REGISTRATION_REQUIRES_VOUCHER` really is a single knob.** It is read in
  exactly one place (`auth.ts:101`) and governs both the OAuth path
  (`auth.ts:283`) and the email+password path
  (`api/auth/register/route.ts:97`). Default is `true`; only the literal string
  `"false"` opens it. The docblock's claim is accurate.
- **Enumeration ordering is deliberate and right.** `register/route.ts:117-128`
  validates the voucher *before* the email-exists lookup, so an anonymous caller
  without a valid voucher can never learn whether an email is registered. The
  comment explaining this is correct.
- **Claiming is race-safe.** `claimVoucher` (`lib/brain/vouchers.ts:142-189`)
  takes a `SELECT … FOR UPDATE` row lock inside the transaction, so two
  concurrent claims on a multi-use voucher's last seat cannot both win. bcrypt is
  deliberately hashed *outside* the transaction so the ~200 ms cost doesn't hold
  the lock — a genuinely good call.
- **Both limiters are present**: 5 registrations/hour/IP, and a separate
  10 voucher-attempts/hour/IP against the code space.
- **Every failure reason has human-readable copy.** `voucher_invalid`,
  `voucher_expired`, `voucher_exhausted`, `voucher_disabled`,
  `voucher_rate_limited`, `voucher_required` all resolve in `ERROR_MESSAGES`
  (`signin/page.tsx:53-84`) and render in a `role="alert"` box. The checklist item
  "provides human-readable error messages for invalid/used vouchers" **passes** —
  with the one content bug below.

### 🔴 Finding 1 (HIGH) — voucher error copy contradicts the implementation

`ERROR_MESSAGES.voucher_invalid` tells the user "codes are **case-sensitive**".
They are not: `normalize()` (`vouchers.ts:38-40`) does `.trim().toUpperCase()`
before every lookup, in both `validateVoucher` and `claimVoucher`.

This is worse than a cosmetic error. A user who mistyped a character is told to
go re-check their capitalisation — the one thing that cannot be the cause. It
sends them down a dead end at the exact moment they are already blocked from
entering the product.

```diff
--- a/apps/web/app/signin/page.tsx
+++ b/apps/web/app/signin/page.tsx
@@ -61,7 +61,7 @@ const ERROR_MESSAGES: Record<string, string> = {
   invalid_credentials: "Wrong username or password. Check your entry and try again.",
   voucher_required:
     "A voucher code is required to sign up here. Enter yours below and try again — or ask the person who invited you (or the operator of this Brain) for one.",
-  voucher_invalid: "That voucher code isn't valid. Double-check the code with your admin — codes are case-sensitive.",
+  voucher_invalid: "That voucher code isn't valid. Check for a typo, or ask your admin to confirm the code (capitalisation and surrounding spaces don't matter).",
   voucher_expired: "That voucher code has expired. Ask your admin for a fresh one.",
```

### 🟠 Finding 7 (MEDIUM) — GitHub voucher field labelled "required" when the gate is off

The GitHub sign-in form renders the voucher input unconditionally with the label
"— required for new GitHub accounts" (`signin/page.tsx:657-663`), and the
explainer at `:764-765` likewise states new GitHub users need a voucher. But when
`REGISTRATION_REQUIRES_VOUCHER=false`, `auth.ts:283` skips the gate entirely and
the field is ignored.

An operator who deliberately opened signup still shows every visitor a
"voucher required" wall. The email path already gets this right — it gates the
whole block on `voucherRequiredForSignup` (`:454`). Apply the same condition:

```diff
--- a/apps/web/app/signin/page.tsx
+++ b/apps/web/app/signin/page.tsx
@@ -654,21 +654,23 @@ export default async function SignIn({ searchParams }: Props) {
                     Or sign in with GitHub
                   </div>
                 )}
-                <label style={{ display: "block", marginBottom: 14 }}>
-                  <span style={labelSpanStyle}>
-                    Voucher code{" "}
-                    <span style={{ textTransform: "none", letterSpacing: 0 }}>
-                      — required for new GitHub accounts
+                {voucherRequiredForSignup && (
+                  <label style={{ display: "block", marginBottom: 14 }}>
+                    <span style={labelSpanStyle}>
+                      Voucher code{" "}
+                      <span style={{ textTransform: "none", letterSpacing: 0 }}>
+                        — required for new GitHub accounts
+                      </span>
                     </span>
-                  </span>
-                  <input
-                    type="text"
-                    name="voucher"
-                    placeholder="e.g. PILOT-2026-A1B2"
-                    autoComplete="off"
-                    spellCheck={false}
-                    style={inputStyle}
-                  />
-                </label>
+                    <input
+                      type="text"
+                      name="voucher"
+                      placeholder="e.g. PILOT-2026-A1B2"
+                      autoComplete="off"
+                      spellCheck={false}
+                      style={inputStyle}
+                    />
+                  </label>
+                )}
```

The matching explainer at `:750-767` should be gated the same way.

### 🟠 Finding 4 (MEDIUM) — registration self-fetch: hardcoded fallback, no error handling

Both server actions POST to their own API over HTTP:

```
apps/web/app/signin/page.tsx:237   `${process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000"}/api/invites/signup`
apps/web/app/signin/page.tsx:382   `${…same…}/api/auth/register`
```

Three problems compound here:

1. **`NEXTAUTH_URL` is the Auth.js v4 name and is preferred over `AUTH_URL`.**
   This repo is on v5, where `AUTH_URL` is canonical (and it's `AUTH_URL` that
   `.env.example` and `docker-compose.yml` set). The v4 name being checked
   *first* means a deployment that sets both — plausible during a migration —
   silently uses the stale one.
2. **When `AUTH_URL` *is* set to the public origin, this becomes an outbound
   round-trip** through Caddy and back. It requires the container to resolve its
   own public hostname and to be allowed egress to itself. On a locked-down host
   that is exactly the kind of thing that is blocked, and registration then fails
   for every user while every other page works.
3. **There is no `try`/`catch`.** If `fetch` rejects (`ECONNREFUSED`, DNS,
   TLS), the server action throws and the user gets Next.js's generic error
   boundary — no message, no recovery path, on the account-creation step.

The robust fix is to stop self-fetching and call the handler's logic directly, but
that is a refactor. The minimum safe change is to prefer the v5 variable and
handle the failure:

```diff
--- a/apps/web/app/signin/page.tsx
+++ b/apps/web/app/signin/page.tsx
@@ -379,18 +379,25 @@
-                const res = await fetch(
-                  `${process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000"}/api/auth/register`,
-                  {
-                    method: "POST",
-                    headers: { "content-type": "application/json" },
-                    body: JSON.stringify({
-                      email,
-                      password,
-                      ...(voucher ? { voucher } : {}),
-                    }),
-                  },
-                );
+                // Loopback, not the public origin: this is the container
+                // calling its own route handler. Going out through the public
+                // hostname needs self-egress + split-horizon DNS, which a
+                // locked-down host commonly denies.
+                const selfOrigin =
+                  process.env.INTERNAL_SELF_ORIGIN ??
+                  `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
+                let res: Response;
+                try {
+                  res = await fetch(`${selfOrigin}/api/auth/register`, {
+                    method: "POST",
+                    headers: { "content-type": "application/json" },
+                    body: JSON.stringify({
+                      email,
+                      password,
+                      ...(voucher ? { voucher } : {}),
+                    }),
+                  });
+                } catch {
+                  redirect("/signin?mode=register&error=registration_failed");
+                }
```

`registration_failed` already has copy in `ERROR_MESSAGES` (`:77`), so the user
gets "Couldn't create your account. Try again, or ask the operator for help."
instead of a stack-trace page. Apply the identical change at `:236` for the
invite path.

### 🟡 Finding 11 (LOW) — invite-signup error branch parses JSON without a fallback

`signin/page.tsx:246` calls `await res.json()` on the failure path with no
`.catch()`. The registration form two hundred lines below does it correctly
(`:395` — `.catch(() => ({}))`). If `/api/invites/signup` ever returns a non-JSON
body (a 502 HTML page from Caddy, a Next.js error page), the parse throws and the
user again lands on the generic error boundary.

```diff
--- a/apps/web/app/signin/page.tsx
+++ b/apps/web/app/signin/page.tsx
@@ -244,7 +244,7 @@
                 if (!res.ok) {
-                  const data = (await res.json()) as { error?: string };
+                  const data = (await res.json().catch(() => ({}))) as { error?: string };
                   const errKey = data.error ?? "invalid_credentials";
```

---

## 2. Onboard script integrity

### ✅ What is correct

- **No hardcoded URLs in the emitted script.** Every URL interpolates from
  `publicUrlsFromEnv()` (`lib/brain/skill-template.ts:139-164`), which reads
  `AUTH_URL` / `BRAIN_PUBLIC_HOSTNAME` / `BRAIN_MCP_PUBLIC_HOSTNAME`. The
  `http://localhost:3000` fallback there is documented and only reachable when no
  hostname env is set — correct for `pnpm dev`, and it is the *route* (not the
  template) that would need to refuse in prod. See Pass 4 for whether the deploy
  actually sets these.
- **Token validation is present and strict**: `grep -qE '^bp_[A-Za-z0-9_-]{20,}$'`
  (`:51`), mirrored in PowerShell at `:311`. An empty `$1` is caught at `:46`
  with a pointer to `/settings/tokens`.
- **Failure handling is genuinely good.** `set -eu`; `claude` presence checked
  before use; the "already exists" case is detected and explained rather than
  left as a raw CLI error; a real MCP round-trip smoke test (`initialize` →
  `tools/call`) with a per-status-code cause breakdown for 401/000/502/404; the
  install-ping is explicitly best-effort (`|| true`) so it cannot fail the
  install. This is a well-above-average installer.

### 🔴 Finding 1 (HIGH) — the closing instruction sends a new user to a 404

The last thing the installer tells a successful first-run user:

```
apps/web/lib/brain/installer-templates.ts:286
  echo "    ${opts.webUrl}/skills"
```

**`/skills` is not a route.** The app's surfaces are hash routes inside a single
SPA shell: `ROUTES = ["dashboard","oracle","skills","graph","decisions","autoskill","sessions","meetings"]`
in `lib/brain/routes.ts:5-14`, driven by `location.hash` (`:48-56`). The only
page files are `app/page.tsx` (a redirect) and `app/[orgSlug]/[projectSlug]/page.tsx`
(two segments). `proxy.ts` matches `/api/:path*` only, and `next.config.ts`
declares no `rewrites`. A single-segment `/skills` therefore resolves to
`app/not-found.tsx`.

So the flow is: user installs, sees ✓ *"Brain installed and verified"*, is told to
teach Brain a fact and watch it appear at `https://…/skills` — and gets a 404 on
their first deliberate visit to the product. This is the highest-impact finding in
the pass, because it lands precisely at the moment of first success.

The correct URL is org/project-scoped, which the installer does not know. Point at
`/` and let `app/page.tsx:68-70` redirect to the active project, then deep-link the
hash:

```diff
--- a/apps/web/lib/brain/installer-templates.ts
+++ b/apps/web/lib/brain/installer-templates.ts
@@ -283,7 +283,7 @@ echo "  To prove your Brain is learning, paste this into a new Claude Code sessi
 echo
 echo "  Claude will call brain_teach_knowledge. See the fact appear at:"
-echo "    ${opts.webUrl}/skills"
+echo "    ${opts.webUrl}/#skills"
 echo "  Restart Claude Code first so the new MCP entry is picked up."
```

`/` redirects to `/<org>/<project>` preserving the fragment (fragments are
client-side and survive a 307), so `#skills` opens the Skills surface.

**Same bug, other files** — `docs/USING_BRAIN.md:134,176` and
`docs/tutorials/03-teaching-knowledge.md:35,42` also reference `/skills` as a
path. Worth a sweep; `docs/APPROACH.md:1046` already warns, in this exact repo,
that URLs frozen into copy are a regression hazard.

### 🟠 Finding 6 (MEDIUM) — a truncated download executes as a partial script

The documented invocation is `curl -fsSL … | bash -s '<token>'`. The emitted
script is a flat sequence of top-level statements, so `bash` executes each line as
it arrives. If the transfer dies mid-way — proxy timeout, flaky wifi, an
intercepting portal — bash runs the prefix that made it through and exits with no
indication that it was incomplete. The user is left with a half-configured
install that reported nothing.

The standard mitigation is to wrap the body in a function and invoke it only on
the final line, so a truncated file defines a function that is never called:

```diff
--- a/apps/web/lib/brain/installer-templates.ts
+++ b/apps/web/lib/brain/installer-templates.ts
@@ -41,8 +41,13 @@ export function bashInstaller(opts: InstallerOpts): string {
 #   bash /tmp/brain-install.sh 'bp_…'

 set -eu

+# Everything runs inside this function so a truncated download (curl | bash
+# with a dropped connection) defines the function but never reaches the
+# invocation on the last line — a partial script becomes a no-op instead of
+# a half-finished install.
+__brain_install() {
+
 TOKEN="\${1:-}"
```

…and at the very end of the template:

```diff
 echo "  Restart Claude Code first so the new MCP entry is picked up."
+
+}
+
+__brain_install "\${1:-}"
```

Note the `trap … EXIT` at `:203` still fires correctly from within a function.

### 🟡 Finding 9 (LOW) — the "already exists" hint prints the live bearer token

The remediation hint at `:74-86` is a `cat <<EOF` with an **unquoted** delimiter,
so the shell expands the body. Line 79 contains `\$TOKEN`, which the JS template
literal emits as `$TOKEN` — meaning the shell substitutes the user's real bearer
into the printed suggestion.

Given the very next line says *"Re-paste the same `bp_…` token"*, printing the
literal secret was almost certainly not the intent. It puts a live credential into
terminal scrollback and into any log or issue report the user pastes when asking
for help.

```diff
--- a/apps/web/lib/brain/installer-templates.ts
+++ b/apps/web/lib/brain/installer-templates.ts
@@ -71,7 +71,7 @@ if [ "\${ADD_RC:-0}" -ne 0 ]; then
   if printf '%s' "$ADD_OUTPUT" | grep -qi 'already exists'; then
-    cat <<EOF >&2
+    cat <<'EOF' >&2

 A 'brain' MCP server is already registered. Remove it and re-run:

   claude mcp remove brain --scope user
-  curl -fsSL ${opts.webUrl}/api/onboard.sh | bash -s '\$TOKEN'
+  curl -fsSL <WEB_URL>/api/onboard.sh | bash -s '<your bp_… token>'
```

Quoting the delimiter (`<<'EOF'`) stops **all** expansion, so `${opts.webUrl}`
must be inlined before the template renders or the heredoc left unquoted with
`\\\$TOKEN` escaped to a literal. The simplest correct form keeps `<<EOF` and
escapes only the token:

```diff
-  curl -fsSL ${opts.webUrl}/api/onboard.sh | bash -s '\$TOKEN'
+  curl -fsSL ${opts.webUrl}/api/onboard.sh | bash -s '<your bp_… token>'
```

### 🟡 Finding 10 (LOW) — Windows users get a materially weaker install

`powershellInstaller` (`:291-371`) stops after `claude mcp list`. It has **none**
of the three things the bash installer added:

| Step | bash | PowerShell |
|---|---|---|
| Token shape validation | ✅ `:51` | ✅ `:311` |
| Legacy `.claude/mcp.json` reconcile | ✅ `:136-190` | ❌ |
| MCP round-trip smoke test | ✅ `:200-238` | ❌ |
| Install ping / first session | ✅ `:248-275` | ❌ |

The comment at `:194-199` explains exactly why the smoke test matters — *"a common
silent failure: install reports success while the client can never call a tool"* —
and that reasoning applies identically on Windows. A Windows user behind a
corporate proxy gets "✓ Brain installed" and a Brain that never receives a call.
This is a parity gap to schedule, not a release blocker.

---

## 3. Zero-data state (cold start)

The checklist asks that **every** page show a guided "Get Started" CTA with
copy-pasteable MCP configuration when zero data exists. Here is what is actually
there:

| Surface | Empty state | Get-started CTA | Inline MCP snippet |
|---|---|---|---|
| `#dashboard` | ✅ `EmptyBrainCallout` (`dashboard.tsx:861`) | ✅ 4 CTAs: `/welcome`, Teach, `/settings/tokens`, `/api/onboard.sh` | ❌ links out |
| `#skills` | ✅ `skills.tsx:135-172` | ✅ Teach + `/settings/tokens` | ❌ links out |
| `#sessions` | ✅ `sessions.tsx:481-545` | ✅ Get token + view install | ❌ links out |
| `#oracle` | ⚠️ none — input is the hero | ⚠️ suggestion chips only | ❌ |
| `/settings` | ❌ **404 — no `page.tsx`** | — | — |
| `/welcome` | ✅ `WelcomeFlow` | ✅ per-client picker | ✅ **yes** |

### On the missing inline snippets — this is a design decision, not a defect

Three of the four surfaces deliberately link to `/welcome` and `/settings/tokens`
rather than inlining a config snippet. The code says so explicitly:
`empty-brain-callout.tsx:70-73` — *"the guided /welcome flow is the new primary CTA
— it teaches the product before asking the user to mint a token"* — and
`skills.tsx:145-148` records that a previous version's explainer paragraph was
removed as *"ceremony, not guidance"*.

I'd flag this as **conforming to the repo's own stated design principles**
(progressive disclosure, earned surface area) rather than as a gap to close. An
MCP snippet is useless without a minted token, so inlining one on four surfaces
would show four copies of a snippet with a placeholder where the bearer goes. The
current routing — empty state → `/welcome` → token mint → wizard with the real
token baked in — is the better journey. **Recommend: no change.**

The one place the checklist's intent is genuinely unmet is `#oracle`, which has no
empty state at all: `oracle.tsx:185-188` records that the explainer card was
dropped in "Phase R.1". On a zero-data Brain the fallback suggestion chips
(`:89-94` — *"what rules has my Brain captured so far?"*) fire an LLM call that can
only answer "nothing". That is a billed call
(`docs/MCP_TOOLS` prices `brain_ask_oracle` at $0.01–0.10) returning an empty
answer as a first impression. Worth a small guard — when knowledge count is zero,
swap the chips for the same "connect a tool" CTA the other surfaces use.

### 🟠 Finding 5 (MEDIUM) — `/settings` and `/signup` both 404

- **`/settings`** has `layout.tsx` and `error.tsx` but **no `page.tsx`**
  (verified: `app/settings/` contains only `audit/ org/ password/ projects/
  reset-knowledge/ tokens/` plus those two files). The layout renders a nav for
  children that the index itself cannot satisfy. Any user who trims the URL, or
  any doc/email that says "go to Settings", hits `not-found.tsx`.
- **`/signup`** likewise does not exist; registration lives at
  `/signin?mode=register`. `/signup` is the single most-guessed URL for account
  creation and the most likely thing to appear in an onboarding email.

Both are one-line fixes:

```diff
--- /dev/null
+++ b/apps/web/app/settings/page.tsx
@@
+import { redirect } from "next/navigation";
+
+/** `/settings` has no content of its own — Tokens is the first thing a
+ *  new user needs, and it's what the empty-state CTAs already link to. */
+export default function SettingsIndex() {
+  redirect("/settings/tokens");
+}
```

```diff
--- /dev/null
+++ b/apps/web/app/signup/page.tsx
@@
+import { redirect } from "next/navigation";
+
+/** `/signup` is the URL people guess and the one onboarding emails use.
+ *  The real form is a mode of /signin. */
+export default function SignUp() {
+  redirect("/signin?mode=register");
+}
```

---

## 4. Copy-to-clipboard mechanics

### ✅ Escaping is correct — no action

The checklist's "zero unescaped characters" requirement **passes**. Every MCP
config snippet is produced by `JSON.stringify(…, null, 2)` in
`packages/core/src/install-snippets.ts` (`:47, 180, 215, 252, 281`), so quotes and
backslashes in the URL or token are escaped by the serialiser rather than by hand.
Tokens match `bp_[A-Za-z0-9_-]+`, which is shell- and JSON-safe by construction,
so the `claude mcp add` one-liner needs no additional quoting. There is a
dedicated test file (`packages/core/src/__tests__/install-snippets.test.ts`) —
⬜ reviewer should confirm it covers the escaping path.

### 🔴 The six call sites are inconsistently hardened

`navigator.clipboard` is **`undefined` on a non-secure origin**. That is not a
corner case here: `scripts/dev-up.sh` is documented in `CLAUDE.md` as
"local/dev: no TLS", so the default self-host first run is plain HTTP. On that
origin, `navigator.clipboard?.writeText` is a no-op but
`navigator.clipboard.writeText` throws a `TypeError` synchronously.

| Site | Guard | Feedback | Verdict |
|---|---|---|---|
| `token-install-wizard.tsx:167` | ✅ `navigator.clipboard?.writeText` + fallback | ✅ "Copied" 1.5 s | **good** |
| `skills.tsx:304` | ✅ try/catch | ✅ flash + console fallback | **good** |
| `skills.tsx:781` | ✅ try/catch | ✅ flash | **good** |
| `agent-prompts-card.tsx:43` | ✅ try/catch | ✅ per-key state | **good** |
| `welcome-flow.tsx:144` | ✅ try/catch | ⚠️ **silent** on failure | Finding 12 |
| `oracle.tsx:203` | ❌ none | ❌ none | **Finding 8** |
| `settings/org/page.tsx:677,685` | ❌ none | ❌ none | **Finding 2** |

### 🔴 Finding 2 (HIGH) — the invite link is destroyed when the copy fails

This is the worst of the three, because it loses data the user cannot get back:

```tsx
// apps/web/app/settings/org/page.tsx:675-690  — flash.isLink branch,
// rendered under "Invite link (copy now — shown once)"
onClick={() => {
  void navigator.clipboard.writeText(flash.text);
  window.setTimeout(() => setFlash(null), 800);
}}
```

The `setTimeout` clears the once-only invite link **unconditionally, 800 ms
later**, regardless of whether the write succeeded. On an HTTP deployment
`navigator.clipboard` is `undefined`, so the first statement throws — and on a
secure origin where the user denies the permission prompt, `void` discards a
rejected promise. Either way the link vanishes and the admin must revoke and
re-issue the invite. Clearing the only copy of a secret on a fire-and-forget write
is the bug.

```diff
--- a/apps/web/app/settings/org/page.tsx
+++ b/apps/web/app/settings/org/page.tsx
@@ -669,26 +669,31 @@
+              {/* Only clear the once-shown link after the write actually
+                  succeeds — navigator.clipboard is undefined on a non-TLS
+                  origin, and the user can deny the permission prompt. */}
               <span
                 style={{ cursor: "pointer", textDecoration: "underline" }}
-                onClick={() => {
-                  void navigator.clipboard.writeText(flash.text);
-                  window.setTimeout(() => setFlash(null), 800);
-                }}
+                onClick={() => void copyInviteLink(flash.text)}
               >
                 {flash.text}
               </span>
               <button
-                onClick={() => {
-                  void navigator.clipboard.writeText(flash.text);
-                  window.setTimeout(() => setFlash(null), 800);
-                }}
+                onClick={() => void copyInviteLink(flash.text)}
                 style={{ ...btnStyle, marginLeft: 12, fontSize: 11 }}
               >
                 Copy
               </button>
```

with, alongside the component's other handlers:

```tsx
const copyInviteLink = async (text: string) => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
    window.setTimeout(() => setFlash(null), 800);
  } catch {
    // Keep the link on screen — it is shown exactly once. The text is
    // already selectable, so manual copy still works.
    setFlash({ ...flash!, text, isLink: true, hint: "Copy failed — select the link above manually." });
  }
};
```

### 🟠 Finding 8 (MEDIUM) — Oracle copy: no feedback, throws on insecure origin

`oracle.tsx:203` is `void navigator.clipboard.writeText(turn.answer)` with no
guard and no state change. It fails the checklist's "instant visual feedback
('Copied!')" outright — there is no `copied` state on this component at all — and
it throws on a non-TLS origin. Note `lib/brain/i18n.ts` already ships both a
`copied: "Copied"` and a `copied: "Copied!"` key, so the string exists.

```diff
--- a/apps/web/components/brain/oracle.tsx
+++ b/apps/web/components/brain/oracle.tsx
@@ -202,7 +202,13 @@
-              onCopy={() => {
-                void navigator.clipboard.writeText(turn.answer);
-              }}
+              onCopy={async () => {
+                try {
+                  if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
+                  await navigator.clipboard.writeText(turn.answer);
+                  setCopiedTurn(i);
+                  window.setTimeout(() => setCopiedTurn((c) => (c === i ? null : c)), 1500);
+                } catch {
+                  setCopiedTurn(-1); // renders "Clipboard unavailable"
+                }
+              }}
```

with `const [copiedTurn, setCopiedTurn] = useState<number | null>(null);` added to
the component and `TurnView` taking a `copied` prop to swap its button label —
the same shape `agent-prompts-card.tsx:26,43-46` already uses.

### 🟡 Finding 12 (LOW) — `/welcome` copy fails silently

`welcome-flow.tsx:147-150` catches the failure and comments *"fall back to a
select-all hint by not toggling copied state"* — but **no select-all hint is
rendered anywhere**. The user clicks Copy on the one snippet that matters most in
the guided flow, and nothing happens at all: no "Copied!", no error, no hint.
Either render the promised hint or reuse the `token-install-wizard.tsx:167`
pattern, which handles this properly.

---

## Recommended order of work

1. **Finding 1** — one character (`/skills` → `/#skills`), removes a 404 at the
   moment of first success. Sweep the docs for the same string.
2. **Finding 2** — stop destroying the once-only invite link.
3. **Finding 3** — one line of copy, unblocks a stuck user.
4. **Finding 5** — two 3-line redirect pages.
5. **Findings 4, 6, 7, 8** — before the release.
6. **Findings 9, 10, 11, 12** — schedule after.

None of these are architectural. The onboarding path is well-built; what this pass
found is a cluster of last-mile breaks — a wrong link, a wrong sentence, two
missing index pages, and three unhardened clipboard calls — all of which land on
users at their very first contact with the product.
