# Closing an instance (sunset)

How to shut an External Brain instance down without stranding the people who
use it: announce, give notice, let them take their data, remind them, close,
keep a backup for a stated period, then delete. Written for any operator — a
fork ending a hosted trial follows exactly the same steps.

The hosted trial at `brain.autobahn.bot` used this runbook: announced
2026-11-13, closed 2026-12-14 12:00 UTC, data deleted 2027-01-13 (see
`docs/HANDOFF.md`).

---

## 1. The shape of a good shutdown

| Step | Why |
|---|---|
| **Announce with a date** on every channel — email, in-app banner, and the MCP responses agents read | People connected only through an AI tool never open the web app; an email alone misses the agent, a banner alone misses the inactive user. |
| **Notice period** — 30 days is the usual standard, 14 the minimum that reads as fair | Long enough to export and move, short enough that nobody forgets. |
| **Close signups** at the announcement | New accounts on a closing service only create people to disappoint. |
| **Self-serve export** — Settings → Your data → Download (JSON + Markdown) | Without it, the operator becomes the export queue. The Markdown is the user's rules, ready for `CLAUDE.md` / `AGENTS.md`. |
| **Somewhere to go** — the repo is open source; Settings → Your data → Import loads an export into a new Brain | "We're closing" lands far better with "here is how you keep going". |
| **Reminders** at T-7 days and T-1 day | Most people act on the last reminder. |
| **Close cleanly** — answer 410 with an explanation, not a connection error | A refused connection reads as an outage; MCP clients retry and report a generic failure. 410 says *gone, on purpose*. |
| **Retain, then delete** — keep a final backup for a stated period (30 days here), then delete everything, backups included | Answers the "I missed the emails" request, then honours storage limitation (GDPR Art. 5(1)(e)). State the deletion date in every notice. |
| **Revoke third-party credentials** | LLM, email and OAuth keys outlive the server unless someone revokes them. |

---

## 2. Settings

All in `.env`; `deploy/docker-compose.yml` forwards them to web, MCP server and worker.

| Variable | Values | Effect |
|---|---|---|
| `SERVICE_SUNSET_AT` | ISO instant, e.g. `2026-12-14T12:00:00Z` | Turns the whole feature on. Unset = no change anywhere. |
| `SERVICE_SUNSET_KIND` | `trial` \| `closure` (default `closure`) | Wording only: "the trial ends" vs "the service closes". |
| `SERVICE_SUNSET_DELETE_AT` | ISO instant | When all data is deleted. Default: `SERVICE_SUNSET_AT` + 30 days. |
| `SERVICE_SUNSET_EMAILS` | `off` (default) \| `dry_run` \| `send` | Worker notice emails. `dry_run` logs each recipient without sending — always run it first. |

`EMAIL_REPLY_TO` (or `EMAIL_FROM`) becomes the contact address on the closure
page for late data requests during retention; `scripts/sunset.sh render`
refuses to run without one.

---

## 3. What users see

**From the moment `SERVICE_SUNSET_AT` is set (notice period):**

- A banner on every page with the date, a link to Settings → Your data, and the self-hosting link.
- Every MCP tool response carries a `serviceNotice` field, and the server's
  `instructions` lead with the same text, so the agent tells its user.
- Registration is closed on every path (email + password, voucher, GitHub
  first sign-in, invite sign-up). Existing accounts work as before.
- Settings → Your data: download as JSON (complete) or Markdown (rules), and
  import a JSON export (the target for people who self-host).

**Emails** — the worker job `service.sunset_notices` runs hourly (at :05) and
once at boot. Each account gets at most one email per stage:

| Stage | When | Content |
|---|---|---|
| `announce` | as soon as sending is enabled, until 7 days before | date, export, self-hosting, deletion date |
| `week` | inside the last 7 days | reminder |
| `final` | inside the last 24 hours | last call |

A send is recorded in the audit log as `service.sunset_notice.<stage>`, only
after the provider accepted it — so a crash can repeat an email, never skip
one. Addresses whose domain has no mail host (test domains, erased accounts)
are skipped. A stage that was missed (e.g. sending switched on late) is not
sent retroactively; the next stage covers it.

**After `sunset.sh close`:**

- `https://<web host>/…` — every path answers **410 Gone** with a trilingual
  page (English, Thai, German): what ended and when, how to remove the MCP
  server, the deletion date and the contact for late requests, how to run
  your own Brain.
- `https://<mcp host>/…` — every path (including `/mcp` and `/health`)
  answers 410 with a JSON-RPC error whose `message` says the same in one
  sentence, so an MCP client shows something readable.

---

## 4. `scripts/sunset.sh`

```
./scripts/sunset.sh status                      # settings, phase, what is running, latest final dump, timer
./scripts/sunset.sh render                      # render the closure page + nginx config (also done by close)
./scripts/sunset.sh close [--dry-run] [--early] # the shutdown itself
./scripts/sunset.sh reopen                      # undo close (before purge only)
./scripts/sunset.sh schedule [--print]          # one-shot systemd timer that runs close at SERVICE_SUNSET_AT
./scripts/sunset.sh unschedule
./scripts/sunset.sh purge --print               # show exactly what purge would delete
./scripts/sunset.sh purge --confirm-delete-all-data [--early]
```

**`close`** — refuses before `SERVICE_SUNSET_AT` (2 minutes of clock slack;
`--early` overrides) and does nothing if already closed. Then:

1. Final `pg_dump -Fc` to `/root/brain-backups/final-<UTC yyyymmddHHMM>.dump`,
   mode 600, checked with `pg_restore --list`. **If the dump fails, nothing is
   stopped.**
2. Renders `deploy/sunset/rendered/` (gitignored) from
   `deploy/sunset/*.tmpl` via `deploy/sunset/render.py`.
3. Records and stops every running container of the `deploy` compose project
   (by label — never another project's). Volumes are untouched.
4. Starts the closure server (`deploy/sunset/docker-compose.sunset.yml`,
   project `brain-sunset`, `nginx:1.27.5-alpine`, read-only, 32 MB) on the
   **same loopback ports** the web and MCP containers used — so the host's
   reverse proxy and TLS certificates need no change.
5. Verifies both ports answer 410. If the closure server fails to start or
   verify, it **rolls back**: stops itself and restarts what it stopped,
   judged by `/api/healthz` + `/health` answering 200 — not by container
   state (see below). If even that fails it says `ROLLBACK INCOMPLETE` and
   prints the command to run; it never claims the site is up when it is not.

Each step is logged with a timestamp to stdout and `/var/log/brain-sunset.log`.

**`reopen`** — stops the closure server and restarts the recorded containers
with the same HTTP-verified restart.

> **Docker gotcha the restart handles.** A container whose start once failed
> on a port conflict comes back from a later `docker start` *running but
> attached to no network* (seen on Docker 29.4) — `docker ps` says Up, every
> request fails. So the restart checks HTTP, and when a plain start does not
> bring the site back it recreates those services with
> `docker compose up -d --no-build --force-recreate <services>`.

**`schedule`** — writes `brain-sunset.service` + `brain-sunset.timer` to
`/etc/systemd/system` and enables the timer for `SERVICE_SUNSET_AT` (UTC).
`Persistent=false` on purpose: if the host is down at that moment, the close
does not fire on the next boot at a time nobody announced; run `close` by
hand instead. `schedule --print` shows the units without installing.

**`purge`** — deletes all user data. Refuses unless **all** of:
`--confirm-delete-all-data`; now ≥ `SERVICE_SUNSET_DELETE_AT` (`--early`
overrides); an interactive terminal (it is never for agents or timers); the
`deploy` stack already stopped; and the operator types the web hostname at
the prompt. It removes the `deploy` project's containers, volumes and
networks and every file in `/root/brain-backups/`, then re-renders the
closure page to say the data *was* deleted. It keeps the closure server,
`.env` and every other compose project, and lists (but does not delete) the
built images. Run `purge --print` first.

For a scratch rehearsal, every path is overridable: `ENV_FILE`,
`DEPLOY_PROJECT`, `DEPLOY_COMPOSE_FILE`, `DB_CONTAINER`, `SUNSET_PROJECT`,
`BACKUP_DIR`, `SUNSET_LOG`.

---

## 5. Timeline

| When | Who | What |
|---|---|---|
| T-30d | operator | Set `SERVICE_SUNSET_AT` / `_KIND` / `_DELETE_AT`, `SERVICE_SUNSET_EMAILS=dry_run`; redeploy web, mcp-server, worker. Check the banner, an MCP response, registration refused, export + import. |
| T-30d | operator | Read the worker's dry-run log (recipients, skipped domains). Set `SERVICE_SUNSET_EMAILS=send`, recreate the worker — the announcement goes out at boot. |
| T-30d | operator | `./scripts/sunset.sh close --dry-run --early`, then `./scripts/sunset.sh schedule`. |
| T-7d, T-1d | worker | Reminder emails, automatically. |
| T | timer (or operator) | `sunset.sh close`. Check `status`, open both hostnames, read `/var/log/brain-sunset.log`. |
| T … T+30d | operator | Answer late data requests from the final dump (restore into a scratch database, export, email). |
| T+30d | operator, at a terminal | `sunset.sh purge --print`, then `purge --confirm-delete-all-data`. |
| T+30d → | operator | The after-purge checklist below. |

---

## 6. After purge

- [ ] Revoke the LLM provider keys in `.env` (OpenAI, Anthropic, Gemini, embedding provider) at each provider.
- [ ] Revoke the email provider key (Resend) and remove the sending domain if nothing else uses it.
- [ ] Delete the GitHub OAuth app (`AUTH_GITHUB_ID`).
- [ ] Delete any off-host backup copies (if the `backup-replicate` profile was ever enabled) — `purge` only sees this host.
- [ ] Keep TLS renewal working **for as long as the closure page is served** — an expired certificate turns the 410 page into a browser error.
- [ ] When the page has served its purpose (a few months), stop the closure server (`docker compose -p brain-sunset -f deploy/sunset/docker-compose.sunset.yml down`), remove the nginx sites and certificates, and delete the DNS records.
- [ ] Then remove `.env` — it still holds the secrets above.
