#!/usr/bin/env python3
"""Report how users have responded to the sunset notices (docs/SUNSET.md).

Called by `scripts/sunset.sh responses`; stdlib only, read-only. sunset.sh
queries the database and passes one tab-separated row per account on stdin:

  user_id  email  role  notices  first_notice  first_export  exports  mcp_last

`notices` is `stage:messageId,...` in send order; the rest may be empty.

Environment:
  SUNSET_AT              ISO instant the instance closes
  SUNSET_CONTACT         where replies to the notice go
  SUNSET_EMAIL_PROVIDER  "resend" to look up each notice's delivery status
  SUNSET_EMAIL_API_KEY   the provider key (only this process sees it)
  SUNSET_RESEND_API      override of https://api.resend.com (tests)
  SUNSET_SHOW_EMAILS     "1" prints full addresses instead of masked ones
  SUNSET_PAUSE_MS        pause between provider lookups (default 600)

Opens and clicks are deliberately not tracked (PRIVACY.md): a data download
is the response that matters, and the audit log already records it.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone

STAGES = ("announce", "week", "final")


def mask(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:3]}…@{domain}"


def parse_rows(lines: list[str]) -> list[dict]:
    rows = []
    for line in lines:
        line = line.rstrip("\n")
        if not line:
            continue
        cols = (line.split("\t") + [""] * 8)[:8]
        uid, email, role, notices, first_notice, first_export, exports, mcp_last = cols
        sent = []
        for item in filter(None, notices.split(",")):
            stage, _, mid = item.partition(":")
            sent.append((stage, mid))
        rows.append({
            "id": uid,
            "email": email,
            "role": role,
            "sent": sent,
            "first_notice": first_notice,
            "first_export": first_export,
            "exports": int(exports or 0),
            "mcp_last": mcp_last,
            # Both are "YYYY-MM-DD HH:MI" UTC, so they compare as strings.
            "mcp_since": bool(first_notice and mcp_last and mcp_last >= first_notice),
        })
    return rows


def resend_status(mid: str, key: str, base: str) -> str:
    # Resend's edge answers 403 to urllib's default User-Agent.
    headers = {"Authorization": f"Bearer {key}", "User-Agent": "external-brain-sunset/1"}
    req = urllib.request.Request(f"{base}/emails/{mid}", headers=headers)
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return json.load(res).get("last_event") or "unknown"
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt == 0:
                time.sleep(1.5)
                continue
            return f"lookup failed (HTTP {e.code})"
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            return f"lookup failed ({type(e).__name__})"
    return "lookup failed (HTTP 429)"


def main() -> int:
    rows = parse_rows(sys.stdin.readlines())
    show = os.environ.get("SUNSET_SHOW_EMAILS") == "1"
    contact = os.environ.get("SUNSET_CONTACT", "") or "the EMAIL_REPLY_TO mailbox"
    provider = os.environ.get("SUNSET_EMAIL_PROVIDER", "")
    key = os.environ.get("SUNSET_EMAIL_API_KEY", "")
    base = os.environ.get("SUNSET_RESEND_API", "https://api.resend.com").rstrip("/")
    pause = int(os.environ.get("SUNSET_PAUSE_MS", "600")) / 1000
    lookup = provider == "resend" and bool(key)

    at = datetime.fromisoformat(os.environ["SUNSET_AT"].replace("Z", "+00:00"))
    days = (at - datetime.now(timezone.utc)).total_seconds() / 86400
    when = at.astimezone(timezone.utc).strftime("%a, %d %b %Y, %H:%M UTC")
    left = f"{int(days)} days left" if days >= 1 else ("under a day left" if days > 0 else "closed")
    print(f"Sunset responses — closes {when} ({left})\n")

    per_stage: dict[str, Counter] = {s: Counter() for s in STAGES}
    for row in rows:
        row["status"] = {}
        for stage, mid in row["sent"]:
            if not lookup:
                status = "sent"
            elif not mid:
                status = "sent (no message id)"
            else:
                status = resend_status(mid, key, base)
                if pause:
                    time.sleep(pause)
            row["status"][stage] = status
            per_stage.setdefault(stage, Counter())[status] += 1

    notified = [r for r in rows if r["sent"]]
    print(f"Accounts           {len(rows)}  ({len(notified)} notified, {len(rows) - len(notified)} never notified)")
    print("\nEmail" + ("" if lookup else "  (no delivery lookup: EMAIL_PROVIDER is not resend, or no key)"))
    for stage, counts in per_stage.items():
        total = sum(counts.values())
        detail = "  ".join(f"{n} {s}" for s, n in counts.most_common())
        print(f"  {stage:<9} {total:>3} sent" + (f"   {detail}" if total else ""))

    downloaded = [r for r in notified if r["exports"]]
    mcp = [r for r in notified if r["mcp_since"]]
    print("\nSince each account's first notice")
    print(f"  downloaded their data          {len(downloaded)} of {len(notified)}")
    print(f"  used MCP (their AI was told)   {len(mcp)} of {len(notified)}")

    def addr(r: dict) -> str:
        return r["email"] if show else mask(r["email"])

    def last_status(r: dict) -> str:
        if not r["status"]:
            return "not notified"
        stage = list(r["status"])[-1]
        return f"{stage}: {r['status'][stage]}"

    print("\nPer account" + ("" if show else "  (masked; --emails shows full addresses)") + "  ✓ = after the notice")
    width = max([len(addr(r)) for r in rows] + [7])
    swidth = max([len(last_status(r)) for r in rows] + [12])
    print(f"  {'ACCOUNT':<{width}}  {'LATEST EMAIL':<{swidth}}  {'DOWNLOADED':<18}  LAST MCP USE")
    for r in rows:
        dl = r["first_export"] + (f" (×{r['exports']})" if r["exports"] > 1 else "") if r["exports"] else "—"
        tag = " [admin]" if r["role"] == "admin" else ""
        print(f"  {addr(r):<{width}}  {last_status(r):<{swidth}}  {dl:<18}  {(r['mcp_last'] + (' ✓' if r['mcp_since'] else '')) if r['mcp_last'] else 'never'}{tag}")

    bounced = [r for r in notified if any(s in ("bounced", "complained", "suppressed") for s in r["status"].values())]
    quiet = [r for r in notified if r not in bounced and not r["exports"] and not r["mcp_since"]]
    print("\nNeeds attention")
    if bounced:
        print(f"  {len(bounced)} address(es) bounced, complained or are suppressed — later reminders will not reach them:")
        for r in bounced:
            print(f"    {addr(r)}")
    if quiet:
        print(f"  {len(quiet)} account(s) were sent the email but have neither downloaded nor used MCP since;")
        print("    the T-7d and T-1d reminders go to them automatically.")
    if not bounced and not quiet:
        print("  nothing")
    print(f"\nReplies go to {contact}; this report cannot see that mailbox.")
    print("Opens and clicks are not tracked (PRIVACY.md); a download is the response that counts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
