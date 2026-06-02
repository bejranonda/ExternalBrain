# Reverse-Engineering Obsidian: A Complete Blueprint for Local-First Knowledge Systems

**Purpose**: This document is a comprehensive, reverse-engineered specification of the Obsidian ecosystem. An AI agent or developer can use this document to understand the full stack (Desktop App → CLI → Headless → Sync/Publish), replicate Obsidian's core mechanisms for building knowledge management tools, or integrate Obsidian into agentic AI workflows.

**Source**: All information is derived from official Obsidian Help documentation (v1.12.7+), the `obsidian.d.ts` API type definitions, the `obsidianmd/obsidian-headless` GitHub repository source code (`cli.js`, `package.json`), Obsidian Developer Docs (https://docs.obsidian.md/), network protocol analysis, community plugin ecosystem research, and live testing.

---

## 1. The Core Problem Addressed

Traditional note-taking applications trap your data in proprietary formats, remote databases, and walled-garden ecosystems. If the service shuts down, your data is lost or requires complex migration.

Obsidian solves this with **radical local-first design**: your notes are plain Markdown files on your own filesystem. The application is a powerful lens over those files — providing bidirectional linking, semantic indexing, and a rich plugin ecosystem — but the files remain yours, readable by any text editor.

This architecture makes Obsidian uniquely suitable for AI-agent integration because:
1. Files can be read/written by any process (not locked in a database)
2. The semantic index (MetadataCache) can be queried via CLI
3. The plugin API allows deep integration without forking the app
4. The headless client enables server-side vault management

---

## 2. The Four Interfaces (Verified Architecture)

Obsidian exposes its functionality through four distinct interfaces, each with different capabilities, requirements, and deployment contexts:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OBSIDIAN ECOSYSTEM                           │
├─────────────┬──────────────┬──────────────────┬─────────────────────┤
│  Desktop    │  Plugin API  │  CLI (obsidian)  │ Headless (ob)       │
│  GUI App    │  (TS/JS)     │  (IPC bridge)    │ (standalone Node)   │
├─────────────┼──────────────┼──────────────────┼─────────────────────┤
│ Full GUI    │ Full app.*   │ Full app.* via   │ Sync + Publish      │
│ editor      │ access       │ IPC + eval       │ ONLY                │
│             │              │                  │                     │
│ Electron    │ Runs inside  │ Requires GUI     │ No GUI needed       │
│ + Capacitor │ Electron     │ running          │ Node.js 22+         │
│             │              │                  │                     │
│ Interactive │ Event-driven │ Request/response │ Request/response    │
│ user        │ reactive     │ scriptable       │ scriptable          │
├─────────────┼──────────────┼──────────────────┼─────────────────────┤
│ SCOPE: Everything          │ SCOPE: Everything│ SCOPE: Data         │
│ (user interaction +        │ (programmatic    │ transport only      │
│  data + plugins)           │  control)        │ (sync + publish)    │
└────────────────────────────┴──────────────────┴─────────────────────┘
```

---

## 3. Data Model: The Vault

### 3.1. Vault Structure
A vault is a directory on the filesystem. There is no database, no binary format, no lock files.

```
vault-root/
├── .obsidian/                      # Configuration (per-vault)
│   ├── app.json                    # General settings
│   ├── appearance.json             # Theme configuration
│   ├── community-plugins.json      # List of enabled community plugins
│   ├── core-plugins.json           # Core plugin toggle states
│   ├── core-plugins-migration.json # Migration flags
│   ├── hotkeys.json                # Custom keyboard shortcuts
│   ├── workspace.json              # Current layout state
│   ├── graph.json                  # Graph view settings
│   ├── bookmarks.json              # Bookmarks data
│   ├── types.json                  # Property type definitions
│   ├── plugins/                    # Community plugin installations
│   │   └── <plugin-id>/
│   │       ├── main.js             # Compiled plugin code
│   │       ├── manifest.json       # Plugin metadata + version
│   │       ├── styles.css          # Plugin-specific styles
│   │       └── data.json           # Plugin settings/persistent state
│   ├── snippets/                   # User CSS snippets
│   │   └── my-style.css
│   └── themes/                     # Installed themes
│       └── <theme-name>/
│           ├── manifest.json
│           └── theme.css
├── Templates/                      # Template files (configurable path)
├── attachments/                    # Media files (configurable path)
├── folder/
│   └── note.md                     # Plain Markdown files
└── daily/                          # Daily notes (configurable path)
    └── 2026-04-18.md
```

#### DIKW-T overlay (this platform's convention)

Stock Obsidian is stage-agnostic — a file is a file. This platform overlays the
**DIKW-T pyramid** on top of the vault so every note has a well-defined
lifecycle stage. See `docs/dikw-t.md` for the full spec.

```
vault-root/
├── inbox/       # [Data]        Raw capture — Hermes watches this
├── notes/       # [Information] Tagged + linked notes, human-authored
├── knowledge/   # [Knowledge]   Hermes output (synthesised / evergreen)
├── wisdom/      # [Wisdom + T]  Hermes wisdom mode: why things changed
├── attachments/ # Binary uploads (unchanged)
└── .obsidian/   # Per-vault config (unchanged)
```

The `.git/` repo (one per project) provides the **Time** axis: every commit is
a point-in-time snapshot of all four stages. Runtime classifier:
`backend/app/dikw.py`; summary endpoint: `/api/projects/{slug}/dikw`.

### 3.2. File Types
| Extension | Purpose |
|---|---|
| `.md` | Markdown notes (primary content) |
| `.canvas` | Obsidian Canvas (JSON-based infinite canvas) |
| `.base` | Obsidian Bases (database views, v1.12+) |
| `.css` | CSS snippets and themes |
| `.js` | Plugin code |
| `.json` | Configuration and plugin data |
| `.*` | Attachments (images, PDFs, audio, video — any file type) |

### 3.3. Note Anatomy (Markdown + Frontmatter)
```markdown
---
title: Project Alpha
date: 2026-04-18
tags:
  - project/alpha
  - status/active
aliases:
  - Alpha Project
cssclasses:
  - wide-page
publish: true
---

# Project Alpha

This note links to [[Project Beta]] and uses #inline-tags.

## Tasks
- [ ] Complete phase 1
- [x] Design review
- [-] Cancelled item

## Embedded Content
![[architecture-diagram.png]]
![[Meeting Notes#Key Decisions]]

## Block Reference
This paragraph has an ID. ^important-block

%%This is a hidden comment%%

> [!warning] Important
> This is a callout block.

```dataview
TABLE file.ctime as Created, file.tags as Tags
FROM "projects"
WHERE status = "active"
```
```

### 3.4. The MetadataCache Index (THE CROWN JEWEL)
Obsidian maintains an **in-memory, asynchronously-updated** semantic index of every file. This is the single most valuable internal system for AI integration.

**What the MetadataCache captures per file:**
```typescript
interface CachedMetadata {
    // Structural
    headings?: HeadingCache[];      // { heading: string, level: 1-6, position: Pos }
    sections?: SectionCache[];      // Top-level document blocks
    listItems?: ListItemCache[];    // List items with task status + parent

    // Relational
    links?: LinkCache[];            // [[wikilinks]] with target + display text
    embeds?: EmbedCache[];          // ![[embeds]] with target
    tags?: TagCache[];              // #inline-tags with position

    // Metadata
    frontmatter?: FrontMatterCache; // Parsed YAML key-value pairs
    frontmatterLinks?: FrontmatterLinkCache[];
    frontmatterPosition?: Pos;     // YAML block position

    // Referencing
    blocks?: Record<string, BlockCache>; // ^block-id mappings
}
```

**Global indices maintained:**
```typescript
// File → { TargetFile → LinkCount } — complete link graph
app.metadataCache.resolvedLinks: Record<string, Record<string, number>>

// File → { UnresolvedName → LinkCount } — "ghost" links to non-existent notes
app.metadataCache.unresolvedLinks: Record<string, Record<string, number>>
```

---

## 4. The CLI Interface: Turning Obsidian into a Query Server

### 4.1. Architecture
The CLI binary communicates with the running Obsidian Electron app via IPC (local sockets). It does NOT parse files independently — every command is dispatched to the application process and executed with full internal API access.

### 4.2. The `eval` Command (Root Access)
```bash
obsidian eval code="<arbitrary javascript>"
```
This is the **single most powerful** feature for reverse-engineering and automation. It executes arbitrary JavaScript inside the running Obsidian application context with full access to:
- `app.vault` — All file operations
- `app.metadataCache` — Full semantic index
- `app.workspace` — UI state and manipulation
- `app.plugins` — Plugin management
- `app.commands` — Command execution
- `require()` — Node.js module system
- `window` — Full browser/Electron APIs

### 4.3. Command Categories (80+ commands)

| Category | Commands | Capability |
|---|---|---|
| **Files** | `create`, `read`, `append`, `prepend`, `move`, `rename`, `delete`, `open`, `file`, `files`, `folder`, `folders` | Full CRUD on vault files |
| **Daily Notes** | `daily`, `daily:path`, `daily:read`, `daily:append`, `daily:prepend` | Daily note management |
| **Search** | `search`, `search:context`, `search:open` | Full-text vault search |
| **Links** | `backlinks`, `links`, `unresolved`, `orphans`, `deadends` | Link graph queries |
| **Tags** | `tags`, `tag` | Tag cloud + file resolution |
| **Properties** | `properties`, `property:set`, `property:read`, `property:remove`, `aliases` | YAML frontmatter CRUD |
| **Tasks** | `tasks`, `task` | Task listing + status updates |
| **Diff** | `diff`, `history`, `history:read`, `history:restore` | Version comparison |
| **Sync** | `sync`, `sync:status`, `sync:history`, `sync:read`, `sync:restore`, `sync:deleted` | Sync control |
| **Publish** | `publish:site`, `publish:list`, `publish:status`, `publish:add`, `publish:remove`, `publish:open` | Publish management |
| **Plugins** | `plugins`, `plugin`, `plugin:enable/disable/install/uninstall/reload`, `plugins:restrict` | Plugin lifecycle |
| **Themes** | `themes`, `theme`, `theme:set/install/uninstall`, `snippets`, `snippet:enable/disable` | Appearance control |
| **Bases** | `bases`, `base:views`, `base:create`, `base:query` | Database view queries |
| **Workspace** | `workspace`, `workspaces`, `workspace:save/load/delete`, `tabs`, `tab:open`, `recents` | UI layout |
| **Templates** | `templates`, `template:read`, `template:insert` | Template operations |
| **Dev** | `devtools`, `dev:debug`, `dev:cdp`, `dev:errors`, `dev:screenshot`, `dev:console`, `dev:css`, `dev:dom`, `dev:mobile`, `eval` | Developer/debugging |
| **Utility** | `help`, `version`, `reload`, `restart`, `vault`, `vaults`, `bookmarks`, `bookmark`, `random` | General |

---

## 5. The Headless Client: Server-Side Sync & Publish

### 5.1. Installation & Auth
```bash
npm install -g obsidian-headless    # Install
ob login                            # Authenticate
ob logout                           # Clear credentials
```

### 5.2. Sync Command Map

| Command | Purpose |
|---|---|
| `ob sync-list-remote` | List remote vaults |
| `ob sync-list-local` | List locally configured vaults |
| `ob sync-create-remote` | Create new remote vault |
| `ob sync-setup` | Connect local dir to remote vault |
| `ob sync` | One-time sync |
| `ob sync --continuous` | Daemon mode (watches for changes) |
| `ob sync-config` | View/change sync settings |
| `ob sync-status` | Show sync status |
| `ob sync-unlink` | Disconnect vault from sync |

### 5.3. Sync Modes (Critical Architecture)

| Mode | Behavior | Best For |
|---|---|---|
| `bidirectional` | Full two-way sync | Normal use, desktop parity |
| `pull-only` | Download only, never upload | Server backup, AI read access |
| `mirror-remote` | Make local = remote exactly | Clean server replica |

### 5.4. Publish Command Map

| Command | Purpose |
|---|---|
| `ob publish-list-sites` | List publish sites |
| `ob publish-create-site` | Create new site |
| `ob publish-setup` | Connect vault to site |
| `ob publish` | Publish changes |
| `ob publish-config` | Configure includes/excludes |
| `ob publish-site-options` | Configure site appearance |
| `ob publish-unlink` | Disconnect from site |

---

## 6. The Plugin Ecosystem: Security Analysis

### 6.1. Trust Model
Obsidian plugins run with **UNRESTRICTED** privileges:
- Full filesystem access (not sandboxed to vault)
- Shell command execution via `child_process`
- Unrestricted network requests (no CORS in Electron)
- DOM manipulation and UI injection
- OS API access (clipboard, notifications, etc.)

There is **no permission system, no capability model, no sandbox**. "Restricted Mode" is a binary on/off for ALL community plugins.

### 6.2. Plugin API Surface

| API | Capability |
|---|---|
| `Plugin.addCommand()` | Register command palette actions |
| `Plugin.addRibbonIcon()` | Add sidebar icons |
| `Plugin.addSettingTab()` | Add settings panels |
| `Plugin.registerView()` | Create custom view types |
| `Plugin.registerEditorExtension()` | Add CodeMirror 6 extensions |
| `Plugin.registerMarkdownPostProcessor()` | Custom Markdown rendering |
| `Plugin.registerEvent()` | Auto-cleanup event listeners |
| `requestUrl()` | CORS-free HTTP requests |
| `app.vault.*` | Full file CRUD |
| `app.metadataCache.*` | Semantic index queries |
| `app.workspace.*` | UI layout control |
| `app.fileManager.*` | Safe file operations with link updating |

### 6.3. Key Internal Plugins (Core Plugins)
These "core plugins" are first-party but use the same plugin API:
- **Graph View**: Interactive force-directed link graph
- **Canvas**: Infinite spatial canvas (`.canvas` files)
- **Daily Notes**: Auto-create date-named notes
- **Backlinks**: Shows incoming links panel
- **Outgoing Links**: Shows outgoing links panel
- **Tags**: Tag pane with tree view
- **Bookmarks**: Starred/pinned items
- **Command Palette**: Fuzzy command search
- **File Recovery**: Local version snapshots
- **Templates**: Template insertion
- **Word Count**: Status bar word/character counter
- **Workspaces**: Saved layout states
- **Bases**: Database views (v1.12+)
- **Publish**: Cloud publishing
- **Sync**: Cloud sync
- **Search**: Full-text search
- **Random Note**: Navigate to random file
- **Unique Note Creator**: Zettelkasten-style note creation
- **Outline**: Heading tree for current file
- **Page Preview**: Hover preview for links

---

## 7. Syncing Architecture: Deep Dive

### 7.1. Obsidian Sync Protocol (Proprietary)
Based on network analysis:
- **Transport**: Encrypted WebSocket connections to `sync-*.obsidian.md`
- **Encryption**: Optional E2EE with user passphrase (AES-256). When enabled, server stores only ciphertext.
- **Delta Sync**: Sends file-level diffs, not full files
- **Conflict Strategy**: Timestamp-based with optional merge. True conflicts create `file (sync conflict).md` on disk.
- **Selective Sync**: Per-type filters (images, audio, video, PDF, settings categories, folders)
- **Version History**: Server retains file versions (1 year on paid plan)

### 7.2. Self-Hosted Alternatives

| Solution | Protocol | Server | Latency | Cost |
|---|---|---|---|---|
| **Obsidian Sync** | Proprietary WS | Obsidian Cloud | Near-real-time | $8-10/mo |
| **Self-hosted LiveSync** | CouchDB `_changes` | CouchDB (Docker) | Real-time | Server only |
| **Remotely Save** | WebDAV/S3 | Any WebDAV/S3 | Periodic | Storage only |
| **Obsidian Git** | Git push/pull | Any Git remote | Manual/periodic | Free |
| **Obsidian Headless** | Obsidian Sync API | Obsidian Cloud | Continuous/periodic | $8-10/mo |

### 7.3. Our Platform's Approach
We use **Self-hosted LiveSync + CouchDB** as the primary sync, with Git as the version history backend:

```
Obsidian Desktop ←──CouchDB──→ Server Vault
                                    │
                              File Watcher
                                    │
                              Git Commit
                                    │
                           DIKW-T Pipeline
                                    │
                             Hermes Agent
```

---

## 8. Recommended Tech Stack for Replication

If building an Obsidian-compatible knowledge server from scratch:

| Layer | Technology | Purpose |
|---|---|---|
| **Markdown Parser** | `unified` + `remark` + custom plugins | Parse Obsidian-flavored MD (wikilinks, callouts, embeds) |
| **Link Resolver** | Custom wikilink resolver | `[[Link]]` → file path resolution with fuzzy matching |
| **Metadata Extractor** | `gray-matter` + custom | YAML frontmatter + inline tag extraction |
| **File Watcher** | `chokidar` / `inotify` | Detect vault filesystem changes |
| **Search** | `MiniSearch` / `lunr.js` / PostgreSQL FTS | Full-text search index |
| **Version Control** | `isomorphic-git` / shell `git` | Per-vault Git repo for history |
| **Sync** | CouchDB + LiveSync protocol | Real-time cross-device sync |
| **Graph DB** | In-memory adjacency list / Neo4j | Link graph for backlink resolution |
| **API** | FastAPI (Python) / Express (Node) | REST API for agents |
| **Agent Integration** | CLI exec / HTTP API | Hermes agent pipeline |

---

## 8.1. Failure Modes & Mitigations (learned the hard way)

These are the specific ways an Obsidian-compatible vault server breaks in
production. Each one is documented so a reconstruction doesn't have to
rediscover it; the platform's own scars are cross-referenced.

| Failure | Symptom | Root cause | Mitigation |
|---|---|---|---|
| **Infinite watcher loop** | Debounced Git commits never fire; search reindex runs constantly | `watchdog` emits non-mutating events (`opened`, `closed`, `closed_no_write`). Reacting to them triggers a read, which emits another `opened`, bumping the debounce timer forever. | Maintain an explicit `_MUTATING = {created, modified, deleted, moved}` allowlist and drop every other event type. See `backend/app/watcher.py` and `docs/known-issues.md` #10. |
| **MetadataCache staleness** | Wikilink/backlink views return old data after an external write | Obsidian's `MetadataCache` is rebuilt asynchronously on `vault.modify`; external writes (LiveSync, WebDAV, API) land on disk before the in-memory cache has refreshed. Typical window: 50–500 ms. | Either (a) treat cache reads as eventually-consistent and poll after writes, or (b) drive a server-side index (`backend/app/search.py`, `graph.py`) from the filesystem directly and ignore MetadataCache entirely for backend needs. |
| **CouchDB unreachable mid-sync** | Obsidian LiveSync shows "Replicate failed"; local edits accumulate | CouchDB was down during a sync window. LiveSync queues revisions locally. | No action on the server side — LiveSync retries exponentially. Server must not "repair" by deleting client-side tombstones; treat CouchDB as the canonical replication substrate and let the client recover. |
| **Concurrent writes in the same debounce window** | Two commits merged into one; author attribution wrong | Both paths (WebDAV, LiveSync, API) land in the vault FS; the debounced committer coalesces events. | Accept the coalescing (intentional). If attribution matters, shorten the debounce or expose an `X-Sync-Source` header that the commit message preserves. |
| **Static asset 404 after mount-path change** | Dashboard loads blank; `/app.js` returns 404 | Mounting `StaticFiles` at `/ui/` while `index.html` uses relative paths sends `/app.js` to the API router instead of the file server. | Mount at `/` with `html=True`; register API + WebDAV routers first so they take precedence. See `docs/known-issues.md` #9. |
| **Plugin writes a large binary into the vault** | CouchDB replication slows to a crawl; `_attachments` storage balloons | Some community plugins (PDF exporters, audio recorders) drop multi-MB blobs directly into the vault; LiveSync must replicate each revision. | Keep binaries out of LiveSync: serve them via `POST /attachments` (separate endpoint) and reference with `![[file.png]]`. The vault holds a pointer, not the blob. |
| **Git repo corrupted by operator `git reset --hard`** | History lost; restore endpoint returns empty | Destructive Git commands on a live vault. | Never `git reset --hard` on a production vault without a backup branch first; the restore API is the only supported rollback surface. |

Cross-reference: `docs/known-issues.md` is the live incident log; the patterns
above are its generalised form.

---

## 9. Implementation Priorities (Build Order)

### Phase 1: Vault Engine (Week 1-2)
- Filesystem watcher with debounce
- Markdown parser with Obsidian extensions (wikilinks, embeds, callouts)
- YAML frontmatter parser with typed properties
- In-memory MetadataCache equivalent (link graph, tag index, property index)
- Basic file CRUD API

### Phase 2: Sync Layer (Week 3-4)
- CouchDB/LiveSync integration for real-time sync
- OR: Obsidian Headless (`ob sync --continuous`) for official Sync
- Conflict resolution (timestamp-based with conflict-file fallback)
- Selective sync configuration

### Phase 3: Version Control (Week 5-6)
- Per-vault Git repository management
- Automatic commit on file changes (with debounce)
- Diff API for version comparison
- DIKW-T classification of changes

### Phase 4: Query Engine (Week 7-8)
- Full-text search with context
- Link graph queries (backlinks, orphans, deadends, unresolved)
- Tag aggregation and filtering
- Property-based Dataview-style queries
- Base-compatible database views

### Phase 5: Agent Integration (Week 9+)
- CLI wrapper or HTTP API for agent access
- `eval`-equivalent for arbitrary query execution
- Task management API
- Daily note injection
- Template-based note creation
- DIKW-T pipeline integration

---

## 10. Critical Design Patterns for AI Consumers

### Pattern 1: MetadataCache Over Regex
Never parse Markdown files by regex when a semantic index is available. The MetadataCache gives pre-parsed, type-safe access to links, tags, headings, properties, tasks, and block references.

### Pattern 2: Vault API Over Direct fs
Always use the application's file API (CLI commands or vault API) instead of direct filesystem writes. This ensures caches are updated, sync triggers correctly, and plugin events fire.

### Pattern 3: Properties Over Content Parsing
Use YAML frontmatter properties for structured data. These are indexed, queryable, and typesafe. Don't embed metadata in note content that should be in frontmatter.

### Pattern 4: Two Tools, Two Purposes
- **`obsidian` CLI**: Full app control — for reading, querying, and manipulating vault data.
- **`ob` Headless**: Sync/Publish only — for server-side data transport without a display.

### Pattern 5: Respect the File Watcher
External tools can write files directly. But:
- Obsidian's watcher has a debounce window
- Rapid writes may cause brief cache inconsistencies
- Always write complete, valid Markdown (don't leave partial YAML frontmatter)
- Use `\n` line endings consistently

### Pattern 6: Link Resolution Is Non-Trivial
Wikilink resolution (`[[Target]]`) uses fuzzy matching:
1. Exact path match
2. Basename match (without extension)
3. Shortest-path-wins for ambiguous matches
This must be replicated for any tool generating or resolving internal links.

### Pattern 7: Treat Properties as a Schema
The `types.json` file in `.obsidian/` defines the property type schema. Respect it when setting properties programmatically — don't set a `date` property to a non-date string.

---

## 11. External Links & References

### Official
- Obsidian Help: https://obsidian.md/help/
- Obsidian CLI: https://obsidian.md/help/cli
- Obsidian Headless: https://obsidian.md/help/headless
- Developer Docs: https://docs.obsidian.md/
- API Types: https://github.com/obsidianmd/obsidian-api
- Headless Repo: https://github.com/obsidianmd/obsidian-headless
- Obsidian Sync: https://obsidian.md/sync
- Obsidian Publish: https://obsidian.md/publish

### Community
- Self-hosted LiveSync: https://github.com/vrtmrz/obsidian-livesync
- Remotely Save: https://github.com/remotely-save/remotely-save
- Obsidian Git: https://github.com/Vinzent03/obsidian-git
- Docker Headless Wrapper: https://github.com/Belphemur/obsidian-headless-sync-docker
- CouchDB: https://couchdb.apache.org/

### Our Platform
- Architecture: `docs/architecture.md`
- DIKW-T Spec: `docs/dikw-t.md`
- Sync Comparison: `reference/obsidian/obsidian-sync-comparison.md`
