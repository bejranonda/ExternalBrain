# Obsidian Headless: Complete Reverse-Engineering Blueprint

**Purpose**: This document is a comprehensive specification of `obsidian-headless` (the `ob` command), Obsidian's official standalone client for Sync and Publish operations. An AI agent, DevOps engineer, or developer can use this document to deploy and automate Obsidian Sync/Publish on headless servers, Docker containers, or CI/CD pipelines without the desktop GUI.

**Source**: GitHub repository `obsidianmd/obsidian-headless`, official Obsidian Help documentation (https://obsidian.md/help/headless), npm package analysis, and community deployment patterns.

---

## 1. What Is Obsidian Headless?

Obsidian Headless is a **standalone Node.js CLI client** that provides access to Obsidian's Sync and Publish cloud services without requiring the Obsidian desktop application. It runs entirely from the terminal.

### 1.1. Key Differentiators

| Property | Obsidian CLI (`obsidian`) | Obsidian Headless (`ob`) |
|---|---|---|
| **Runtime** | IPC bridge to running Electron GUI | Standalone Node.js process |
| **GUI Required** | **Yes** | **No** |
| **Scope** | Full app control (files, search, eval, plugins, UI) | **Sync + Publish only** |
| **Installation** | Enabled in Obsidian Settings | `npm install -g obsidian-headless` |
| **Auth** | Shares GUI session | Independent `ob login` |
| **Server Deployment** | ❌ (needs display server) | ✅ (designed for headless) |
| **Continuous Mode** | ❌ | ✅ (`ob sync --continuous`) |
| **Node.js Requirement** | N/A (embedded in Electron) | Node.js 22+ |

### 1.2. What It CANNOT Do
*   Access `app.vault`, `app.metadataCache`, or `app.workspace`
*   Execute arbitrary JavaScript (`eval`)
*   Manage plugins, themes, or settings
*   Search vault content
*   Create/read/modify individual notes
*   Access the link graph, tags, or properties

**Headless is a pure data transport layer** — it moves encrypted files between your local filesystem and Obsidian's cloud servers. It does not parse, index, or understand the content.

---

## 2. Installation & Requirements

### 2.1. Prerequisites
*   **Node.js 22** or later
*   **Obsidian Sync** and/or **Obsidian Publish** subscription
*   An Obsidian account (https://obsidian.md/account)

### 2.2. Installation
```bash
npm install -g obsidian-headless
```

This installs the `ob` command globally.

### 2.3. Source Structure (from GitHub)
```
obsidian-headless/
├── cli.js              # Main entry point
├── package.json        # Dependencies & bin definition
├── pnpm-lock.yaml
├── btime/              # Native N-API addon for file birthtime
│   ├── win32-x64/      # Prebuilt .node binaries
│   ├── win32-arm64/
│   ├── win32-ia32/
│   ├── darwin-x64/
│   └── darwin-arm64/
├── CHANGELOG.md
└── README.md
```

**Note on `btime/`**: This directory contains prebuilt N-API v3 addons for preserving file creation timestamps (birthtime) when downloading from the server. On Linux, birthtime is not supported — the addon is omitted and sync works normally without it.

---

## 3. Authentication

### 3.1. Login
```bash
ob login [--email <email>] [--password <password>] [--mfa <code>]
```

*   All options are interactive when omitted — email/password are prompted, 2FA is requested automatically if enabled.
*   If already logged in, `ob login` displays account info.
*   To switch accounts, pass `--email` and/or `--password` to log in again.
*   Credentials are stored locally (typically in `~/.config/obsidian-headless/` or equivalent).

### 3.2. Logout
```bash
ob logout
```
Clears stored credentials.

### 3.3. Authentication in Docker
For automated deployments, pre-authenticate interactively once, then mount the credentials directory as a persistent volume:
```bash
# First run (interactive):
docker run -it -v obsidian-auth:/root/.config/obsidian-headless obsidian-headless ob login

# Subsequent runs (non-interactive):
docker run -v obsidian-auth:/root/.config/obsidian-headless -v /path/to/vault:/vault obsidian-headless ob sync --path /vault --continuous
```

---

## 4. Sync Commands (Complete Reference)

### 4.1. Remote Vault Management

#### `ob sync-list-remote`
List all remote vaults available to your account (including shared vaults).
```bash
ob sync-list-remote
```

#### `ob sync-create-remote`
Create a new remote vault.
```bash
ob sync-create-remote --name "Vault Name" [--encryption <standard|e2ee>] [--password <password>] [--region <region>]
```

| Parameter | Description |
|---|---|
| `--name` | Vault name (required) |
| `--encryption` | `standard` or `e2ee` (end-to-end encrypted) |
| `--password` | E2EE passphrase (required if `--encryption e2ee`) |
| `--region` | Server region for the vault |

### 4.2. Local Configuration

#### `ob sync-list-local`
List locally configured vaults and their sync paths.
```bash
ob sync-list-local
```

#### `ob sync-setup`
Set up sync between a local vault directory and a remote vault.
```bash
ob sync-setup --vault <id-or-name> [--path <local-path>] [--password <password>] [--device-name <name>] [--config-dir <name>]
```

| Parameter | Description | Default |
|---|---|---|
| `--vault` | Remote vault ID or name (required) | — |
| `--path` | Local directory path | Current directory |
| `--password` | E2EE passphrase | — |
| `--device-name` | Device name for sync | Auto-generated |
| `--config-dir` | Obsidian config directory name | `.obsidian` |

#### `ob sync-unlink`
Disconnect a vault from sync and remove stored sync credentials.
```bash
ob sync-unlink [--path <local-path>]
```

### 4.3. Sync Execution

#### `ob sync`
Run sync for a configured vault.
```bash
ob sync [--path <local-path>] [--continuous]
```

| Parameter | Description |
|---|---|
| `--path` | Local vault path (default: current directory) |
| `--continuous` | Keep running and watch for file changes (daemon mode) |

**One-time sync**: `ob sync` — downloads/uploads changes, then exits.
**Continuous sync**: `ob sync --continuous` — watches for local file changes and syncs them in real-time (equivalent to having Obsidian desktop running with Sync enabled).

#### `ob sync-status`
Show sync status and configuration for a vault.
```bash
ob sync-status [--path <local-path>]
```

### 4.4. Sync Configuration

#### `ob sync-config`
View or change sync settings for a vault.
```bash
ob sync-config [--path <local-path>] [options]
```

Run with no options to display current configuration.

| Parameter | Values | Description |
|---|---|---|
| `--mode` | `bidirectional`, `pull-only`, `mirror-remote` | Sync direction strategy |
| `--conflict-strategy` | `merge`, `conflict` | How to handle conflicts |
| `--file-types` | `image`, `audio`, `video`, `pdf`, `unsupported` | Which file types to sync |
| `--configs` | `app`, `appearance`, `appearance-data`, `hotkey`, `core-plugin`, `core-plugin-data`, `community-plugin`, `community-plugin-data` | Which settings to sync |
| `--excluded-folders` | Comma-separated folder paths | Folders to exclude from sync |
| `--device-name` | Name string | Device identifier |
| `--config-dir` | Directory name | Config directory (default: `.obsidian`) |

### 4.5. Sync Modes (Critical Architecture)

| Mode | Behavior | Use Case |
|---|---|---|
| `bidirectional` | Two-way sync: uploads local changes, downloads remote changes | Normal desktop parity |
| `pull-only` | Downloads remote changes, never uploads | Read-only server backup, AI agent consumption |
| `mirror-remote` | Makes local directory exactly match remote, deleting local-only files | Clean server replica |

**For our platform**: `pull-only` is ideal for server-side vaults that AI agents read from but shouldn't modify via Sync (modifications go through the API/filesystem and are committed to Git instead).

---

## 5. Publish Commands (Complete Reference)

### 5.1. Site Management

#### `ob publish-list-sites`
List all publish sites available to your account.
```bash
ob publish-list-sites
```

#### `ob publish-create-site`
Create a new publish site.
```bash
ob publish-create-site --slug <slug>
```

#### `ob publish-setup`
Connect a local vault to a publish site.
```bash
ob publish-setup --site <id-or-slug> [--path <local-path>]
```

#### `ob publish-unlink`
Disconnect a vault from a publish site.
```bash
ob publish-unlink [--path <local-path>]
```

### 5.2. Publishing

#### `ob publish`
Publish vault changes to a connected site.
```bash
ob publish [--path <local-path>] [--dry-run] [--yes] [--all]
```

| Parameter | Description |
|---|---|
| `--path` | Local vault path |
| `--dry-run` | Show what would be published without actually doing it |
| `--yes` | Skip confirmation prompt |
| `--all` | Include files without explicit `publish: true/false` frontmatter |

**File selection priority**:
1.  Frontmatter `publish: true/false` (highest priority)
2.  Excluded/included folders (via `publish-config`)
3.  `--all` flag for untagged files

#### `ob publish-config`
View or change publish settings.
```bash
ob publish-config [--path <local-path>] [--includes <folders>] [--excludes <folders>]
```

### 5.3. Site Options

#### `ob publish-site-options`
View or update remote site appearance and navigation settings.
```bash
ob publish-site-options [--path <local-path>] [options]
```

| Parameter | Description |
|---|---|
| `--site-name <name>` | Site display name |
| `--index-file <path>` | Homepage file path |
| `--logo <path>` | Site logo |
| `--default-theme <light\|dark>` | Default color theme |
| `--show-navigation <bool>` | Show navigation panel |
| `--show-graph <bool>` | Show graph view |
| `--show-outline <bool>` | Show outline/TOC |
| `--show-search <bool>` | Show search bar |
| `--show-backlinks <bool>` | Show backlinks section |
| `--show-hover-preview <bool>` | Show link hover previews |
| `--show-theme-toggle <bool>` | Show light/dark toggle |
| `--readable-line-length <bool>` | Limit line width |
| `--strict-line-breaks <bool>` | Strict Markdown line breaks |
| `--hide-title <bool>` | Hide page title |
| `--sliding-window <bool>` | Use sliding window navigation |
| `--nav-order <paths>` | Navigation ordering |
| `--nav-hidden <items>` | Hidden navigation items |

---

## 6. Deployment Patterns

### 6.1. Basic Server Backup (cron)
```bash
#!/bin/bash
# /etc/cron.d/obsidian-sync — Sync vault every 15 minutes
*/15 * * * * root cd /srv/vaults/my-vault && ob sync
```

### 6.2. Continuous Sync (systemd)
```ini
# /etc/systemd/system/obsidian-sync.service
[Unit]
Description=Obsidian Continuous Sync
After=network.target

[Service]
Type=simple
User=obsidian
WorkingDirectory=/srv/vaults/my-vault
ExecStart=/usr/local/bin/ob sync --continuous
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 6.3. Docker Deployment
```dockerfile
FROM node:22-slim

RUN npm install -g obsidian-headless

WORKDIR /vault

# Mount auth credentials and vault as volumes
VOLUME ["/root/.config", "/vault"]

CMD ["ob", "sync", "--continuous"]
```

```yaml
# docker-compose.yml
services:
  obsidian-sync:
    build: .
    volumes:
      - obsidian-auth:/root/.config
      - ./vaults/my-vault:/vault
    restart: unless-stopped

volumes:
  obsidian-auth:
```

### 6.4. Integration with Our Platform
```bash
#!/bin/bash
# Pull vault changes, then let our platform's watcher pick up changes
# and commit them to Git

# 1. Pull-only sync (never overwrite remote)
cd /srv/vaults/project-alpha
ob sync-config --mode pull-only
ob sync

# 2. Our watcher detects changes → commits to Git → triggers DIKW pipeline
# (This happens automatically via the backend watcher)
```

---

## 7. Integration with Cloud-Knowledge-Platform

### 7.1. Architecture Position
```
Obsidian Desktop (User's device)
        │
        │ Obsidian Sync (encrypted, proprietary protocol)
        │
        ▼
Obsidian Cloud Servers
        │
        │ ob sync --continuous --mode pull-only
        │
        ▼
Server Vault (/srv/vaults/project/)
        │
        │ File watcher (backend/app/watcher.py)
        │
        ▼
Git Commit → DIKW Pipeline → Hermes Agent
```

### 7.2. Why Not Replace LiveSync?
The current platform uses Self-hosted LiveSync (CouchDB) for sync. Obsidian Headless provides an **alternative sync path** with tradeoffs:

| Feature | Self-hosted LiveSync | Obsidian Headless |
|---|---|---|
| Self-hosted | ✅ (CouchDB) | ❌ (Obsidian cloud) |
| Cost | Server only | Sync subscription ($8-10/mo) |
| Latency | Real-time (CouchDB `_changes`) | Near-real-time (continuous mode) |
| E2EE | ✅ (plugin-side) | ✅ (server-side option) |
| Desktop dependency | ❌ | ❌ |
| Server deployment | Docker (CouchDB) | Docker (Node.js) |
| Sync modes | Bidirectional only | Bidirectional, pull-only, mirror |
| Official support | Community plugin | Official Obsidian tool |

**Recommendation**: Use Headless as a **secondary/backup sync path** or for users who prefer the official Obsidian Sync subscription. The primary sync path remains LiveSync + CouchDB for full self-hosted control.

---

## 8. External References

*   GitHub repository: https://github.com/obsidianmd/obsidian-headless
*   npm package: `obsidian-headless`
*   Official docs: https://obsidian.md/help/headless
*   Docker community wrapper: https://github.com/Belphemur/obsidian-headless-sync-docker
*   Obsidian Sync pricing: https://obsidian.md/sync
*   Obsidian Publish docs: https://obsidian.md/help/publish
