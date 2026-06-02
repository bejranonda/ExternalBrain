# Reference: Obsidian Sync vs. Self-hosted LiveSync vs. Headless

| Feature | Obsidian Sync (paid) | Self-hosted LiveSync + this platform | Obsidian Headless (`ob`) |
|---|---|---|---|
| Real-time sync | Yes | Yes (CouchDB `_changes`) | Yes (continuous mode) |
| E2E encryption | Yes | Yes (plugin-side passphrase) | Yes (server-side E2EE option) |
| Version history | 1 yr (paid tier) | Unlimited, Git-backed, per-commit | 1 yr (uses Sync backend) |
| Mobile | iOS / Android | iOS / Android (same plugin) | N/A (server only) |
| Cost | $8–$10 / mo / user | Server cost only | $8–$10 / mo (requires Sync subscription) |
| Conflict resolution | Automatic | Automatic (CouchDB revisions) | Automatic (timestamp + merge/conflict modes) |
| Admin UI | None (per-vault settings) | Web-App dashboard, multi-project | CLI only |
| Content staging | None | **DIKW-T** pyramid: Data / Information / Knowledge / Wisdom | None |
| AI post-processing | None | Hermes Agent pipeline (stage promotion + wisdom mode) | None |
| Time-series reasoning | None | Per-project Git repo is first-class; `wisdom/` folder explains *why* things changed | None |
| GUI required | Yes (desktop app) | No (CouchDB is headless) | **No** (standalone Node.js) |
| Sync modes | Bidirectional only | Bidirectional only | Bidirectional, pull-only, mirror-remote |
| Server deployment | ❌ | ✅ Docker (CouchDB) | ✅ Docker (Node.js 22+) |
| Self-hosted | ❌ (Obsidian Cloud) | ✅ (fully self-hosted) | ❌ (Obsidian Cloud) |
| Official support | ✅ First-party | ❌ Community plugin | ✅ First-party |
| Publish integration | Desktop only | N/A | ✅ `ob publish` |

## When to use what

| Scenario | Recommendation |
|---|---|
| Full self-hosted control, no subscription | **Self-hosted LiveSync** + CouchDB |
| Server backup of existing Sync vault | **Obsidian Headless** `ob sync --mode pull-only` |
| CI/CD publishing pipeline | **Obsidian Headless** `ob publish --yes` |
| AI agent reading vault on server | **Self-hosted LiveSync** (primary) or **Headless pull-only** (secondary) |
| Desktop + mobile user sync | **Obsidian Sync** or **Self-hosted LiveSync** |
| Multi-project admin dashboard | **This platform** (Self-hosted LiveSync + Web-App) |

## External links

- Obsidian Sync: https://obsidian.md/sync
- Self-hosted LiveSync: https://github.com/vrtmrz/obsidian-livesync
- Obsidian Headless: https://github.com/obsidianmd/obsidian-headless
- Remotely Save (WebDAV fallback): https://github.com/remotely-save/remotely-save
- CouchDB: https://couchdb.apache.org/
- DIKW pyramid (background): https://en.wikipedia.org/wiki/DIKW_pyramid
