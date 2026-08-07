# Privacy & data security

What this platform stores, what leaves it, and what protects it — stated
factually so an operator or a user can check each claim rather than trust it.

This is **not** a legal privacy policy. It is the technical substrate one would
be written on. If you run an instance that other people use, you are the data
controller and you need your own policy; this document tells you what your
software actually does.

Every claim below is backed by a test, a query, or a file reference. Where a
measure is partial, it says so — an honest gap is more useful than a reassuring
sentence.

---

## 1. What is stored

| Data | Where | Notes |
|---|---|---|
| Email, display name, avatar URL | `User` | Email is the identity key |
| Password hash | `UserCredential.passwordHash` | bcrypt cost 12. Only for email/password sign-in |
| MCP token hash | `MCPToken.tokenHash` | SHA-256. The raw token is shown once at mint and never stored |
| Coding-session records | `Session`, `SessionEvent` | The prompt you opened the session with, events, outcome, file paths |
| Extracted knowledge | `Knowledge` | Rules distilled from your sessions, plus anything you teach explicitly |
| Meeting transcripts | via `/api/meetings/extract` | Only when `MEETING_UPLOAD_ENABLED=true` (default **off**) |
| Admin action log | `AuditLog` | Append-only; see §4 |
| Reset / invite token hashes | `PasswordResetToken.tokenHash`, `OrganizationInvite.tokenHash` | SHA-256 since 2026-08-06 (`KNOWN_ISSUES §0w`) |

**Session prompts are the sensitive part.** A prompt like *"debug the auth
bug in acme-payments"* records a project name, a problem, and a point in time.
Treat the corpus as you would your shell history.

---

## 2. What leaves the instance

**This is the most important section, and the one most likely to surprise.**

Knowledge extraction, the Oracle, and meeting extraction all call a
third-party LLM. Your session content — prompts, events, outcomes, and
transcripts — is transmitted to whichever provider the configured model routes
to (`packages/core/src/llm.ts`):

| Model prefix | Provider | Endpoint |
|---|---|---|
| `claude-*` | Anthropic | `api.anthropic.com` (or `ANTHROPIC_BASE_URL`) |
| `gpt-*` | OpenAI | `api.openai.com` |
| `gemini-*` | Google | Google AI |
| `qwen*`, `glm-*` | **Alibaba (DashScope)** | `dashscope-intl.aliyuncs.com` |

Two things follow that you should decide about deliberately:

1. **`qwen`/`glm` models route to Alibaba.** The meeting-extract path defaults
   to `qwen3-coder` for cost reasons (`deploy/docker-compose.yml`). If that
   jurisdiction matters to you, set `MEETING_EXTRACT_MODEL` and `KEA_MODEL` to
   a provider you have chosen on purpose.
2. **Embeddings** are also computed by a provider (`EMBEDDING_BASE_URL`), so
   knowledge text is sent there too.

Nothing else leaves the instance. There is no telemetry, no analytics, no
crash reporting unless *you* set `SENTRY_DSN`, and no outbound call to any
service operated by this project's authors.

**To send nothing to any LLM:** set `KEA_ENABLED=false` and
`ORACLE_ENABLED=false`. Brain still stores and retrieves; it stops enriching.

---

## 3. Who can see your data

Isolation is enforced at the query layer and **proven by 9 tests** that run in
CI against a real Postgres (`apps/mcp-server/src/__tests__/cross-user-isolation.test.ts`,
gated by a `pgvector` service in `ci.yml` — added after a review found these
tests were silently skipping).

Verified behaviours:

- A token cannot read or write another user's session (`NOT_FOUND`).
- A token cannot address a project it isn't bound to (`FORBIDDEN_PROJECT`) —
  it is **rejected**, not silently narrowed.
- A project-scoped token cannot see its own owner's *other* projects, via
  `brain_session_search` or the `brain://user/recent-sessions` resource.
- Knowledge marked `visibility: "org"` (decisions) is readable by org members.
  Everything else is visible to its owner alone.

**Operators can read everything.** Anyone with database or server access can
read all knowledge and sessions. There is no end-to-end encryption and no
encryption at rest beyond what your disk provides. If you self-host for a
team, your team is trusting you personally.

---

## 4. Security measures

| Measure | Implementation | How to verify |
|---|---|---|
| MCP auth is fail-closed | Bearer required on **every** method incl. `initialize` | `./scripts/verify-lockdown.sh` |
| No public data ports | Postgres/web/MCP bind to localhost only | same script, section 6 |
| Tokens hashed at rest | SHA-256 via `hashSecret()` | `secrets-hashed-at-rest.test.ts` |
| Passwords | bcrypt cost 12, computed outside the transaction | `user-credentials.ts` |
| Secrets never logged | `writeAudit()` redacts recursively, 4 deep, on `token\|secret\|password\|apiKey\|authorization` | `packages/core/src/audit.ts` |
| Audit trail | `AuditLog` is append-only — no code path deletes a row, including the erase path | invariant 9, `docs/KNOWLEDGE.md` |
| Account enumeration | forgot-password returns a generic 200 whether or not the address exists | `forgot-password/route.ts` |
| Token capability limits | A token can be restricted to `knowledge`/`skills`/`sessions`/`oracle`; empty = unrestricted | `/settings/tokens` |
| Rate limiting | Per-IP/user ceilings on Oracle, KEA, MCP, meeting extract | `packages/core/src/rate-limit.ts` |
| TLS | Terminated by Caddy or your own nginx | `openssl s_client -connect <host>:443` |

---

## 5. Your controls

- **See everything held about you** — `/settings` surfaces knowledge, sessions
  and tokens; `GET /api/admin/gdpr/export/[userId]` produces a full export.
- **Delete knowledge** — individually in Skills, or in bulk at
  `/settings/reset-knowledge`.
- **Revoke a token** — `/settings/tokens`; takes effect immediately.
- **Erase an account** — `POST /api/admin/gdpr/erase/[userId]`, operator-run.

**Erase is a soft erase, and you should know exactly what that means.** Email
becomes `erased_<id>@deleted.local`, name and avatar are nulled, and
cascade-delete removes knowledge and sessions. The `User` row itself is
retained for referential integrity. Full physical removal needs a manual DBA
pass. This is stated in the endpoint's own header, and it is a real limitation,
not a formality.

---

## 6. Known gaps

Written down because a privacy document that lists only strengths is
marketing.

- **No encryption at rest.** Database and backups are protected by filesystem
  permissions only. A stolen disk or a leaked dump exposes everything.
- **Backups are on-host.** Nightly dumps live in a Docker volume on the same
  machine (`KNOWN_ISSUES §0s`). Off-host replication exists
  (`backup-replicate` profile) but is **opt-in and currently disabled**.
- **Erase is soft**, as described above.
- **No per-field access control.** A token with `knowledge` capability reads
  all of that user's knowledge; there is no per-rule ACL.
- **LLM providers retain data under their own terms**, not ours. Once a prompt
  is sent, this project's controls no longer apply to it.
- **Meeting transcripts are stored as submitted.** No redaction pass runs
  before extraction, so anything a participant said is persisted verbatim.

---

## 7. For operators

If real people use your instance:

1. Decide your LLM provider deliberately (§2) and tell your users which one.
2. Enable off-host backup replication, and encrypt the destination.
3. Check `/admin` → Backups periodically. A backup you have never restored is
   a hope, not a backup — the drill is in `docs/DEPLOY_CHECKLIST.md`.
4. Keep `verify-lockdown.sh` green; it is a post-deploy gate, not a one-off.
5. Remember §3: you can read everything. Say so plainly to your users.

---

*Verified against the running deployment on 2026-08-06. Where this document
and the code disagree, the code is right and this document is a bug — please
file it.*
