# Obsidian App Architecture: Deep Reverse-Engineering & Technical Specification

**Purpose**: This document is a comprehensive, reverse-engineered architectural specification of the Obsidian application. An AI agent or developer can use this to understand how Obsidian works internally, what its trust boundaries are, and how to programmatically interface with it — either via plugins, the CLI, or direct filesystem manipulation.

**Sources**: Official Obsidian Help documentation (https://obsidian.md/help/), Obsidian Developer Docs (https://docs.obsidian.md/), `obsidian.d.ts` type definitions, obsidianmd/obsidian-headless GitHub repository, community reverse-engineering, and network traffic analysis.

---

## 1. Core Philosophy: Local-First, Plugin-Driven

Obsidian is fundamentally a **local-first** knowledge management system. Unlike Notion, Roam, or Logseq Cloud, Obsidian's uncompromising principle is:

> **The local filesystem is the single source of truth. Always.**

There is no central database. There is no proprietary file format. Your vault is a directory of plain `.md` files. If Obsidian the company disappeared tomorrow, your data would remain perfectly usable with any text editor.

This design decision drives every architectural choice in the system.

---

## 2. Execution Contexts & Runtime Environments

### 2.1. Desktop: Electron Shell
*   **Framework**: Chromium-based **Electron** application.
*   **Rendering Strategy**: Obsidian avoids heavy frontend frameworks (React, Vue, Angular) for core rendering. The core UI is built with **vanilla TypeScript** and direct DOM manipulation, keeping the main rendering loop extremely fast.
*   **Process Model**: Standard Electron architecture — a main process (Node.js) managing windows, and renderer processes (Chromium) for each vault window.
*   **File System Access**: Full Node.js `fs` module access. The vault is watched using low-level file watchers (`fs.watch` / `chokidar`-style wrappers).

### 2.2. Mobile: Capacitor Shell
*   **iOS/Android**: Wraps the same TypeScript/web codebase using **Capacitor**.
*   **Feature Parity**: The same plugin API (`obsidian.d.ts`) is available on mobile, ensuring community plugins work cross-platform (with known exceptions for Node.js-specific APIs like `child_process`).
*   **File System**: Uses Capacitor's filesystem plugin, storing vaults in app-sandboxed storage or iCloud/Google Drive-linked directories.

### 2.3. CLI: IPC Bridge (v1.12+)
*   **Binary**: A separate native executable (`obsidian-cli`) that communicates with the running Electron process via IPC (Inter-Process Communication using local sockets).
*   **Requirement**: The desktop Obsidian app **must be running**. If it is not, the CLI auto-launches it.
*   **Key insight**: The CLI does NOT parse the vault directly. It sends commands through the IPC boundary to be executed inside the running Electron context, meaning it has full access to the same internal APIs as plugins.

### 2.4. Headless: Standalone Node.js Client
*   **Binary**: `obsidian-headless` (npm package), invoked as `ob`.
*   **Requirement**: Does NOT require the desktop app. Runs as a standalone Node.js process.
*   **Scope**: Limited to **Sync** and **Publish** operations only. Cannot access `app.workspace`, `app.metadataCache`, or the plugin API.

---

## 3. The Editor Engine: CodeMirror 6

### 3.1. Core Integration
Obsidian uses **CodeMirror 6** (CM6) as the underlying text editor component. This is a complete, from-scratch rewrite of the CodeMirror library with a fundamentally different architecture (functional/immutable state model).

### 3.2. Live Preview (The Signature Feature)
The "Live Preview" mode is Obsidian's most distinctive UI feature. It works by:
1.  **Parsing** the Markdown source in the CM6 document into an AST using Obsidian's internal parser.
2.  **Decorating** parsed tokens using CM6's `Decoration` API — replacing Markdown syntax (e.g., `**bold**`, `![[embed]]`) with rendered HTML widgets.
3.  **Cursor-aware toggling**: When the cursor enters a decorated region, the widget is temporarily removed, revealing the raw Markdown syntax for editing. When the cursor leaves, the widget is re-rendered.

This is NOT a dual-pane preview. It is a single editor surface with dynamically toggled decorations.

### 3.3. Extension System
Obsidian exposes the CM6 extension API to plugin developers:
```typescript
// In your plugin's onload() method:
this.registerEditorExtension(myExtension);
```
**Critical**: Plugins MUST use the `@codemirror/*` packages that Obsidian bundles at runtime. Importing your own version of CM6 will cause version conflicts and undefined behavior. Obsidian overloads module resolution to provide its bundled CM6.

---

## 4. The `App` Singleton: Internal API Architecture

The global `App` object is the root of Obsidian's internal API tree. It is accessible inside plugins via `this.app` and inside the CLI via `obsidian eval`.

### 4.1. `app.vault` — The Filesystem API
The `Vault` class is the primary interface for all file operations. It wraps Node's `fs` module with caching, event emission, and safety guarantees.

| Method | Description |
|---|---|
| `vault.getFiles()` | Returns all `TFile` objects in the vault |
| `vault.getAbstractFileByPath(path)` | Resolves a path to `TFile` or `TFolder` |
| `vault.read(file)` | Read file contents as string |
| `vault.cachedRead(file)` | Read from cache (faster, may be stale) |
| `vault.create(path, data)` | Create a new file |
| `vault.modify(file, data)` | Overwrite file contents |
| `vault.append(file, data)` | Append to file |
| `vault.delete(file)` | Delete file (to trash) |
| `vault.rename(file, newPath)` | Move/rename (updates links if configured) |
| `vault.on('create'/'modify'/'delete'/'rename', cb)` | File system event listeners |

**Important**: Always prefer `vault.modify()` over direct `fs.writeFileSync()`. The vault API properly updates the internal cache, fires events to plugins, and triggers sync. Direct filesystem writes bypass all of this.

### 4.2. `app.metadataCache` — The Semantic Index (Crown Jewel)
The `MetadataCache` is Obsidian's **most valuable internal system**. It maintains an in-memory, asynchronously-updated index of every file's semantic structure.

| Method | Returns |
|---|---|
| `metadataCache.getFileCache(file)` | `CachedMetadata` — headings, links, tags, frontmatter, blocks, embeds |
| `metadataCache.getFirstLinkpathDest(linkpath, sourcePath)` | Resolves a wikilink to a `TFile` |
| `metadataCache.resolvedLinks` | Map of `sourcePath → { targetPath → linkCount }` |
| `metadataCache.unresolvedLinks` | Map of `sourcePath → { targetName → linkCount }` |
| `metadataCache.on('changed', cb)` | Fires when a file's metadata changes |
| `metadataCache.on('resolved', cb)` | Fires when all pending metadata is resolved |

**The `CachedMetadata` object structure:**
```typescript
interface CachedMetadata {
    links?: LinkCache[];           // [[wikilinks]] and [markdown](links)
    embeds?: EmbedCache[];         // ![[embeds]]
    tags?: TagCache[];             // #tags (inline)
    headings?: HeadingCache[];     // # Headings (with level + text)
    sections?: SectionCache[];     // top-level blocks
    listItems?: ListItemCache[];   // list items (with task status)
    frontmatter?: FrontMatterCache; // YAML frontmatter key/values
    frontmatterLinks?: FrontmatterLinkCache[];
    frontmatterPosition?: Pos;
    blocks?: Record<string, BlockCache>; // ^block-ids
}
```

**Why this matters for AI agents**: Instead of parsing thousands of Markdown files by regex, an agent with access to `metadataCache` (via CLI `eval` or a plugin) gets instantaneous, pre-parsed access to the vault's entire semantic graph — link maps, tag clouds, frontmatter properties, task lists, and heading structures.

### 4.3. `app.workspace` — The UI Layout Engine
The `Workspace` manages the pane/tab layout, active file state, and view lifecycle.

| Method | Description |
|---|---|
| `workspace.getActiveFile()` | Current file in the active editor |
| `workspace.getLeaf()` | Get or create a pane (tab) |
| `workspace.openLinkText(link, source)` | Navigate to a link |
| `workspace.iterateAllLeaves(cb)` | Iterate over all open panes |
| `workspace.on('file-open', cb)` | Fires when a file is opened |
| `workspace.on('layout-change', cb)` | Fires when tab/pane layout changes |
| `workspace.on('active-leaf-change', cb)` | Fires when active tab changes |

### 4.4. `app.fileManager` — Safe File Operations
Higher-level file operations that handle link resolution:
```typescript
fileManager.renameFile(file, newPath);      // Updates all internal links
fileManager.processFrontMatter(file, fn);   // Safely modify YAML frontmatter
```

---

## 5. The Plugin Ecosystem & Security Model

### 5.1. Plugin Architecture
Obsidian follows a **core + plugin** architecture. Features like Graph View, Canvas, Daily Notes, Backlinks, Bookmarks, and even the Command Palette are implemented as **core plugins** (internal plugins that ship with the app). Community plugins use the exact same API surface.

### 5.2. High-Trust Execution Surface
This is the most important security consideration:

> **Community plugins run with FULL Node.js privileges inside the Electron process.**

A community plugin can:
*   Read/write any file on the filesystem (not just the vault)
*   Execute arbitrary shell commands via `child_process`
*   Make unrestricted HTTP requests
*   Access the clipboard, OS APIs, and environment variables
*   Manipulate the DOM and inject arbitrary HTML/JS
*   Open new Electron windows

**Obsidian's "Restricted Mode"** disables community plugins. There is no sandbox, no permission system, no capability-based security. The trust model is: you trust the plugin author, or you don't install it.

### 5.3. Plugin Lifecycle
```typescript
class MyPlugin extends Plugin {
    async onload() {
        // Plugin initialization: register commands, views, settings
        this.addCommand({ id: 'my-cmd', name: 'Do thing', callback: () => {} });
        this.registerView(VIEW_TYPE, (leaf) => new MyView(leaf));
        this.addSettingTab(new MySettingTab(this.app, this));
    }
    
    async onunload() {
        // Cleanup: remove views, detach events
    }
}
```

### 5.4. Key Plugin API Surfaces
| API | Purpose |
|---|---|
| `Plugin.addCommand()` | Register a command palette action |
| `Plugin.addRibbonIcon()` | Add icon to left sidebar |
| `Plugin.addSettingTab()` | Add settings UI panel |
| `Plugin.registerView()` | Register custom view type |
| `Plugin.registerEditorExtension()` | Add CM6 editor extension |
| `Plugin.registerMarkdownPostProcessor()` | Custom Markdown rendering |
| `Plugin.registerEvent()` | Listen to app events with auto-cleanup |
| `requestUrl()` | Make HTTP requests (CORS-free in Electron) |

---

## 6. Syncing Architecture

### 6.1. File Change Detection
Obsidian uses OS-level file watchers to detect external modifications:
1.  A file watcher monitors the vault directory recursively.
2.  When a change is detected (create/modify/delete/rename), Obsidian:
    *   Re-reads the file from disk
    *   Updates the Vault cache
    *   Updates the MetadataCache
    *   Fires `vault.on('modify')` etc. events to plugins
3.  This means external tools (scripts, other editors, AI agents) can modify files directly, and Obsidian will pick up the changes automatically.

### 6.2. Obsidian Sync (Proprietary)
*   **Protocol**: Proprietary, encrypted WebSocket-based sync protocol.
*   **Encryption**: Optional end-to-end encryption (E2EE) with user-provided passphrase. Server cannot read content when E2EE is enabled.
*   **Conflict Resolution**: Primarily timestamp-based with automatic merging. True conflicts produce `file (sync conflict).md` files on disk (visible, not hidden in a database).
*   **Selective Sync**: Users configure which file types (images, audio, video, PDF), settings categories, and folders to sync.
*   **Sync Modes** (exposed in headless):
    *   `bidirectional` — full two-way sync (default)
    *   `pull-only` — download changes, never upload
    *   `mirror-remote` — make local match remote exactly
*   **Version History**: Server retains version history (1 year on paid plans). Accessible via `diff` CLI command or Sync UI.

### 6.3. Self-Hosted Alternatives
*   **Self-hosted LiveSync** (CouchDB plugin): Real-time, E2EE, uses CouchDB's `_changes` feed — this is what our platform uses.
*   **Remotely Save**: WebDAV/S3/Dropbox/OneDrive-based sync.
*   **Git-based**: Community plugins like Obsidian Git.

---

## 7. Vault Structure & Conventions

### 7.1. Directory Layout
```
my-vault/
├── .obsidian/                  # App configuration (per-vault)
│   ├── app.json                # General settings
│   ├── appearance.json         # Theme + CSS settings
│   ├── community-plugins.json  # Enabled community plugin IDs
│   ├── core-plugins.json       # Enabled core plugin toggles
│   ├── core-plugins-migration.json
│   ├── hotkeys.json            # Custom keyboard shortcuts
│   ├── workspace.json          # Last workspace layout state
│   ├── plugins/                # Community plugin code + data
│   │   └── plugin-id/
│   │       ├── main.js         # Compiled plugin code
│   │       ├── manifest.json   # Plugin metadata
│   │       ├── styles.css      # Plugin styles
│   │       └── data.json       # Plugin settings/state
│   ├── snippets/               # CSS snippets
│   └── themes/                 # Installed themes
├── folder/
│   └── note.md                 # Plain Markdown files
└── attachments/                # Images, PDFs, etc. (configurable)
```

### 7.2. Markdown Extensions (Obsidian-Flavored)
Obsidian extends standard Markdown with:
*   `[[Wikilinks]]` — Internal links (Obsidian's primary linking mechanism)
*   `[[Note|Display Text]]` — Aliased links
*   `![[Embed]]` — Transclusion / embedding
*   `#tags` and `#nested/tags` — Inline tags
*   `^block-id` — Block references
*   `%%comments%%` — Hidden comments
*   Callouts: `> [!note]`, `> [!warning]`, etc.
*   YAML frontmatter with typed properties
*   Mermaid diagrams in fenced code blocks
*   LaTeX math via `$inline$` and `$$block$$`

### 7.3. Properties (YAML Frontmatter)
Obsidian has a typed property system:
```yaml
---
title: My Note
date: 2026-04-18
tags:
  - project/alpha
  - status/active
aliases:
  - Alternative Name
cssclasses:
  - custom-class
publish: true
---
```

Supported property types: `text`, `list`, `number`, `checkbox`, `date`, `datetime`.

---

## 8. Bases (Database Views)

Since v1.12, Obsidian includes **Bases** — a built-in database/spreadsheet-like view system (`.base` files). Bases allow:
*   Querying vault files as database rows
*   Multiple views (table, board, calendar)
*   Filtering, sorting, and grouping by properties
*   Creating new files from within the base view

Bases are queryable via the CLI: `obsidian base:query file=MyBase format=json`

---

## 9. Critical Design Patterns for AI Integration

### Pattern 1: MetadataCache Over Regex
Never parse Markdown files by regex when you have access to the MetadataCache. The cache gives you pre-parsed, type-safe semantic data.
```bash
# Via CLI eval:
obsidian eval code="JSON.stringify(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('note.md')))"
```

### Pattern 2: Vault API Over Direct fs
Use `app.vault.modify()` (via CLI or plugin) instead of direct filesystem writes. This ensures:
*   Internal caches are updated immediately
*   Sync picks up the change
*   Plugin events fire correctly
*   YAML frontmatter integrity is preserved

### Pattern 3: Respect the File Watcher
If you must write files directly (e.g., from an external agent), know that:
*   Obsidian's file watcher has a slight debounce
*   Writing many files in rapid succession may cause brief cache inconsistencies
*   The watcher detects: create, modify, delete, rename
*   The watcher ignores: open, close without write (on well-configured systems)

### Pattern 4: Use Properties, Not Content Parsing
Instead of searching file content for metadata, use YAML frontmatter properties. These are indexed by the MetadataCache, queryable via Bases, and accessible via the CLI's `properties` / `property:set` / `property:read` commands.

### Pattern 5: Two CLI Tools, Two Purposes
*   **`obsidian` (CLI)**: Full app control — requires GUI running. Use for reading/writing/searching/eval.
*   **`ob` (Headless)**: Sync/Publish only — does NOT require GUI. Use for server-side vault synchronization.

---

## 10. External Links & References

*   Obsidian Help: https://obsidian.md/help/
*   Obsidian CLI Docs: https://obsidian.md/help/cli
*   Obsidian Headless Docs: https://obsidian.md/help/headless
*   Obsidian Developer Docs: https://docs.obsidian.md/
*   Plugin API Types: https://github.com/obsidianmd/obsidian-api (`obsidian.d.ts`)
*   Headless Client Repo: https://github.com/obsidianmd/obsidian-headless
*   Self-hosted LiveSync: https://github.com/vrtmrz/obsidian-livesync
*   CouchDB: https://couchdb.apache.org/
