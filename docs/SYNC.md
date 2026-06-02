# LiveSync Bridge (optional, Phase 4)

For users who already maintain an Obsidian vault, we offer a two-way sync bridge so platform skills appear as notes in their vault and vice versa.

## Topology

```
Obsidian client (PouchDB) ──┐
                             ├── CouchDB (user-hosted or platform-hosted)
Brain Platform (Postgres) ──┘           │
                                         │  _changes subscriber
                                         ▼
                           apps/sync-bridge (long-running)
                                         │
                                         ▼
                                Platform Skills + Knowledge
```

## Key protocol decisions (stolen from LiveSync)

- **CouchDB is the sync substrate.** We do not invent our own protocol.
- **Content-addressed chunks.** Document bodies stored as `{_id: "h:<sha256>", type: "leaf", data}`. Saves ~40 % storage and enables structural sharing for skill versions.
- **Tombstones, not purges.** Deletion is a revision with `deleted: true`. Provenance survives.
- **Debounced commits.** Skill edits coalesced in a 2-second window to produce one logical write per burst.
- **Pull-only mode for server-authored vaults.** Team & community vaults default to pull-only — the platform writes through controlled APIs, not through clients pushing to CouchDB directly.

## Document shapes

```jsonc
// A skill note
{
  "_id": "skills/react-tailwind-dark-todo",
  "type": "newnote",
  "path": "skills/react-tailwind-dark-todo.md",
  "ctime": 1713600000,
  "mtime": 1713600100,
  "size": 2048,
  "deleted": false,
  "children": ["h:abc123...", "h:def456..."]
}

// A chunk
{
  "_id": "h:abc123...",
  "type": "leaf",
  "data": "---\ntitle: …\n---\n\n# React Tailwind Dark Todo …"
}
```

## Conflict resolution

- CouchDB MVCC. Two concurrent edits → two leaf revisions.
- On read, inspect `_conflicts`. Present both versions to the user in the UI.
- For frontmatter: prefer the rev with the later `mtime`.
- For body text: three-way merge via `diff-match-patch` with the nearest common ancestor.

## Setup (user-facing)

```bash
# 1. Provision CouchDB
docker run -p 5984:5984 -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=... apache/couchdb

# 2. Configure Brain Platform
echo "COUCHDB_URL=http://admin:...@localhost:5984" >> .env
echo "LIVESYNC_BRIDGE_ENABLED=true" >> .env

# 3. In Obsidian: install Self-hosted LiveSync plugin, point at same CouchDB

# 4. Start the bridge
pnpm --filter @brain/sync-bridge dev
```

Bridge subscribes to CouchDB `_changes` and materializes writes into the Postgres Skill table, while also serializing Postgres-originated skill writes back into CouchDB.
