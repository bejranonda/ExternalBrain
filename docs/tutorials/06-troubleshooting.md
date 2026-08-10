# Tutorial 06 — Troubleshooting

End-user-facing issues only. If you're an operator chasing a server
problem, read [`../RUNBOOK.md`](../RUNBOOK.md) instead — that's the
production playbook.

Each section: **symptom** → **most likely cause** → **fix**. If the
first cause doesn't match, read the next.

---

## Can't sign in

**Symptom:** sign-in form rejects valid credentials, or GitHub OAuth
loops back to the form, or you see "voucher required" but didn't get
a code.

**Most likely cause:** wrong sign-in mode for your account.

The Brain has four sign-in modes; only one is active at a time:

1. **Credentials** (single admin) — a username + password configured
   in env. If your admin gave you a username + password, this is your
   path.
2. **GitHub OAuth** — sign in via GitHub. Your account must be in the
   admin's allow-list.
3. **Voucher gate** — first-time signups need a voucher code.
4. **Dev shim** — only enabled on a non-production deployment.

**Fix:**
- Ask the admin which mode is configured.
- If voucher mode and you don't have a code, ask the admin to issue
  one from `/admin/vouchers`.
- If GitHub OAuth and your account isn't in the allow-list, ask the
  admin to add your GitHub login to `ADMIN_EMAILS` (env var) or to
  set `REGISTRATION_REQUIRES_VOUCHER=false` (only for genuinely
  open-to-everyone deployments — usually a bad idea).

---

## MCP connect failed

**Symptom:** `claude mcp list` shows `brain · ✗ Failed to connect`.

**Most likely causes (in order):**

### 1. Network can't reach the Brain MCP host

```bash
curl -I https://mcp.brain.your-team.com/health
```

Expect HTTP 200. If you see DNS error, timeout, or 503, the network
between your machine and the Brain host is the problem. Try from a
different network (mobile hotspot, VPN). If it works elsewhere,
something's blocking on your local network.

### 2. Token revoked or expired

```bash
grep brain ~/.claude.json
# look at the Authorization header — that's the bp_… token
```

Visit [`/settings/tokens`](/settings/tokens) and check whether that token is in the list
and not greyed out (revoked). If it's marked expired, create a new
one and re-run the install command.

### 3. The wrong URL was installed

The installer uses the URL the operator configured. If you got the
install command from a different Brain (dev vs prod), `~/.claude.json`
points at the wrong host.

```bash
# remove the existing brain entry and re-run the install with the right URL
claude mcp remove brain --scope user
curl -fsSL https://CORRECT-HOST/api/onboard.sh | bash -s 'bp_…' --client claude-code
```

### 4. Auth-gate posture

The Brain's MCP server gates EVERY method (including `initialize`)
behind Bearer auth. If you see `Connected (no tools)` or similar
half-states, the SDK has a stale session — the Brain rejected the
post-init handshake. Restart the AI tool fully (close, reopen) so it
reconnects from scratch.

---

## Tool doesn't call the Brain

**Symptom:** Claude Code / Cursor / Windsurf is connected to the
Brain (you can see `brain ✓ Connected` in `mcp list`) but the model
never actually uses it. Sessions don't show up in the dashboard;
no Knowledge is being extracted.

**First, isolate the layer.** Open the home dashboard's
**Connection status** card and watch it while you run a quick task
in your AI tool:

| What you see in the card | Where the problem is |
|---|---|
| Token dot stays grey, "never used" | The tool isn't calling the Brain at all → continue below (SKILL.md) |
| Token dot flips green, sessions/events counters increment | Connection works; problem is downstream (e.g. Knowledge extraction) |
| Token dot flips green but Knowledge 24h stays 0 | Worker / KEA queue issue (check the KEA queue counter — non-zero + not draining = stuck) |

**Most likely cause** when the token never lights up: the SKILL.md
file isn't being read.

Claude Code only invokes the Brain if its skill file tells it to.
The installer puts SKILL.md at `~/.claude/skills/brain/SKILL.md`.
Verify:

```bash
ls -la ~/.claude/skills/brain/SKILL.md
head -20 ~/.claude/skills/brain/SKILL.md
```

If the file is missing, re-run the install command. If it's there
but the model still ignores it, the model is being terse — try
explicitly:

> *"Use the brain skill. Start a session for this task before
> proceeding, and report the outcome at the end."*

After the model does this once explicitly, it usually picks up the
pattern for the rest of the conversation.

---

## "Already exists" when running the installer

**Symptom:**

```
==> Registering Brain MCP with Claude Code (user scope)…
MCP server brain already exists in user config
```

**Cause:** you previously installed a `brain` MCP entry (maybe
pointing at a different Brain, or with an old token).

**Fix** (the installer now suggests this — copy-paste from its
output):

```bash
claude mcp remove brain --scope user
curl -fsSL https://your-brain/api/onboard.sh | bash -s 'bp_…your_token…' --client claude-code
```

If you have BOTH a dev and a prod Brain you want to keep registered:
hand-edit `~/.claude.json` and rename one of the entries' keys (e.g.
to `brain-dev`). The installer always uses the key `brain`; renaming
prevents the collision.

---

## Oracle says "no Brain context"

**Symptom:** you ask the Oracle a question; it answers with a
disclaimer "I have no Brain context for this question — answering
from general knowledge".

**This is honest, not broken.** It means your retrieval set
(Knowledge + sessions) didn't have anything semantically close to
your question. Three causes:

### 1. Your Brain is genuinely empty

The dashboard's `Active knowledge` count is 0 or near-zero. The Brain
hasn't seen enough sessions yet to extract patterns. Use the Brain
for ~10 real coding tasks; KEA will start filling the pool. Or
[teach](./03-teaching-knowledge.md) explicit rules.

### 2. The query is too generic

"How do I do auth?" matches against many things and the embedding
collapses to noise. Reframe with more specifics — language, framework,
the symptom you're solving. See [Tutorial 02](./02-asking-the-oracle.md#query-patterns-that-work)
for query patterns that actually retrieve.

### 3. Scope is set to "this project" but the relevant rules are in another project

Click the **Scope** pill at the top of the Oracle UI and switch to
"all". If the same query now returns context, the rule lives in a
different project — fork it to the active project (skills row →
**Fork to project**) so future scope-locked queries find it.

---

## Knowledge isn't being extracted from sessions

**Symptom:** sessions show up on the dashboard, but `Active knowledge`
isn't growing. Or KEA proposals never appear in `#skills` queue.

**Most likely cause:** KEA hasn't run for those sessions.

KEA runs in the background after each session ends — about 30 seconds
behind real-time. Symptoms of KEA being broken:

- Sessions show `endedAt` timestamps but no Knowledge linked to them.
- Worker container is crash-looping (operator can check via
  `docker logs deploy-worker-1`).
- pg-boss schema is out of date (operator runs
  `scripts/pgboss-version-check.sh`).

**End-user fix:** ask the operator to check the worker container.
If everything looks healthy on their side and KEA still doesn't run,
they can manually re-trigger via the worker's `kea.extract` job —
documented in `../RUNBOOK.md`.

In the meantime: explicit teach (Tutorial 03) is a workaround.

---

## Token revoked unexpectedly

**Symptom:** a token that was working yesterday now returns 401. The
token row in [`/settings/tokens`](/settings/tokens) shows it as revoked, but you don't
remember revoking it.

**Possible causes:**

1. **An admin revoked it.** Check `/admin/audit` (if you're an admin)
   or ask a current admin. Tokens can be revoked by anyone with admin
   role on the Brain — this is intentional for incident response.
2. **Org / project scope collapse.** The token was scoped to a project
   that got deleted. The schema's `Cascade` semantic on token scopes
   means scope-deletion revokes the token (audit C12 behavior since
   2026-05-06). Recreate the token with broader scope, or against a
   different project.
3. **TTL hit zero.** If you set a custom TTL on the token, check the
   `expiresAt` column. The default 90-day TTL applies otherwise.

---

## Skills surface shows no rules even though I taught some

**Symptom:** you taught 3 rules. The Skills surface ([`/#skills`](/#skills))
shows none.

**Most likely cause:** scope filter.

The Skills surface respects the active project scope by default
(rules tagged to the current project + your user scope). If you
taught a rule with `scope: project` while a different project was
active, that rule is invisible from the current project.

**Fix:** use the project picker (top-right of [`/#skills`](/#skills)) to switch
to the project the rules are tagged against, or click the scope
pill and switch to "all" temporarily.

---

## Dashboard stats are stale

**Symptom:** you finished a coding task an hour ago, but the
dashboard still shows yesterday's numbers.

**Likely cause:** browser cached or background polling failed. The
dashboard polls on focus + every 30 seconds; transient network
failures silently fall back to mock data (you'll see a small "seed"
chip at the top).

**Fix:**

1. Hard-refresh (Cmd-Shift-R / Ctrl-Shift-R).
2. If the seed chip is visible, the API is unreachable — check
   `/api/healthz` directly. If that returns ok, scope cookie or auth
   cookie expired; sign out + sign in.

---

## "Unsupported tool / model" inside Claude Code

**Symptom:** you ask Claude Code to use the brain skill, the model
responds with "I don't have access to the brain skill" or attempts to
call a tool that doesn't exist (`brain.search` instead of
`brain_retrieve_knowledge`).

**Cause:** Claude Code is calling tools by their unprefixed name; the
Brain exposes `brain_*` tools (with underscore). The model is
hallucinating.

**Fix:** start a fresh chat. The model carries tool-name confusion
across turns; a clean session usually resolves it. If it persists,
restart Claude Code entirely.

---

## Where to ask for help

- **End-user issues** that aren't covered here: ask whoever set up
  your Brain (your team admin, the operator, or the documented
  contact for your deployment).
- **Bugs** in the platform itself: file at
  https://github.com/bejranonda/ExternalBrain/issues with the
  `bug` label and as much detail as possible (browser, tool,
  steps to reproduce).
- **Sensitive issues** (security, auth weakness, data leak): see
  [`../SECURITY.md`](../SECURITY.md) for the responsible-disclosure
  contact path. Don't file public issues for these.
