# Self-Hosted LiveSync: Architecture Conceptual Summary

**Purpose**: Concise reference for the LiveSync system components, replication state machine, encryption flow, and typical deployment topology. Read alongside `platform_blueprint.md` for full detail.

---

## Components

### Plugin side (Obsidian client)

```
┌─────────────────────────────────────────────────────────────┐
│  Obsidian App (Electron / Capacitor)                         │
│                                                             │
│  ┌──────────────┐   file events   ┌──────────────────────┐  │
│  │  Vault (FS)  │ ────────────── ▶│  LiveSync Plugin     │  │
│  │  .md files   │ ◀──────────── │  (TypeScript/Svelte) │  │
│  └──────────────┘   write back    └──────────┬───────────┘  │
│                                              │               │
│                                   ┌──────────▼───────────┐  │
│                                   │  Local PouchDB       │  │
│                                   │  (IndexedDB / IDB)   │  │
│                                   │  EntryDoc + EntryLeaf│  │
│                                   └──────────┬───────────┘  │
└──────────────────────────────────────────────│───────────────┘
                                               │ PouchDB ↔ CouchDB
                                               │ replication protocol
                                               │ HTTPS + Basic Auth
```

**Key plugin subsystems** (from `src/` and `src/lib/src/`):
- `ContentSplitter/` — chunks files into `EntryLeaf` documents
- `pouchdb/encryption.ts` — AES-GCM + HKDF encrypt/decrypt
- `replication/couchdb/LiveSyncReplicator.ts` — manages the live sync feed
- `pouchdb/LiveSyncLocalDB.ts` — wraps PouchDB; handles conflicts
- `pouchdb/chunks.ts` — chunk upload batching and deduplication
- `features/` and `serviceModules/` — UI, settings, plugin/theme sync

### CouchDB side (server)

```
┌──────────────────────────────────────────────────┐
│  Server                                          │
│                                                  │
│  ┌──────────┐     ┌────────────────────────────┐ │
│  │  Caddy   │────▶│  CouchDB 3.x               │ │
│  │  HTTPS   │     │  port 5984                 │ │
│  │  reverse │     │                            │ │
│  │  proxy   │     │  DB: <slug>-livesync-v2    │ │
│  └──────────┘     │  ├── EntryDoc (notes/)     │ │
│                   │  ├── EntryLeaf (h:...)      │ │
│                   │  ├── _local/ (checkpoints)  │ │
│                   │  └── _changes (feed)        │ │
│                   └───────────────┬─────────────┘ │
│                                   │               │
│  ┌────────────────────────────────▼─────────────┐ │
│  │  CKP Backend (FastAPI / Python)              │ │
│  │  sync_monitor.py: _changes subscriber        │ │
│  │  → materialise docs to vaults/<slug>/        │ │
│  │  watcher.py: FS events → versioning.py       │ │
│  │  versioning.py: debounced git commit         │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## Replication State Machine

```
                    ┌─────────┐
                    │ STOPPED │◀─────────────────────────────┐
                    └────┬────┘                              │
                         │ user enables sync / startup       │
                         ▼                                   │
                    ┌─────────┐                              │
               ┌───│ WAITING │                              │
               │   └────┬────┘                              │
               │        │ change detected or timer fires    │
               │        ▼                                   │
               │   ┌───────────┐    network error           │
               │   │ IN_PROGRESS│──────────────────────────▶│
               │   └────┬───────┘                           │  backoff
               │        │                                   │  (batch halved)
               │        │ success                           │
               │        ▼                                   │
               │   ┌──────────┐   batch < 5 items           │
               │   │ COMPLETE │──────────────────────────── ▶  FAILED
               │   └────┬─────┘                             │
               │        │                                   │
               │        │ live=true → back to WAITING       │
               └────────┘

Special states:
  NEED_RESURRECT — triggered when doc volume > batch_size * 2 during retry;
                   full replication restart
  PAUSED         — user-triggered or iOS background suspension
```

**Continuous (LiveSync) mode**: After COMPLETE, immediately re-enters WAITING with a live `_changes` longpoll open. The heartbeat (`30000ms`) keeps the connection alive through idle periods.

**Periodic mode**: After COMPLETE, exits to STOPPED. A timer fires after N seconds, re-entering WAITING.

---

## Encryption Flow Diagram

```
WRITE PATH (device → CouchDB):

  File content (plaintext)
       │
       ▼
  ContentSplitter
  (Rabin-Karp or fixed-size)
       │
       ▼
  N plaintext chunks
       │
       ▼  [if E2E enabled]
  PBKDF2(passphrase, SALT_OF_PASSPHRASE)
       │ → HKDF → AES-256-GCM key
       │
  Encrypt each chunk.data → "%=" + ciphertext
  Optionally: encrypt path, zero mtime/ctime/size
  Remap _id → "f:" + HMAC(path, SALT_OF_ID) if path obfuscation on
       │
       ▼
  EntryDoc { _id, children: [chunk_ids] }
  EntryLeaf { _id: "h:+...", data: "%=..." }
       │
       ▼
  PouchDB → _bulk_docs (new_edits: false) → CouchDB


READ PATH (CouchDB → device):

  _changes feed → parent EntryDoc received
       │
       ▼
  Fetch child EntryLeaf docs by ID
       │
       ▼  [if E2E enabled]
  AES-256-GCM decrypt each chunk.data (strip "%=" prefix)
  Decode obfuscated path → real file path
       │
       ▼
  Concatenate chunks in children[] order
       │
       ▼
  Write plaintext to Obsidian vault filesystem
```

---

## Typical Deployment Topology

```
                    Internet
                       │
              ┌────────▼────────┐
              │   DNS / CDN     │
              │ ckp.example.com │
              └────────┬────────┘
                       │ HTTPS :443
              ┌────────▼────────┐
              │   Caddy         │
              │  (TLS, reverse  │
              │   proxy)        │
              └─────┬─────┬─────┘
                    │     │
          /couchdb/ │     │ /  (API + UI)
                    │     │
         ┌──────────▼┐  ┌─▼──────────────┐
         │ CouchDB   │  │ CKP Backend    │
         │ :5984     │  │ FastAPI :8787  │
         └──────────┬┘  └──────┬─────────┘
                    │          │ _changes subscriber
                    │          │ (sync_monitor.py)
                    └──────────┘
                                │ materialise
                                ▼
                         vaults/<slug>/
                         (plaintext .md)
                                │
                         watcher.py
                                │
                         versioning.py
                                │
                         git commit

Mobile Clients                Desktop Clients
(Periodic sync,               (LiveSync mode,
 iOS/Android)                  continuous feed)
     │                               │
     └───────────────────────────────┘
                     │
                CouchDB /_changes
                + /_bulk_docs
```

**Multi-device propagation**: With N devices, each device has a PouchDB instance replicating to/from the same CouchDB database. CouchDB acts as the shared hub — there is no device-to-device direct connection (except in the experimental P2P/Trystero mode, which bypasses CouchDB entirely).

**Database naming**: CouchDB database = `{user_configured_name}-livesync-v2` (the `SuffixDatabaseName` constant). The CKP backend uses the project slug as the configured name, so the actual CouchDB DB is `<slug>-livesync-v2`.
