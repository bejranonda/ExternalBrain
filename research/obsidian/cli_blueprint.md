# Obsidian CLI: Complete Reverse-Engineering Blueprint

**Purpose**: This document is a comprehensive, source-verified technical specification of the Obsidian CLI. An AI agent or developer can use this document to programmatically control Obsidian from external scripts, build automation pipelines, or create agentic workflows that leverage the full Obsidian internal API surface via the CLI.

**Source**: All information is derived from the official Obsidian CLI documentation (v1.12.7+), verified against the Obsidian Help site (https://obsidian.md/help/cli), binary analysis, and live testing.

---

## 1. Executive Summary

The Obsidian CLI transforms Obsidian from a passive Markdown editor into an **active, scriptable knowledge graph query server**. Instead of parsing files from disk, external tools can issue commands that execute inside the running Obsidian application, accessing the same optimized internal APIs (`app.vault`, `app.metadataCache`, `app.workspace`) that plugins use.

**Key differentiator**: The CLI is NOT a separate parser. It is a messenger that talks to the running Electron app via IPC. Every command is executed in the context of the full application state.

---

## 2. Architecture & Execution Mechanism

### 2.1. IPC Communication Model
```
Terminal                       IPC Socket                    Obsidian Electron App
─────────                      ──────────                    ─────────────────────
obsidian <command> ──────────→ Local socket ──────────────→ Main process receives
                               (platform-specific)          command, dispatches to
                                                            appropriate handler
                                                                    │
                                                                    ▼
                               ◄─── JSON response ──────── Handler executes in
                                    via IPC                 renderer context with
                                                            full app.* API access
                                     │
                                     ▼
stdout/stderr ◄──────────── CLI binary formats
                            and outputs result
```

### 2.2. Platform-Specific Binary Locations

| Platform | CLI Binary | Registration |
|---|---|---|
| **macOS** | `/usr/local/bin/obsidian` → symlink to `/Applications/Obsidian.app/Contents/MacOS/obsidian-cli` | Requires admin (system dialog) |
| **Linux** | `~/.local/bin/obsidian` (copy, not symlink) | Copies from Obsidian install dir |
| **Windows** | `Obsidian.com` terminal redirector in Obsidian install dir (added to PATH) | PATH registration via installer |

### 2.3. Auto-Launch Behavior
If the Obsidian desktop app is not running when a CLI command is issued, the CLI will:
1.  Launch the Obsidian application in the background
2.  Wait for the IPC socket to become available
3.  Execute the command
4.  Return the result

This means CLI commands can be used in cron jobs and automation scripts without pre-checking if Obsidian is running.

### 2.4. Vault Targeting
Commands target a vault using this priority:
1.  **Explicit parameter**: `vault=<name>` or `vault=<id>` (must be first parameter)
2.  **Current directory**: If `cwd` is inside a vault folder, that vault is used
3.  **Active vault**: Falls back to the currently active vault in the GUI

---

## 3. The Terminal User Interface (TUI)

Running `obsidian` without arguments opens an interactive TUI with:
*   **Autocomplete**: Tab-completion for commands, parameters, and file names
*   **Command History**: Persistent across sessions, with `Ctrl+R` reverse search
*   **Inline Help**: Shows parameter tooltips as you type
*   **Vault Switching**: `vault:open <name>` changes the active vault context

### 3.1. Key TUI Shortcuts

| Category | Action | Shortcut |
|---|---|---|
| Navigation | Jump to start/end of line | `Ctrl+A` / `Ctrl+E` |
| Navigation | Move back/forward one word | `Alt+B` / `Alt+F` |
| Editing | Delete to start/end of line | `Ctrl+U` / `Ctrl+K` |
| Editing | Delete previous word | `Ctrl+W` |
| Autocomplete | Enter/accept suggestion | `Tab` / `→` |
| Autocomplete | Exit suggestion mode | `Shift+Tab` |
| History | Previous/next entry | `↑` / `↓` |
| History | Reverse search | `Ctrl+R` |
| Other | Clear screen | `Ctrl+L` |
| Other | Exit | `Ctrl+C` / `Ctrl+D` |

---

## 4. THE CRITICAL COMMAND: `eval`

This is the single most important CLI command for reverse-engineering and automation:

```bash
obsidian eval code="<javascript>"
```

This passes arbitrary JavaScript through the IPC boundary to execute inside the running Obsidian context. The code has **full, unrestricted access** to:
*   `app.vault` — File operations
*   `app.metadataCache` — Semantic index queries
*   `app.workspace` — UI manipulation
*   `app.fileManager` — Safe file operations
*   `app.plugins` — Plugin state inspection
*   `window` — Full browser/Electron APIs
*   `require()` — Node.js modules

### 4.1. eval Examples (Agentic Use Cases)

```bash
# Count all files in the vault
obsidian eval code="app.vault.getFiles().length"

# Get all tags in the vault with counts
obsidian eval code="JSON.stringify(Object.entries(app.metadataCache.getTags()))"

# Read a file's metadata (links, tags, headings, frontmatter)
obsidian eval code="JSON.stringify(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('note.md')))"

# Get all unresolved links (notes that don't exist yet)
obsidian eval code="JSON.stringify(app.metadataCache.unresolvedLinks)"

# List all plugins and their state
obsidian eval code="JSON.stringify(Object.keys(app.plugins.plugins))"

# Get the full link graph for a file
obsidian eval code="JSON.stringify(app.metadataCache.resolvedLinks['folder/note.md'])"

# Read frontmatter properties
obsidian eval code="JSON.stringify(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('note.md'))?.frontmatter)"

# Execute a registered command
obsidian eval code="app.commands.executeCommandById('editor:toggle-bold')"
```

---

## 5. Complete Command Reference

### 5.1. File Operations

| Command | Description | Key Parameters |
|---|---|---|
| `create` | Create or overwrite a file | `name=`, `path=`, `content=`, `template=`, flags: `overwrite`, `open`, `newtab` |
| `read` | Read file contents | `file=`, `path=` (default: active file) |
| `append` | Append content to file | `file=`, `path=`, `content=` (required), flag: `inline` |
| `prepend` | Prepend content after frontmatter | `file=`, `path=`, `content=` (required), flag: `inline` |
| `move` | Move/rename a file | `file=`, `path=`, `to=` (required) |
| `rename` | Rename a file | `file=`, `path=`, `name=` (required) |
| `delete` | Delete a file | `file=`, `path=`, flag: `permanent` |
| `open` | Open a file in the editor | `file=`, `path=`, flag: `newtab` |
| `file` | Show file info (path, size, dates) | `file=`, `path=` |
| `files` | List files in vault | `folder=`, `ext=`, flag: `total` |
| `folder` | Show folder info | `path=` (required), `info=files\|folders\|size` |
| `folders` | List folders | `folder=`, flag: `total` |

### 5.2. Daily Notes

| Command | Description | Key Parameters |
|---|---|---|
| `daily` | Open daily note | `paneType=tab\|split\|window` |
| `daily:path` | Get daily note path (even if not created) | — |
| `daily:read` | Read daily note contents | — |
| `daily:append` | Append to daily note | `content=` (required), flags: `inline`, `open` |
| `daily:prepend` | Prepend to daily note | `content=` (required), flags: `inline`, `open` |

### 5.3. Search

| Command | Description | Key Parameters |
|---|---|---|
| `search` | Search vault for text | `query=` (required), `path=`, `limit=`, `format=text\|json`, flags: `total`, `case` |
| `search:context` | Search with line context (grep-style) | `query=` (required), `path=`, `limit=`, `format=text\|json`, flag: `case` |
| `search:open` | Open search view in GUI | `query=` |

### 5.4. Links & Graph

| Command | Description | Key Parameters |
|---|---|---|
| `backlinks` | List files linking TO a file | `file=`, `path=`, flags: `counts`, `total`, `format=json\|tsv\|csv` |
| `links` | List outgoing links FROM a file | `file=`, `path=`, flag: `total` |
| `unresolved` | List unresolved links in vault | flags: `total`, `counts`, `verbose`, `format=json\|tsv\|csv` |
| `orphans` | List files with no incoming links | flag: `total` |
| `deadends` | List files with no outgoing links | flag: `total` |

### 5.5. Tags & Properties

| Command | Description | Key Parameters |
|---|---|---|
| `tags` | List tags in vault | `file=`, `path=`, `sort=count`, flags: `total`, `counts`, `active`, `format=json\|tsv\|csv` |
| `tag` | Get info about a specific tag | `name=` (required), flags: `total`, `verbose` |
| `properties` | List properties | `file=`, `path=`, `name=`, `sort=count`, `format=yaml\|json\|tsv`, flags: `total`, `counts`, `active` |
| `property:set` | Set a property on a file | `name=` (required), `value=` (required), `type=text\|list\|number\|checkbox\|date\|datetime`, `file=`, `path=` |
| `property:read` | Read a property value | `name=` (required), `file=`, `path=` |
| `property:remove` | Remove a property | `name=` (required), `file=`, `path=` |
| `aliases` | List aliases | `file=`, `path=`, flags: `total`, `verbose`, `active` |

### 5.6. Tasks

| Command | Description | Key Parameters |
|---|---|---|
| `tasks` | List tasks in vault | `file=`, `path=`, `status="<char>"`, flags: `total`, `done`, `todo`, `verbose`, `daily`, `active`, `format=json\|tsv\|csv` |
| `task` | Show or update a task | `ref=<path:line>`, `file=`, `line=`, `status="<char>"`, flags: `toggle`, `done`, `todo`, `daily` |

### 5.7. Diff & Version History

| Command | Description | Key Parameters |
|---|---|---|
| `diff` | List/compare versions (local recovery + sync) | `file=`, `path=`, `from=<n>`, `to=<n>`, `filter=local\|sync` |
| `history` | List local recovery versions | `file=`, `path=` |
| `history:list` | List all files with local history | — |
| `history:read` | Read a local history version | `file=`, `path=`, `version=<n>` |
| `history:restore` | Restore a local history version | `file=`, `path=`, `version=` (required) |

### 5.8. Sync (requires desktop app + Sync subscription)

| Command | Description | Key Parameters |
|---|---|---|
| `sync` | Pause/resume sync | flags: `on`, `off` |
| `sync:status` | Show sync status and usage | — |
| `sync:history` | List sync version history | `file=`, `path=`, flag: `total` |
| `sync:read` | Read a sync version | `file=`, `path=`, `version=` (required) |
| `sync:restore` | Restore a sync version | `file=`, `path=`, `version=` (required) |
| `sync:deleted` | List deleted files in sync | flag: `total` |

### 5.9. Publish

| Command | Description | Key Parameters |
|---|---|---|
| `publish:site` | Show publish site info | — |
| `publish:list` | List published files | flag: `total` |
| `publish:status` | List publish changes | flags: `total`, `new`, `changed`, `deleted` |
| `publish:add` | Publish a file | `file=`, `path=`, flag: `changed` |
| `publish:remove` | Unpublish a file | `file=`, `path=` |
| `publish:open` | Open file on published site | `file=`, `path=` |

### 5.10. Plugins & Themes

| Command | Description | Key Parameters |
|---|---|---|
| `plugins` | List installed plugins | `filter=core\|community`, flags: `versions`, `format=json\|tsv\|csv` |
| `plugins:enabled` | List enabled plugins | `filter=core\|community`, flags: `versions` |
| `plugins:restrict` | Toggle restricted mode | flags: `on`, `off` |
| `plugin` | Get plugin info | `id=` (required) |
| `plugin:enable` | Enable a plugin | `id=` (required), `filter=core\|community` |
| `plugin:disable` | Disable a plugin | `id=` (required) |
| `plugin:install` | Install community plugin | `id=` (required), flag: `enable` |
| `plugin:uninstall` | Uninstall community plugin | `id=` (required) |
| `plugin:reload` | Reload a plugin (dev) | `id=` (required) |
| `themes` | List installed themes | flag: `versions` |
| `theme:set` | Set active theme | `name=` (required) |
| `theme:install` | Install community theme | `name=` (required), flag: `enable` |
| `theme:uninstall` | Uninstall a theme | `name=` (required) |
| `snippets` | List CSS snippets | — |
| `snippet:enable` | Enable a CSS snippet | `name=` (required) |
| `snippet:disable` | Disable a CSS snippet | `name=` (required) |

### 5.11. Bases

| Command | Description | Key Parameters |
|---|---|---|
| `bases` | List all `.base` files | — |
| `base:views` | List views in a base | — |
| `base:create` | Create item in a base | `file=`, `view=`, `name=`, `content=`, flags: `open`, `newtab` |
| `base:query` | Query a base and return results | `file=`, `view=`, `format=json\|csv\|tsv\|md\|paths` |

### 5.12. Workspace & Tabs

| Command | Description | Key Parameters |
|---|---|---|
| `workspace` | Show workspace tree | flag: `ids` |
| `workspaces` | List saved workspaces | flag: `total` |
| `workspace:save` | Save workspace layout | `name=` |
| `workspace:load` | Load workspace layout | `name=` (required) |
| `workspace:delete` | Delete workspace | `name=` (required) |
| `tabs` | List open tabs | flag: `ids` |
| `tab:open` | Open a new tab | `group=`, `file=`, `view=` |
| `recents` | List recently opened files | flag: `total` |

### 5.13. Developer Commands

| Command | Description | Key Parameters |
|---|---|---|
| `devtools` | Toggle Electron dev tools | — |
| `dev:debug` | Attach/detach CDP debugger | flags: `on`, `off` |
| `dev:cdp` | Run Chrome DevTools Protocol command | `method=` (required), `params=<json>` |
| `dev:errors` | Show captured JS errors | flag: `clear` |
| `dev:screenshot` | Take screenshot (base64 PNG) | `path=<filename>` |
| `dev:console` | Show captured console messages | `limit=<n>`, `level=log\|warn\|error\|info\|debug`, flag: `clear` |
| `dev:css` | Inspect CSS with source locations | `selector=` (required), `prop=` |
| `dev:dom` | Query DOM elements | `selector=` (required), `attr=`, `css=`, flags: `total`, `text`, `inner`, `all` |
| `dev:mobile` | Toggle mobile emulation | flags: `on`, `off` |
| `eval` | Execute JavaScript | `code=` (required) |

### 5.14. Utility Commands

| Command | Description | Key Parameters |
|---|---|---|
| `help` | Show all commands / help for specific command | `<command>` |
| `version` | Show Obsidian version | — |
| `reload` | Reload the app window | — |
| `restart` | Restart the app | — |
| `vault` | Show vault info | `info=name\|path\|files\|folders\|size` |
| `vaults` | List known vaults | flags: `total`, `verbose` |
| `vault:open` | Switch vault (TUI only) | `name=` (required) |
| `bookmarks` | List bookmarks | flags: `total`, `verbose`, `format=json\|tsv\|csv` |
| `bookmark` | Add a bookmark | `file=`, `subpath=`, `folder=`, `search=`, `url=`, `title=` |
| `random` | Open random note | `folder=`, flag: `newtab` |
| `random:read` | Read random note | `folder=` |
| `templates` | List templates | flag: `total` |
| `template:read` | Read template content | `name=` (required), `title=`, flag: `resolve` |
| `template:insert` | Insert template into active file | `name=` (required) |

---

## 6. Parameter Syntax Reference

### 6.1. Rules
*   **Parameters**: `key=value` (quote values with spaces: `key="my value"`)
*   **Flags**: Boolean switches, just include the name: `open`, `overwrite`, `total`
*   **Multiline content**: Use `\n` for newline, `\t` for tab
*   **File targeting**: `file=<name>` (wikilink resolution) or `path=<full/path.md>` (exact)
*   **Copy output**: Add `--copy` to any command to copy result to clipboard
*   **Vault targeting**: `vault=<name|id>` as **first** parameter

### 6.2. Output Formats
Most commands support `format=` parameter:
*   `json` — Structured JSON (best for programmatic consumption)
*   `tsv` — Tab-separated values (default for most list commands)
*   `csv` — Comma-separated values
*   `text` — Plain text
*   `yaml` — YAML (properties only)
*   `tree` — Tree display (outline only)
*   `md` — Markdown table (bases only)
*   `paths` — File paths only (bases only)

---

## 7. Agentic Workflow Patterns

### Pattern 1: Daily Note Task Injection
```bash
#!/bin/bash
# AI agent appends synthesized tasks to today's daily note
obsidian daily:append content="- [ ] Review pull request from @alice"
obsidian daily:append content="- [ ] Update documentation for API v3"
```

### Pattern 2: Vault-Wide Semantic Analysis
```bash
#!/bin/bash
# Agent queries the full link graph, tag cloud, and unresolved links
LINKS=$(obsidian eval code="JSON.stringify(app.metadataCache.resolvedLinks)")
TAGS=$(obsidian tags counts format=json)
UNRESOLVED=$(obsidian unresolved format=json)

# Feed to LLM for analysis
echo "$LINKS" "$TAGS" "$UNRESOLVED" | python3 analyze_vault.py
```

### Pattern 3: Templated Note Creation
```bash
# Create a meeting note from a template and inject AI-generated content
obsidian create name="Meeting 2026-04-18" template=Meeting open
obsidian append file="Meeting 2026-04-18" content="## AI Summary\n\nThe key decisions were..."
```

### Pattern 4: Task Status Monitoring
```bash
# Agent checks incomplete tasks and reports progress
obsidian tasks todo format=json > /tmp/tasks.json
TOTAL=$(obsidian tasks total)
DONE=$(obsidian tasks done total)
echo "Progress: $DONE/$TOTAL tasks complete"
```

### Pattern 5: Plugin-Driven Data Extraction
```bash
# Query a Dataview-compatible Base for structured project data
obsidian base:query file=Projects format=json > /tmp/projects.json
```

---

## 8. CLI vs. Headless: When to Use What

| Capability | `obsidian` (CLI) | `ob` (Headless) |
|---|---|---|
| Requires GUI app | **Yes** | **No** |
| File read/write | ✅ Full vault access | ❌ Only via sync |
| Search | ✅ `search`, `search:context` | ❌ |
| MetadataCache access | ✅ Via `eval` | ❌ |
| Task management | ✅ `tasks`, `task` | ❌ |
| Sync control | ✅ `sync`, `sync:status` | ✅ `ob sync` |
| Publish control | ✅ `publish:add/remove` | ✅ `ob publish` |
| Daily notes | ✅ `daily`, `daily:append` | ❌ |
| Plugin management | ✅ Full CRUD | ❌ |
| `eval` (arbitrary JS) | ✅ | ❌ |
| Server/Docker deployment | ❌ Needs display | ✅ Headless |
| Continuous background sync | ❌ | ✅ `ob sync --continuous` |

**Rule of thumb**: Use the CLI when you need to **read, query, or manipulate** vault data. Use Headless when you need to **sync or publish** on a server without a display.

---

## 9. External References

*   Official CLI docs: https://obsidian.md/help/cli
*   Obsidian Headless: https://obsidian.md/help/headless
*   Developer API docs: https://docs.obsidian.md/
*   Plugin API types (`obsidian.d.ts`): https://github.com/obsidianmd/obsidian-api
