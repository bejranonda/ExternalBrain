# Self-Hosted LiveSync: A Reconstruction-Grade Blueprint

**Purpose**: This document is a source-verified architectural specification of the Self-hosted LiveSync Obsidian plugin. An AI agent or developer can use this document to rebuild a compatible replication plugin and server-side subscriber, or to lift LiveSync's techniques (CRDT-ish CouchDB revision model, E2E encryption flow, chunking, conflict resolution) into another project.

**Source verification statement**: Information is derived from direct inspection of:
- `github.com/vrtmrz/obsidian-livesync` — main plugin repository (TypeScript 79%, Svelte 11%)
- `github.com/vrtmrz/livesync-commonlib` — shared library submodule (`src/pouchdb/`, `src/replication/`, `src/encryption/`, `src/ContentSplitter/`, `src/common/models/`)
- `github.com/vrtmrz/obsidian-livesync/blob/main/utils/couchdb/couchdb-init.sh` — canonical CouchDB init script
- `github.com/vrtmrz/obsidian-livesync/blob/main/devs.md` — developer architecture guide
- `github.com/vrtmrz/obsidian-livesync/blob/main/docs/tech_info.md` — technical overview
- `docs.vrtmrz.net/` — official documentation site
- CouchDB replication protocol docs at `docs.couchdb.org/en/stable/replication/protocol.html`

Where exact source lines could not be pinned, this document says so explicitly.

---

## §1 The Core Problem Addressed

### Why alternatives to Obsidian Sync exist

Obsidian is a **local-first** note-taking application: notes are plain Markdown files on the user's filesystem. Obsidian's official **Obsidian Sync** service provides cloud sync for $10/month (as of 2025), but it involves transmitting plaintext vault data to Obsidian's servers — unacceptable for teams with data sovereignty requirements, air-gapped environments, or cost constraints.

The gap LiveSync fills:

| Dimension         | Obsidian Sync            | Self-hosted LiveSync                   |
|-------------------|--------------------------|----------------------------------------|
| Server            | Obsidian Inc. cloud      | Operator-controlled CouchDB            |
| Data privacy      | Trust Obsidian Inc.      | Operator controls all data at rest     |
| Encryption        | In-transit TLS only      | Optional E2E: server never sees plaintext |
| Cost              | $10/mo                   | Self-hosted infra cost only            |
| Conflict model    | Last-write-wins          | CouchDB MVCC + auto-merge              |
| Real-time         | Yes                      | Yes (continuous replication mode)      |
| Plugin/config sync| Yes                      | Yes (internal file sync feature)       |

### What LiveSync is

LiveSync is a **bidirectional replication bridge** between:
1. A **local PouchDB** database embedded in the Obsidian plugin (in-browser IndexedDB)
2. A **remote CouchDB** database on an operator-controlled server

The plugin monitors vault filesystem changes, encodes vault files as CouchDB documents (optionally encrypted), and relies on the native CouchDB/PouchDB replication protocol to propagate changes to all other devices that share the same remote DB. The remote CouchDB is a **dumb store** — it performs no processing, only stores and replicates documents.

---

## §2 Data Model / Key Types

### 2.1 Document type taxonomy

All types are defined in `github.com/vrtmrz/livesync-commonlib/blob/main/src/common/models/db.const.ts` and `db.type.ts`.

```
EntryTypes constant (canonical string values):
  NOTE_LEGACY    = "notes"        // old inline-data format (pre-chunking)
  NOTE_BINARY    = "newnote"      // modern binary file, data in child chunks
  NOTE_PLAIN     = "plain"        // modern text file, data in child chunks
  INTERNAL_FILE  = "internalfile" // .obsidian/ config files
  CHUNK          = "leaf"         // content chunk (EntryLeaf)
  CHUNK_PACK     = "chunkpack"    // packed chunk bundle (EntryChunkPack)
  VERSION_INFO   = "versioninfo"  // protocol version doc
  SYNC_INFO      = "syncinfo"     // sync metadata
  MILESTONE_INFO = "milestoneinfo"// per-node negotiation doc
  NODE_INFO      = "nodeinfo"     // device identity doc
```

### 2.2 Core document shapes

**Note document (modern — type "newnote" or "plain"):**
```json
{
  "_id":      "notes/inbox/hello.md",
  "_rev":     "3-a1b2c3d4...",
  "type":     "newnote",
  "path":     "inbox/hello.md",
  "ctime":    1712345678000,
  "mtime":    1712345900000,
  "size":     2048,
  "deleted":  false,
  "children": ["h:aabbcc...", "h:ddeeff...", "h:001122..."],
  "eden":     {}
}
```
`children` is an ordered array of chunk document IDs. The note body is reconstructed by fetching and concatenating these chunks in order.

**Note document (legacy — type "notes"):**
```json
{
  "_id":   "notes/inbox/hello.md",
  "_rev":  "1-abc...",
  "type":  "notes",
  "path":  "inbox/hello.md",
  "data":  "# Hello\n\nThis is the full content inline.",
  "ctime": 1712345678000,
  "mtime": 1712345678000,
  "size":  38,
  "deleted": false
}
```
Legacy format: entire content in `data` string. Only used for small files in early plugin versions.

**Chunk document (type "leaf"):**
```json
{
  "_id":  "h:aabbcc112233445566778899aabbcc1122334455",
  "_rev": "1-xyz...",
  "type": "leaf",
  "data": "<base64 or plaintext chunk content>"
}
```
- `_id` prefixed with `"h:"` (defined as `Chunk = "h:"` in `shared.const.behabiour.ts`)
- Encrypted chunks use prefix `"h:+"` (`EncryptedChunk = "h:+"`)
- The hash after the prefix is a content-addressed digest — identical content across files produces the same chunk document, providing automatic deduplication.

**Deleted tombstone:**
```json
{
  "_id":     "notes/inbox/hello.md",
  "_rev":    "4-tombstone...",
  "type":    "newnote",
  "path":    "inbox/hello.md",
  "deleted": true,
  "mtime":   1712346000000
}
```
CouchDB never physically removes documents on deletion; it creates a tombstone revision with `deleted: true`. Replication propagates tombstones to all peers.

**Internal file document (type "internalfile"):**
```json
{
  "_id":     "i::.obsidian/plugins/dataview/data.json",
  "_rev":    "2-...",
  "type":    "internalfile",
  "path":    ".obsidian/plugins/dataview/data.json",
  "children": ["h:..."],
  "deleted": false
}
```
`.obsidian/` config files (plugins, themes, snippets, settings JSON) use the `internalfile` type. The `_id` is prefixed with `"i::"` (defined as `ICHeader`). These are synced only if the user opts in to "Plugin and setting sync."

**Obfuscated path document (E2E mode):**
When path encryption is enabled, the `path` field is encrypted and the `_id` uses prefix `"f:"` (`Obfuscated = "f:"`). The server sees opaque IDs like `"f:aBc123..."` and cannot reconstruct the filename.

### 2.3 Special metadata documents

| Document `_id`                              | Type             | Purpose                                    |
|---------------------------------------------|------------------|--------------------------------------------|
| `"obsydian_livesync_version"`               | `versioninfo`    | Protocol version negotiation               |
| `"_local/obsydian_livesync_milestone"`      | `milestoneinfo`  | Per-node chunk format version ranges       |
| `"_local/obsydian_livesync_nodeinfo"`       | `nodeinfo`       | Device identity (name, app version, vault) |
| `"syncinfo"`                                | `syncinfo`       | Sync metadata                              |

Note: `_local/` documents are CouchDB local documents — they are **not** replicated between nodes. They store per-device state.

### 2.4 Document ID naming conventions

```
Regular note:       notes/path/to/file.md
Chunk:              h:<hash>
Encrypted chunk:    h:+<encrypted_hash>
Obfuscated path:    f:<hash>
Internal file:      i::<path>   (ICHeader prefix)
Internal encrypted: ix::<path>  (ICHeaderEnd prefix)
```

---

## §3 Replication Protocol

### 3.1 How LiveSync rides CouchDB replication

LiveSync does NOT implement its own sync protocol. It delegates entirely to the **PouchDB ↔ CouchDB replication protocol**, which is a subset of the CouchDB Replication Protocol v1/v2.

The four-step flow (from `docs/tech_info.md`):
```
1. Vault change detected
   → Plugin catches Obsidian file-system event

2. Vault → Local PouchDB
   → File is chunked, optionally encrypted, written as
     one parent doc + N chunk docs into IndexedDB via PouchDB

3. Local PouchDB → Remote CouchDB  (push)
   → PouchDB replication: uses /_changes + /_bulk_docs
   → Continuous mode: PouchDB keeps a live connection with heartbeat

4. Remote CouchDB → Other device's Local PouchDB  (pull)
   → Other devices watch /_changes on the remote DB
   → Each new change is fetched and applied
   → Parent doc received → children chunks fetched
   → Chunks assembled → file written to Obsidian vault
```

### 3.2 CouchDB protocol primitives used

| Endpoint               | Usage                                                                    |
|------------------------|--------------------------------------------------------------------------|
| `GET /{db}/_changes`   | Pull feed; `feed=longpoll` or `feed=continuous`; `include_docs=true`     |
| `POST /{db}/_bulk_docs`| Push batch of documents; `new_edits: false` to preserve revision tree    |
| `GET /{db}/_local/{id}`| Checkpoint storage (last successfully synced sequence number)            |
| `PUT /{db}/_local/{id}`| Write checkpoint after successful batch                                  |
| `GET /{db}/{docid}`    | Fetch individual document with conflict revisions (`?conflicts=true`)    |
| `GET /{db}/{docid}?revs_info=true` | Inspect full revision ancestry for conflict resolution      |

**Key divergence from standard CouchDB replication**: LiveSync uses `new_edits: false` on `_bulk_docs`. This is the "external replication" flag that tells CouchDB to accept the document as-is with its supplied `_rev`, rather than auto-generating a new revision. This is the same mechanism used by CouchDB's native replicator. Source: `LiveSyncReplicator.ts`, `remoteDB.bulkDocs()` call (exact line not pinned).

### 3.3 Sync modes

| Mode         | Trigger                  | PouchDB call                       | Battery impact |
|--------------|--------------------------|------------------------------------|----------------|
| **LiveSync** | File save / DB change    | `localDB.sync(db, {live:true, retry:true, heartbeat:30000})` | High (permanent connection) |
| **Periodic** | Timer interval (seconds) | `localDB.replicate.from/to(db)`    | Low (burst)    |
| **On Save**  | Obsidian file:save event | One-shot `replicate.to(db)`        | Medium         |
| **On Start** | Obsidian startup         | One-shot bidirectional             | Low            |
| **Manual**   | User clicks sync button  | One-shot bidirectional             | Low            |

In LiveSync mode: `live: true, retry: true, heartbeat: 30000` (30-second heartbeat). The connection is kept open; any change on either side is propagated within seconds.

### 3.4 Batch and retry parameters

From `LiveSyncReplicator.ts` (verified):
- Default `batch_size`: 50 changes per batch
- Default `batches_limit`: 40 concurrent batches
- `maxBatchSizeCount`: 200 documents per chunk upload batch
- On failure: batch size is halved (`Math.ceil(value / 2) + 2`) with exponential backoff
- If batch size drops below 5, replication fails permanently
- `NEED_RESURRECT` status triggers full replication restart when transfer volume exceeds `batch_size * 2`

### 3.5 Checkpoint tracking

Sequence numbers are stored in:
- `lastSyncPullSeq` / `lastSyncPushSeq` — in-memory, reset on restart
- `_local/max_seq_on_chunk-{remoteID}` — CouchDB local doc with a `seqStatusMap` tracking which sequences have been transferred (verified, `LiveSyncReplicator.ts`)

This is equivalent to CouchDB's native checkpoint mechanism, keeping the `_local/` namespace consistent.

---

## §4 Chunking & Deduplication

### 4.1 Why chunks exist

CouchDB has a hard limit on individual document size. LiveSync constants (verified from `shared.const.behabiour.ts`):
- `MAX_DOC_SIZE = 1000` — applies to text/markdown content (unit: characters, roughly 1000 chars per chunk)
- `MAX_DOC_SIZE_BIN = 102400` — binary file chunk limit (100 KB)
- Practical ceiling: ~900 KB per chunk to stay within Cloudant's 1 MB document limit

Without chunking, a single 5 MB PDF attachment would exceed CouchDB's limits. Chunking also enables **content-addressed deduplication**: if two vault files share a paragraph, they will reference the same chunk `_id`.

### 4.2 Chunking algorithms

The `ContentSplitter/` module (`github.com/vrtmrz/livesync-commonlib/blob/main/src/ContentSplitter/`) implements multiple strategies, versioned via the `ChunkSplitterVersion` type:

| Version | Class                       | Algorithm      | Description                                     |
|---------|-----------------------------|----------------|-------------------------------------------------|
| V1      | `ContentSplitterV1`         | Fixed-size     | Split at `MAX_DOC_SIZE` boundaries              |
| V2      | `ContentSplitterV2`         | Enhanced fixed | Configurable via "Enhance chunk size" setting   |
| Rabin-Karp | `ContentSplitterRabinKarp` | Rolling hash  | Content-defined splitting; chunk boundaries are content-driven, not position-driven |

The **Rabin-Karp** splitter uses a rolling polynomial hash over a sliding window (exact window size not pinned in available source) to find natural content boundaries. This produces chunks of variable size that are stable across edits — inserting a line near the top of a file does not shift all subsequent chunk boundaries, unlike fixed-size splitting.

Parameters exposed in settings:
- `pieceSize`: target chunk size (user-configurable via "Enhance chunk size")
- `minimumChunkSize`: lower bound (not pinned in available source)
- `plainSplit`: boolean controlling whether binary content is split differently

### 4.3 Chunk IDs and deduplication

Chunk `_id` = `"h:"` + `<hash of content>`.

The hash function used for chunk IDs is MurmurHash with seed `SEED_MURMURHASH = 0x12345678` (verified from `shared.const.behabiour.ts`). This is a non-cryptographic hash chosen for speed.

Deduplication is automatic: if the same chunk content already exists in the remote DB (same `_id`), `_bulk_docs` with `new_edits: false` will detect the existing revision and skip the write. The `chunks.ts` module further narrows uploads by pre-checking which chunk IDs are already present in the local DB before initiating the push.

### 4.4 Storage impact

Chunks accumulate over time. LiveSync does **not automatically shrink** the database after file deletion — tombstones and orphaned chunks are retained for conflict resolution. The operator's options:

1. **Rebuild everything** — nuclear option; rebuilds local + remote DB from current local files
2. **Periodic compaction** — CouchDB's built-in `_compact` endpoint removes old revisions
3. Manual invocation of "Verify and repair all files" in the plugin Hatch pane

---

## §5 End-to-End Encryption

### 5.1 Design philosophy

When E2E encryption is enabled, the **remote CouchDB server is treated as an adversary**. The server stores only ciphertext. Only devices holding the shared passphrase can read vault content. The passphrase is **never sent to the server**.

### 5.2 Encryption algorithms

Two algorithm versions are supported (verified from `src/pouchdb/encryption.ts`):

| Version | Identifier | Algorithm         | Status               |
|---------|------------|-------------------|----------------------|
| V1      | `%`        | Legacy (exact algorithm not pinned in available source) | Deprecated |
| V2      | `%=`       | AES-GCM with HKDF key derivation | Current (since v0.25.0, `VER = 12`) |

The encrypted ciphertext is prefixed with `"%="` (V2 HKDF) or `"%"` (V1 legacy) to allow version detection at decryption time (verified from `encryption.ts`).

### 5.3 Key derivation

V2 key derivation uses **HKDF** (HMAC-based Key Derivation Function):
- Passphrase + `SALT_OF_PASSPHRASE = "rHGMPtr6oWw7VSa3W3wpa8fT8U"` (hardcoded salt, verified from `shared.const.behabiour.ts`)
- HKDF is implemented via Web Crypto API workers (`encryptHKDFWorker` / `decryptHKDFWorker` in `bgWorker.ts`)
- The `getPBKDF2Salt` callback provides an additional `Uint8Array` salt for PBKDF2 key stretching
- `useDynamicIterationCount` boolean controls iteration count (exact default not pinned)

Path IDs are obfuscated separately: `SALT_OF_ID = "a83hrf7f\x03y7sa8g31"` is mixed with the passphrase to derive a deterministic mapping from plaintext path to opaque `_id`. This means the same file always maps to the same `_id` across sync, while the server cannot reverse the mapping without the passphrase.

### 5.4 What is encrypted vs. plaintext

| Field              | E2E off       | E2E on (path obfuscation on) | E2E on (path obfuscation off) |
|--------------------|---------------|------------------------------|-------------------------------|
| `_id`              | Plaintext path| Obfuscated hash (`f:...`)    | Plaintext path                |
| `_rev`             | Plaintext      | Plaintext (CouchDB internal) | Plaintext                     |
| `path`             | Plaintext      | Encrypted, replaced with `"/\\:"` prefix | Encrypted     |
| `data` (chunk)     | Plaintext      | Encrypted (`%=...`)          | Encrypted                     |
| `ctime`/`mtime`/`size` | Plaintext | Zeroed out after encryption  | Zeroed out                    |
| `children` array   | Chunk IDs      | Cleared after encryption     | Cleared                       |
| `eden` field       | Plaintext      | Stored under `h:++encrypted-hkdf` key | Same              |
| `type` field       | Plaintext      | Plaintext (routing required) | Plaintext                     |

**Critical implication for server-side processing**: If E2E + path obfuscation is enabled, the server cannot know file paths or content. The Cloud Knowledge Platform integration (see `integration_notes.md`) deliberately **disables path obfuscation** so the server can materialise cleartext files to disk.

### 5.5 Eden chunks

The `eden` field (`Record<DocumentID, EdenChunk>`) is a small auxiliary store holding recent content deltas. `EdenChunk = { data: string, epoch: number }`. This allows the plugin to transmit very recent small edits without a full chunk round-trip. Exact role not fully pinned from available source.

---

## §6 Conflict Resolution

### 6.1 How CouchDB generates conflicts

CouchDB uses **MVCC** (Multi-Version Concurrency Control). Each document has a revision tree. When two devices both modify a document and replicate concurrently, CouchDB creates two leaf revisions in the tree — a **conflict**. Both revisions are stored; CouchDB uses a deterministic algorithm (lexicographic comparison of revision hashes) to designate one as the "winner," but the loser is preserved and visible to the application via `_conflicts`.

LiveSync explicitly opts into inspecting `_conflicts` on document fetch, and retrieves full revision ancestry via `?revs_info=true` to understand divergence points.

### 6.2 Auto-merge strategy

For text/markdown files, LiveSync uses **diff-match-patch (DMP)** three-way merge:
1. Find the common ancestor revision in the revision tree
2. Compute `diff(ancestor, rev_A)` and `diff(ancestor, rev_B)`
3. Apply both diff sets to the ancestor → merged result
4. If patches don't overlap, auto-merge succeeds → new revision written
5. If patches conflict (same lines changed differently), auto-merge fails

Auto-merge is implemented in `ConflictManager.tryAutoMerge()` (called from `LiveSyncLocalDB`). The markdown auto-merge capability is passed as a parameter, suggesting line-level granularity for text vs. block-level for binary.

### 6.3 Conflict outcome states

From `src/common/types.ts` (verified):
```
AUTO_MERGED       — merge succeeded, no user action needed
NOT_CONFLICTED    — no conflict existed
MISSING_OR_ERROR  — document missing or fetch error
LEAVE_TO_SUBSEQUENT — defer to a later sync pass
CANCELLED         — operation was cancelled
```

### 6.4 Manual conflict resolution

When auto-merge fails, LiveSync presents both conflicting versions to the user in Obsidian's UI. The user:
1. Sees a diff view of the two versions
2. Chooses a resolution or edits manually
3. The chosen version is written as a new revision
4. The losing revision is marked deleted

There is no `_conflicted_copy` file naming (that is Dropbox's convention). LiveSync keeps both revisions **inside CouchDB** and surfaces them via the plugin UI.

### 6.5 Conflict avoidance settings

- **"Always overwrite with a newer file"** (beta) — last-write-wins based on `mtime`
- **"Delay conflict resolution for inactive files"** — defer merge prompt if file hasn't been opened recently
- Both configured per-vault in plugin settings

---

## §7 CouchDB Server Setup

### 7.1 Canonical configuration

All settings are applied via the CouchDB REST API in `couchdb-init.sh` (`github.com/vrtmrz/obsidian-livesync/blob/main/utils/couchdb/couchdb-init.sh`). Verified configuration:

**Authentication (required):**
```ini
[chttpd]
require_valid_user = true

[chttpd_auth]
require_valid_user = true

[httpd]
WWW-Authenticate = Basic realm="couchdb"
```

**CORS (required for Obsidian):**
```ini
[httpd]
enable_cors = true

[chttpd]
enable_cors = true

[cors]
credentials = true
origins = app://obsidian.md,capacitor://localhost,http://localhost
```

Origins explained:
- `app://obsidian.md` — Obsidian desktop (Electron)
- `capacitor://localhost` — Obsidian iOS/Android (Capacitor)
- `http://localhost` — development/testing

**Document size limits (required for large vaults):**
```ini
[chttpd]
max_http_request_size = 4294967296   ; 4 GB

[couchdb]
max_document_size = 50000000         ; 50 MB
```

**Cluster initialization:**
```
POST /_cluster_setup  { "action": "enable_single_node", "bind_address": "0.0.0.0", "port": 5984 }
```

### 7.2 Why CORS is mandatory

Obsidian desktop runs in Electron — its renderer process has the same CORS restrictions as a browser. The plugin makes `fetch()` calls from `app://obsidian.md` origin to `https://your-server:5984`. Without the `cors` section and `credentials: true`, every request fails with a CORS preflight rejection.

Mobile (Capacitor) uses `capacitor://localhost` as its origin. Both must be in the `origins` list.

### 7.3 Per-database user model

LiveSync does not use CouchDB's per-DB `_security` document in a complex way. The typical setup:
1. Admin credentials are the same credentials used by the plugin
2. Each project maps to one CouchDB database (e.g., `team-wiki`)
3. The plugin connects directly with admin credentials (or per-user CouchDB accounts)
4. Optionally: create a dedicated CouchDB user per project with access only to that database

The `SuffixDatabaseName = "-livesync-v2"` constant (verified) means the plugin appends this suffix to the user-configured database name. A vault named `"myvault"` maps to CouchDB database `"myvault-livesync-v2"`. Operators must account for this when setting up proxies.

### 7.4 Reverse proxy requirements

Essential proxy rules (Caddy example from our deployment):
```
handle_path /couchdb/* {
    reverse_proxy 127.0.0.1:5984
}
```
The proxy must:
- Allow all HTTP methods: GET, PUT, POST, HEAD, DELETE, OPTIONS
- Not strip `Authorization` headers
- Support streaming responses (for `_changes?feed=continuous`)
- Handle large request bodies (4 GB configured in CouchDB)
- Not impose a short connection timeout (continuous feed connections are long-lived)

---

## §8 Mobile / Battery Considerations

### 8.1 iOS background processing

iOS aggressively suspends background processes. Implications for LiveSync:
- **LiveSync mode** (continuous `_changes` feed) is **not sustainable** in iOS background; the OS kills the connection within seconds to minutes
- **Periodic sync** with a timer interval is the recommended iOS mode — each app-open triggers a sync, and the OS may fire the timer occasionally in the background
- `heartbeat: 30000` (30 sec) is used in the continuous feed; if iOS suspends the connection before a heartbeat, the feed is silently dropped

Our `docs/setup-client.md` recommends Periodic sync with 5-minute interval for mobile. Exact behaviour verified against docs; source line not pinned.

### 8.2 Android Doze mode

Android Doze suspends network access for background apps in standby. Symptoms: sync works when Obsidian is in foreground, but background syncs may be delayed 10–60 minutes. Mitigation: exempt Obsidian from battery optimisation ("Unrestricted" battery setting).

### 8.3 Periodic sync as safety net

Periodic sync serves as a catch-all: even if the continuous feed drops (iOS suspend, network change, VPN reconnect), the next periodic sync will reconcile any missed changes. The plugin tracks `lastSyncPullSeq` and resumes from the last checkpoint.

---

## §9 Failure Modes & Mitigations

| Failure Mode | Symptom | Root Cause | Mitigation |
|---|---|---|---|
| **Lost writes on network drop** | Changes made offline not synced | Continuous feed dropped, no periodic backup | Enable Periodic sync as fallback; plugin retries with backoff |
| **Chunk missing** | "Something went wrong" error on file open | Push completed parent doc but chunk upload failed | Run "Recreate missing chunks" on another device; plugin waits `LEAF_WAIT_TIMEOUT = 30000ms` before failing |
| **Corrupted local DB** | Plugin refuses to write, IndexedDB errors | Browser storage corruption, mid-write OS crash | Use `redflag3.md` / `flag_fetch.md` at vault root: discard local DB, re-fetch from remote |
| **Encryption mismatch** | Documents appear as garbled text | Different passphrase on two devices, or V1/V2 mismatch | All devices must use identical passphrase; plugin version `VER = 12` required for V2 (HKDF) |
| **"Tweaks Mismatched"** | Sync blocked with config warning | Plugin settings differ between devices (checked via `TweakValuesShouldMatchedTemplate`) | One device pushes settings with "Update with mine"; others accept |
| **Mass deletion propagated** | Entire vault deleted on all devices | Accidental "Initialize database" on non-first device | Place `redflag.md` to halt sync; use `flag_rebuild.md` to restore from local files; Git history on server is recovery fallback |
| **CORS error** | Every request fails with browser CORS error | Missing `cors` ini section in CouchDB | Add `origins = app://obsidian.md,...` to `local.ini`; use `couchdb-init.sh` |
| **Cloudflare 524** | Timeout on sync operations | CF's 100-second proxy timeout < heartbeat interval | Enable "Use timeouts instead of heartbeats" in plugin Power Users settings |
| **Binary files growing (iOS)** | Attachments bloat unexpectedly | Bug in v0.20.x (fixed v0.21.2) | Upgrade plugin; run "Verify and repair all files" |
| **Database never shrinks** | Disk usage grows monotonically | Orphaned chunks retained by design | Periodically run "Rebuild everything" or CouchDB `_compact` |
| **Fetch from remote (nuclear)** | Local vault overwritten entirely | Used as last resort for corrupted local state | Triggered by `redflag3.md`; all local data replaced by remote copy |

---

## §10 DIKW-T Mapping

LiveSync occupies **exactly one tier** in the DIKW-T framework: **Transport (T)**.

```
┌─────────────────────────────────────────────────────────────────┐
│  DIKW-T Stage      │  Role in this system                        │
├────────────────────┼─────────────────────────────────────────────┤
│ Data (D)           │ Raw vault files (Markdown, attachments)      │
│                    │ → LiveSync carries these, does NOT produce   │
├────────────────────┼─────────────────────────────────────────────┤
│ Information (I)    │ Structured notes with frontmatter/tags       │
│                    │ → LiveSync carries these, does NOT interpret │
├────────────────────┼─────────────────────────────────────────────┤
│ Knowledge (K)      │ Hermes agent output, graph relationships     │
│                    │ → LiveSync carries Hermes results back to    │
│                    │   vault; does NOT produce Knowledge          │
├────────────────────┼─────────────────────────────────────────────┤
│ Wisdom (W)         │ High-level synthesis, recommendations        │
│                    │ → LiveSync uninvolved                        │
├────────────────────┼─────────────────────────────────────────────┤
│ Transport (T)      │ *** LiveSync IS THIS LAYER ***               │
│                    │ Bidirectional, real-time, E2E-encrypted      │
│                    │ delivery of vault content between Obsidian   │
│                    │ clients and the platform's CouchDB store     │
└────────────────────┴─────────────────────────────────────────────┘
```

**What LiveSync does not do:**
- It does not parse Markdown, extract tags, or build graphs (D→I transition)
- It does not run inference, classify notes, or summarise content (I→K transition)
- It does not synthesise recommendations (K→W transition)

**What LiveSync does do:**
- Moves raw Data and Information across the network reliably, with conflict resolution and optional confidentiality
- Delivers Hermes-produced Knowledge documents back to the vault (Hermes writes to vault → watcher sees → git commit — the transport is the CouchDB replication loop that first brought the trigger document to the server)

This is an honest characterisation: LiveSync is a **transport layer**, not a stage producer. Projects that try to make LiveSync produce Knowledge (e.g., by embedding AI processing in the sync loop) are misusing the architecture.

---

## §11 Recommended Tech Stack for a Reimplementation

### 11.1 Server-side database

| Option | Pros | Cons |
|--------|------|------|
| **CouchDB 3.x** | Native replication protocol; battle-tested; built-in CORS, auth, MVCC | Requires Erlang runtime; heavier than SQLite |
| **PouchDB Server** | Node.js; same API as client; easier local dev | Less battle-tested for production |
| **IBM Cloudant** | Managed CouchDB; automatic scaling | Vendor lock-in; data leaves your infra |
| **MinIO/S3/R2** | Cheap object storage | Requires LiveSync's Journal sync engine (not CouchDB protocol); less mature |

**Recommendation**: CouchDB 3.3+ via Docker. The `couchdb-init.sh` script handles all required configuration.

### 11.2 Client-side

| Option | Pros | Cons |
|--------|------|------|
| **PouchDB (TypeScript)** | Drop-in CouchDB replication; used by LiveSync | Large bundle; IndexedDB dependency |
| **rxdb** | Reactive queries + replication | Higher complexity |
| **Custom HTTP client** | Minimal bundle; full control | Must implement checkpoint protocol |

**Recommendation for reimplementation**: Use PouchDB. It handles the checkpoint, batch, retry, and conflict machinery that LiveSync inherits for free.

### 11.3 Encryption library

| Option | Pros | Cons |
|--------|------|------|
| **Web Crypto API** | Built-in; hardware-accelerated | Browser-only without polyfill |
| **libsodium-wrappers** | Audited; cross-platform | Larger bundle |
| **node:crypto** | Server-side Node.js | Not available in browser |

**Recommendation**: Web Crypto API with HKDF (AES-GCM-256) matching LiveSync V2. Key: `PBKDF2(passphrase, SALT_OF_PASSPHRASE, iterations) → HKDF → AES-256-GCM`.

### 11.4 Chunking library

For reimplementation, the Rabin-Karp content-defined chunking is the most robust choice:
- Go: `github.com/restic/chunker` (Rabin fingerprinting)
- TypeScript: Implement `ContentSplitterRabinKarp` pattern from livesync-commonlib

Fixed-size chunking (`MAX_DOC_SIZE = 1000` chars for text, `102400` bytes for binary) is simpler but produces more chunk churn on edit.

---

## §12 Build Order

**Phase 1 — CouchDB foundation (Week 1)**
- Deploy CouchDB via Docker with `couchdb-init.sh` settings
- Verify CORS from `app://obsidian.md`; test `_changes` feed with `curl`
- Establish per-database user model; test auth with `require_valid_user = true`

**Phase 2 — Data model + local store (Week 2)**
- Implement `EntryDoc` / `EntryLeaf` TypeScript types
- Integrate PouchDB for local IndexedDB store
- Implement fixed-size chunker (V1): split text at 1000-char boundaries, binary at 100 KB
- Write parent doc → chunk doc → push to CouchDB; verify with Fauxton

**Phase 3 — Bidirectional replication (Week 3)**
- Connect PouchDB to remote CouchDB: `pouchDB.sync(remoteURL, {live: true, retry: true})`
- Implement `_changes` subscriber on server side (see `sync_monitor.py` pattern)
- Materialise incoming docs to filesystem
- Test: edit on device A → appears on device B within 2 seconds

**Phase 4 — E2E encryption (Week 4)**
- Implement PBKDF2 + HKDF key derivation using Web Crypto
- Encrypt `data` field of `EntryLeaf` before writing to PouchDB
- Encrypt/obfuscate `path` field and remap `_id` to `f:` prefix
- Verify: server-side materialisation fails (no decryption key) — expected in E2E mode

**Phase 5 — Conflict resolution + mobile (Week 5)**
- Implement `_conflicts` inspection on incoming documents
- Integrate diff-match-patch for three-way text merge
- Add Periodic sync mode with configurable interval
- Test iOS/Android: suspend Obsidian, make server-side edit, reopen app → sync triggered

---

## §13 Critical Design Patterns

### Pattern 1: Content-Addressed Chunk Deduplication
Chunk `_id` = `"h:" + MurmurHash(content, 0x12345678)`. Before uploading chunks, narrow to only those not already present in the remote DB (`chunks.ts`). This reduces bandwidth dramatically for vaults with large shared sections (e.g., templated daily notes).

### Pattern 2: `new_edits: false` for External Replication
When pushing documents to CouchDB via `_bulk_docs`, always use `new_edits: false`. This preserves the revision tree established by PouchDB, allowing CouchDB's native MVCC to detect conflicts correctly. Using `new_edits: true` (the default) would create a fresh linear history and lose conflict information.

### Pattern 3: Layered Encryption — Data separate from Metadata
Encrypt document `data` fields; keep `_id` and `_rev` plaintext (CouchDB requires them). Obfuscate paths separately using a deterministic hash (passphrase + `SALT_OF_ID`), ensuring the same file always maps to the same `_id` across all devices even when filenames are hidden from the server.

### Pattern 4: `_local/` for Non-Replicated State
Use CouchDB `_local/` documents for per-device state (checkpoint sequences, node info, milestone data). These documents are excluded from replication by the CouchDB protocol specification — no filtering rules needed.

### Pattern 5: Exponential Backoff with Batch Halving
On replication failure, halve the batch size (`Math.ceil(n/2) + 2`). This handles transient network errors (oversized batches exceeding proxy limits) without manual intervention. Set a floor (5 items) below which failure is declared permanent rather than looping indefinitely.

### Pattern 6: Flag Files for Emergency Control
Reserve special filenames at the vault root as emergency control signals: `redflag.md` = halt all sync; `flag_rebuild.md` = rebuild from local files; `flag_fetch.md` = discard local, fetch from remote. The plugin polls for these at startup and deletes them after acting. This gives operators an out-of-band mechanism that works even when the plugin UI is inaccessible.

### Pattern 7: Protocol Version Negotiation via Milestone Document
The `milestoneinfo` document stored at `_local/obsydian_livesync_milestone` tracks `node_chunk_info`: a map from device ID to `{min, max}` chunk format version ranges. Before initiating replication, devices check for version overlap with all accepted nodes. This allows gradual protocol upgrades without breaking older clients.

---

## §14 External Links & References

| Resource | URL | Notes |
|---|---|---|
| Main plugin repo | `github.com/vrtmrz/obsidian-livesync` | TypeScript/Svelte, 10.4k stars |
| Common library | `github.com/vrtmrz/livesync-commonlib` | Submodule with all core logic |
| Official docs | `docs.vrtmrz.net/` | Setup guides, troubleshooting |
| CouchDB init script | `github.com/vrtmrz/obsidian-livesync/blob/main/utils/couchdb/couchdb-init.sh` | Canonical config |
| Developer guide | `github.com/vrtmrz/obsidian-livesync/blob/main/devs.md` | Architecture overview |
| Technical info | `github.com/vrtmrz/obsidian-livesync/blob/main/docs/tech_info.md` | Four-step sync flow |
| CouchDB replication protocol | `docs.couchdb.org/en/stable/replication/protocol.html` | Protocol spec LiveSync rides |
| PouchDB replication | `pouchdb.com/guides/replication.html` | Client-side library LiveSync wraps |
| CouchDB MVCC | `docs.couchdb.org/en/stable/api/document/common.html` | Conflict model documentation |
| Fauxton (CouchDB UI) | `http://localhost:5984/_utils/` | Local debug UI |
| Troubleshooting (plugin) | `github.com/vrtmrz/obsidian-livesync/blob/main/docs/troubleshooting.md` | Flag file procedures |
| Our server setup | `docs/setup-server.md` in this repo | CKP deployment guide |
| Our client setup | `docs/setup-client.md` in this repo | Obsidian plugin configuration |
