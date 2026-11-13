#!/usr/bin/env python3
"""Render the sunset closure page and nginx config (docs/SUNSET.md).

Called by `scripts/sunset.sh render|close|purge`; stdlib only, so it runs on a
bare host. Inputs come from the environment (sunset.sh reads them from .env):

  SUNSET_HOST        public web hostname shown on the page
  SUNSET_AT          ISO instant the instance closed / closes
  SUNSET_DELETE_AT   ISO instant all data is deleted
  SUNSET_KIND        "trial" | "closure"
  SUNSET_CONTACT     address for late data requests during retention
  SUNSET_PURGED      "1" once `sunset.sh purge` has run
  SUNSET_REPO_URL    where to self-host from
  SUNSET_SRC_DIR     directory holding the *.tmpl files
  SUNSET_OUT_DIR     output directory (rendered/html/index.html, rendered/nginx.conf)

Dates are formatted here, per language and in that reader's time zone, so the
page needs no script and reads correctly with JavaScript off.
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"]
EN_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
             "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
TH_DAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"]
DE_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
             "August", "September", "Oktober", "November", "Dezember"]
DE_DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
DE_TZ = {"CET": "MEZ", "CEST": "MESZ"}


def fail(msg: str) -> None:
    print(f"render.py: {msg}", file=sys.stderr)
    sys.exit(1)


def parse_instant(name: str, raw: str) -> datetime:
    try:
        value = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        fail(f"{name}={raw!r} is not an ISO-8601 instant (e.g. 2026-12-14T12:00:00Z)")
    if value.tzinfo is None:
        fail(f"{name}={raw!r} has no time zone; append Z for UTC")
    return value.astimezone(timezone.utc)


def fmt_en(t: datetime) -> str:
    return f"{EN_DAYS[t.weekday()]}, {t.day} {EN_MONTHS[t.month - 1]} {t.year}, {t:%H:%M} UTC"


def fmt_th(t: datetime) -> str:
    b = t.astimezone(ZoneInfo("Asia/Bangkok"))
    # Thai readers expect the Buddhist-era year.
    return (f"วัน{TH_DAYS[b.weekday()]}ที่ {b.day} {TH_MONTHS[b.month - 1]} {b.year + 543} "
            f"เวลา {b:%H:%M} น. (เวลาประเทศไทย)")


def fmt_de(t: datetime) -> str:
    b = t.astimezone(ZoneInfo("Europe/Berlin"))
    tz = DE_TZ.get(b.tzname() or "", b.tzname() or "")
    return f"{DE_DAYS[b.weekday()]}, {b.day}. {DE_MONTHS[b.month - 1]} {b.year}, {b:%H:%M} Uhr ({tz})"


def keep_variant(text: str, axis: str, chosen: str) -> str:
    """Keep the <!--axis:chosen--> blocks, drop every other <!--axis:x--> block."""
    pattern = re.compile(rf"<!--{axis}:([a-z]+)-->(.*?)<!--/{axis}:\1-->", re.S)
    return pattern.sub(lambda m: m.group(2) if m.group(1) == chosen else "", text)


def main() -> None:
    env = os.environ
    host = env.get("SUNSET_HOST", "").strip()
    kind = env.get("SUNSET_KIND", "closure").strip() or "closure"
    contact = env.get("SUNSET_CONTACT", "").strip()
    repo = env.get("SUNSET_REPO_URL", "https://github.com/bejranonda/ExternalBrain").strip().rstrip("/")
    purged = env.get("SUNSET_PURGED", "") == "1"
    src = Path(env.get("SUNSET_SRC_DIR", Path(__file__).parent))
    out = Path(env.get("SUNSET_OUT_DIR", src / "rendered"))

    if not host:
        fail("SUNSET_HOST is empty (BRAIN_PUBLIC_HOSTNAME)")
    if kind not in ("trial", "closure"):
        fail(f"SUNSET_KIND={kind!r}; expected trial or closure")
    if not purged and not re.fullmatch(r"[^@\s<>\"']+@[^@\s<>\"']+\.[^@\s<>\"']+", contact):
        # During retention the page promises a way to ask for a late export.
        fail("SUNSET_CONTACT is not an email address (EMAIL_REPLY_TO / EMAIL_FROM)")
    if not repo.startswith("https://"):
        fail(f"SUNSET_REPO_URL={repo!r} must be an https URL")

    at = parse_instant("SUNSET_AT", env.get("SUNSET_AT", ""))
    delete_at = parse_instant("SUNSET_DELETE_AT", env.get("SUNSET_DELETE_AT", ""))
    if delete_at <= at:
        fail("SUNSET_DELETE_AT must be after SUNSET_AT")

    iso = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    values = {
        "HOST": host,
        "SUNSET_ISO": iso(at),
        "DELETE_ISO": iso(delete_at),
        "SUNSET_EN": fmt_en(at),
        "SUNSET_TH": fmt_th(at),
        "SUNSET_DE": fmt_de(at),
        "DELETE_EN": fmt_en(delete_at),
        "DELETE_TH": fmt_th(delete_at),
        "DELETE_DE": fmt_de(delete_at),
        "CONTACT": contact,
        "CONTACT_HREF": "mailto:" + quote(contact, safe="@.+-_"),
        "REPO_URL": repo,
        "QUICKSTART_URL": f"{repo}/blob/main/docs/QUICKSTART.md",
    }

    page = (src / "index.html.tmpl").read_text(encoding="utf-8")
    page = re.sub(r"<!--tmpl.*?-->\n?", "", page, count=1, flags=re.S)
    page = keep_variant(page, "kind", kind)
    page = keep_variant(page, "phase", "purged" if purged else "retention")
    page = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: html.escape(values[m.group(1)], quote=True), page)
    if "{{" in page or "<!--" in page:
        fail("index.html.tmpl left a placeholder or marker unrendered")

    ended = "trial at {h} ended" if kind == "trial" else "instance at {h} closed"
    deleted = "was deleted" if purged else "is deleted"
    message = (
        f"The External Brain {ended.format(h=host)} on {at:%Y-%m-%d %H:%M} UTC. "
        "This MCP server no longer answers; remove it from your client "
        "(Claude Code: claude mcp remove brain). "
        f"All account data {deleted} on {delete_at:%Y-%m-%d}. "
        f"Run your own Brain: {repo}"
    )
    body = json.dumps(
        {"jsonrpc": "2.0", "id": None, "error": {"code": -32000, "message": message}},
        ensure_ascii=True,
        separators=(",", ":"),
    )
    # The body sits inside a single-quoted nginx string, where ' ends it, $
    # starts a variable and \ escapes — none may appear.
    if any(c in body for c in "'$\\"):
        fail(f"MCP body contains a character nginx would reinterpret: {body}")
    json.loads(body)

    conf = (src / "nginx.conf.tmpl").read_text(encoding="utf-8").replace("{{MCP_JSON}}", body)
    if "{{" in conf:
        fail("nginx.conf.tmpl left a placeholder unrendered")

    (out / "html").mkdir(parents=True, exist_ok=True)
    (out / "html" / "index.html").write_text(page, encoding="utf-8")
    (out / "nginx.conf").write_text(conf, encoding="utf-8")
    (out / "mcp-body.json").write_text(body + "\n", encoding="utf-8")
    for p in (out / "html" / "index.html", out / "nginx.conf", out / "mcp-body.json"):
        p.chmod(0o644)
    print(f"rendered {out}/html/index.html, {out}/nginx.conf ({kind}, {'purged' if purged else 'retention'})")


if __name__ == "__main__":
    main()
