# LiveSync ↔ Cloud-Knowledge-Platform Integration Notes

**Purpose**: Documents exactly how CKP integrates with LiveSync on the server side: the `_changes` subscriber, filesystem materialisation, the cleartext tradeoff, interaction with the Git versioner, and the operator troubleshooting path.

---

## 1. The CouchDB `_changes` Subscription

**File**: `backend/app/sync_monitor.py`

CKP subscribes to CouchDB's continuous changes feed for each project. The implementation is a pure HTTP long-poll using `urllib` (no third-party CouchDB client).

```python
# From sync_monitor.py — _listen()
url = (
    f"{settings.couchdb_url}/{db}/_changes"
    f"?feed=continuous&include_docs=true&since={since}&heartbeat=30000"
)
```

Key parameters:
| Parameter | Value | Purpose |
|-----------|-------|---------|
| `feed=continuous` | stream | Server holds connection open; sends each change as a JSON line |
| `include_docs=true` | true | Full document body included in change event (avoids a second GET) |
| `since=now` | advances per event | Tracks last-seen sequence; resumes after reconnect |
| `heartbeat=30000` | 30 s | CouchDB sends `\n` every 30 s; prevents proxy timeout |
| `timeout=60` | urllib read timeout | Local `urlopen` timeout; outer `wait(5)` retry on disconnect |

**One thread per project**: `start_project()` spawns a daemon thread per project slug. `start_all()` is called at backend startup (from `main.py`). Each thread loops forever; a 5-second backoff on any exception prevents tight-loop reconnects.

**Sequence tracking**: `since` is initialised to `"now"` (skip history on startup) and updated from `evt.get("seq", since)` on each received line. If the thread dies and restarts, it resumes from `"now"` again (no durable checkpoint). This means changes that arrived during a backend restart are not replayed — the next time a LiveSync client syncs, it will push the note again, triggering a new change event.

---

## 2. The Filesystem Materialiser Pattern

**Function**: `sync_monitor._materialise(project, doc)`

LiveSync CouchDB documents are translated into plain files on disk in `vaults/<slug>/`:

```python
# Simplified from sync_monitor.py
def _materialise(project, doc):
    path = doc.get("path") or doc.get("_id")   # prefer "path" field
    rel  = Path(path.lstrip("/"))
    # path traversal guard: reject any "../" in components
    target = project.vault_dir / rel

    if doc.get("deleted"):
        target.unlink(missing_ok=True)
        return

    body = doc.get("data")                     # legacy inline content
    if body is None and "children" in doc:
        body = "\n".join(doc.get("children") or [])   # chunked: join child IDs
    if body is None:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body)   # or write_bytes() for binary
```

**Important limitation**: The materialiser handles only two layouts:
1. **Legacy format** (`type: "notes"`): `doc["data"]` contains the full text inline
2. **Modern chunked format** (`type: "newnote"` / `"plain"`): `doc["children"]` is the array of chunk `_id` values

For modern format, the code currently **joins chunk IDs with newlines** rather than fetching each chunk document from CouchDB and assembling the actual content. This is a known simplification: the server only sees the parent doc in the `_changes` event (with `include_docs=true`), not the chunk bodies. Chunk documents arrive as their own separate change events.

**Correct chunked assembly** would require:
1. Receiving the parent doc with its `children` array
2. For each child `_id` (e.g., `"h:aabbcc..."`), `GET /{db}/{chunk_id}` to retrieve the chunk text
3. Concatenate in order → write to disk

The current implementation works correctly only when E2E is disabled AND the note fits in a single chunk (legacy mode) or when chunk IDs happen to spell out readable content (they do not). For production correctness with chunked vaults, `_materialise` must be extended with chunk fetching.

---

## 3. The E2E Encryption Tradeoff

**CKP deliberately operates without E2E decryption.**

When Obsidian clients connect with E2E encryption + path obfuscation enabled:
- `doc["_id"]` = `"f:aBc123..."` (opaque hash, not a readable path)
- `doc["path"]` = encrypted ciphertext (not a readable path)
- `doc["data"]` / chunk `doc["data"]` = `"%=..."` AES-GCM ciphertext

The materialiser cannot produce useful vault files from encrypted docs. The backend has no access to the shared passphrase.

**The deliberate choice made in CKP**:
- E2E is documented as **not compatible with server-side materialisation**
- `docs/setup-client.md` instructs users: "Every device in this project must use the same passphrase" — it does not instruct the server operator to hold the passphrase
- The practical implication: if a team enables E2E with path obfuscation, the `vaults/<slug>/` directory on disk will contain garbage (encrypted content), the watcher will still fire, and git will commit encrypted blobs — which is useless for Hermes

**Operator decision matrix:**

| Setup | Server sees | Git history | Hermes works |
|---|---|---|---|
| No E2E | Plaintext paths + content | Readable diffs | Yes |
| E2E, no path obfuscation | Plaintext paths, encrypted content | Path-readable, content encrypted | No (Hermes sees ciphertext) |
| E2E + path obfuscation | Opaque IDs, encrypted content | Useless | No |
| E2E, server holds passphrase (non-standard) | Decryptable if passphrase given to server | Readable | Possible but breaks E2E guarantee |

**Recommendation**: For teams that require true E2E privacy from the server operator, use a separate vault that is not connected to CKP. The CKP integration model assumes the server is a trusted party that materialises cleartext.

---

## 4. Interaction with the Git Versioner

**Data flow**:
```
LiveSync client (Obsidian)
  → push doc to CouchDB via PouchDB replication
    → CouchDB stores doc
      → sync_monitor._listen() receives change event
        → sync_monitor._materialise() writes file to vaults/<slug>/
          → watcher._Handler.on_any_event() detects FS mutation
            → versioning.schedule_commit(vault_dir, reason)
              → debounced (CKP_COMMIT_DEBOUNCE seconds, default 2.0)
                → git add -A && git commit -m "sync: [stage] path (modified)"
```

**Every LiveSync revision becomes a Git commit** (after the debounce window). If a user types continuously and saves every few seconds, the debouncer coalesces those saves into one commit per `DEBOUNCE_SECONDS`. High-frequency sync from LiveSync (e.g., multiple devices editing simultaneously) produces one commit per debounce window regardless of how many CouchDB revisions arrived.

**Watcher gotchas** (documented in `watcher.py` and `CLAUDE.md`):
- The watcher MUST ignore non-mutating inotify events (`opened`, `closed`, `closed_no_write`). The `_MUTATING = {"created", "modified", "deleted", "moved"}` filter prevents a feedback loop: `search.update_file()` reads the file on each change, which emits an `opened` event, which would re-trigger the commit.
- The `.obsidian/` directory is in `_IGNORED` — plugin config files synced by LiveSync's "internal file sync" feature are NOT committed to Git (they land in `vaults/<slug>/.obsidian/` but the watcher skips them).

**Hermes trigger**: The watcher also enqueues Hermes jobs for any `.md` file arriving under `vaults/<slug>/inbox/`. This means a note created in Obsidian, synced via LiveSync, materialised to disk, and detected by the watcher, will automatically be processed by Hermes — the complete Data→Information→Knowledge pipeline fires with no additional configuration.

---

## 5. Troubleshooting Path for Operators

### Symptom: Files not appearing in `vaults/<slug>/` after Obsidian sync

1. Verify CouchDB is reachable:
   ```bash
   curl -s http://admin:pw@localhost:5984/<slug>-livesync-v2/_changes?limit=1
   # Should return JSON with a "results" array
   ```
2. Check backend is subscribing:
   ```bash
   journalctl -u ckp -n 50 | grep "changes feed"
   # Should see no "changes feed error" lines; if errors, check CouchDB auth
   ```
3. Verify the document was written to CouchDB:
   ```bash
   curl -s http://admin:pw@localhost:5984/<slug>-livesync-v2/_all_docs?limit=10
   ```
4. Check materialise logic: if `doc["data"]` is null and `doc["children"]` contains `"h:..."` IDs, the materialiser is writing chunk IDs not content. This is the chunked-format limitation described in §2.

### Symptom: Git log shows commits but content is chunk IDs

The vault is using chunked format (`type: "newnote"`). The materialiser needs the chunk-fetching extension described in §2. As a workaround, disable chunking in the LiveSync plugin settings ("Use splitting-limit-capped chunk splitter" → off, reduce "Enhance chunk size") so notes fit in a single legacy `data` field.

### Symptom: `vaults/<slug>/` contains `%=...` encrypted content

E2E encryption is enabled. See §3. Either disable E2E in the Obsidian plugin, or accept that server-side materialisation is non-functional for this vault.

### Symptom: Sync works but Git commits stop appearing

Check debounce is not too long:
```bash
grep CKP_COMMIT_DEBOUNCE /opt/ckp/.env
```
Also verify the watcher is running:
```bash
journalctl -u ckp -n 20 | grep watcher
```
The watcher may have missed startup if the vault directory didn't exist when it launched; restart the backend after ensuring `vaults/<slug>/` exists.

### Symptom: CouchDB 401 errors in backend logs

The `CKP_COUCHDB_URL` in `.env` has wrong credentials, or CouchDB was restarted with different admin credentials. Verify:
```bash
curl -s -u admin:pw http://localhost:5984/
# Should return {"couchdb":"Welcome",...}
```

### Symptom: Changes feed reconnects constantly (loop every 5 seconds)

Check CouchDB logs for the reason the connection is being dropped:
```bash
docker logs ckp-couchdb --tail 50 | grep -i error
```
Common causes: CouchDB max connections exceeded, proxy timeout (Caddy default 30s < heartbeat 30s — increase Caddy timeout or reduce CouchDB heartbeat), or insufficient CouchDB workers for the number of projects.

---

## 6. Key File Cross-Reference

| File | Role |
|------|------|
| `backend/app/sync_monitor.py` | `_changes` subscriber; device status tracking; `_materialise()` |
| `backend/app/watcher.py` | inotify watcher; triggers versioning + Hermes on FS mutations |
| `backend/app/versioning.py` | Debounced `git add -A && git commit` per project |
| `backend/app/hermes.py` | Enqueues AI processing jobs for `inbox/*.md` files |
| `backend/app/projects.py` | Project registry; `project.vault_dir` = `vaults/<slug>/` |
| `backend/app/config.py` | `settings.couchdb_url`, `settings.commit_debounce_s` |
| `docs/setup-server.md` | CouchDB deployment; Caddy config; service setup |
| `docs/setup-client.md` | LiveSync plugin configuration for Obsidian clients |
