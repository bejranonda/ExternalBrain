-- merge-duplicate-projects.sql
--
-- Repairs project-identity fragmentation: projects in the same organization
-- whose names differ only by case/whitespace/punctuation (the drift that
-- normalizeProjectName in @brain/core now prevents at create time) are merged
-- into one canonical project. Canonical = most Knowledge rows; ties broken by
-- oldest createdAt. See docs/superpowers/specs/2026-07-02-flywheel-repair-design.md §3.1.
--
-- DRY RUN (default — reports what would happen, changes nothing):
--   docker compose -p deploy exec -T db \
--     psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" \
--     < scripts/merge-duplicate-projects.sql
--
-- APPLY (mutates; take a verified backup first — operator authorization required):
--   ... psql ... -v apply=1 < scripts/merge-duplicate-projects.sql
--
-- Genuinely differently-named projects (e.g. "External Brain" vs
-- "Brain Platform") are NOT auto-detected. Merge one explicitly by id:
--   ... psql ... -v merge_from='<dupe Project.id>' -v merge_into='<canonical Project.id>' [-v apply=1] ...
-- (merge_from/merge_into must belong to the same organization; the pair is
-- added to the same plan and reported/applied identically.)
--
-- Idempotent: re-running after an apply finds no duplicates and does nothing.

BEGIN;

-- In-database write freeze for the duration of this transaction: SHARE ROW
-- EXCLUSIVE blocks concurrent INSERT/UPDATE/DELETE on every touched table
-- (reads still work), so no child row can appear between plan computation and
-- the mutations (MCPToken.projectId is onDelete: Cascade — a token created
-- mid-window would otherwise be silently deleted with its dupe project).
LOCK TABLE "Project", "Knowledge", "Session", "MCPToken", "AuditLog", "PeerCard"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE dupe_map ON COMMIT DROP AS
WITH normed AS (
  SELECT
    p.id,
    p."organizationId",
    p.name,
    p."createdAt",
    lower(regexp_replace(p.name, '[^a-zA-Z0-9]', '', 'g')) AS norm,
    (SELECT count(*) FROM "Knowledge" k WHERE k."ownerProjectId" = p.id) AS kn_count
  FROM "Project" p
),
ranked AS (
  SELECT
    normed.*,
    row_number() OVER (
      PARTITION BY "organizationId", norm
      ORDER BY kn_count DESC, "createdAt" ASC, id ASC
    ) AS rn
  FROM normed
  WHERE norm <> ''  -- all-punctuation names never match each other
)
SELECT
  d.id   AS dupe_id,
  d.name AS dupe_name,
  c.id   AS canonical_id,
  c.name AS canonical_name
FROM ranked d
JOIN ranked c
  ON c."organizationId" = d."organizationId"
 AND c.norm = d.norm
 AND c.rn = 1
WHERE d.rn > 1;

-- Operator-directed extra merge (differently-named projects, same org only).
\if :{?merge_from}
INSERT INTO dupe_map (dupe_id, dupe_name, canonical_id, canonical_name)
SELECT d.id, d.name, c.id, c.name
FROM "Project" d
JOIN "Project" c ON c."organizationId" = d."organizationId"
WHERE d.id = :'merge_from'
  AND c.id = :'merge_into'
  AND d.id <> c.id
  AND NOT EXISTS (SELECT 1 FROM dupe_map m WHERE m.dupe_id = d.id);
\endif

\echo ''
\echo '=== Merge plan (dupe -> canonical) ==='
SELECT dupe_name, dupe_id, canonical_name, canonical_id
FROM dupe_map
ORDER BY canonical_name, dupe_name;

\echo ''
\echo '=== Child rows that would move, per dupe ==='
SELECT
  m.dupe_name,
  (SELECT count(*) FROM "Knowledge" k WHERE k."ownerProjectId"  = m.dupe_id) AS knowledge_owned,
  (SELECT count(*) FROM "Knowledge" k WHERE k."originProjectId" = m.dupe_id) AS knowledge_origin,
  (SELECT count(*) FROM "Session"  s WHERE s."projectId"        = m.dupe_id) AS sessions,
  (SELECT count(*) FROM "MCPToken" t WHERE t."projectId"        = m.dupe_id) AS tokens,
  (SELECT count(*) FROM "AuditLog" a WHERE a."projectId"        = m.dupe_id) AS audit_logs,
  (SELECT count(*) FROM "PeerCard" pc WHERE pc."ownerProjectId" = m.dupe_id) AS peer_cards
FROM dupe_map m
ORDER BY m.dupe_name;

\if :{?apply}

\echo ''
\echo '=== APPLYING merge ==='

UPDATE "Knowledge" k SET "ownerProjectId" = m.canonical_id
  FROM dupe_map m WHERE k."ownerProjectId" = m.dupe_id;

UPDATE "Knowledge" k SET "originProjectId" = m.canonical_id
  FROM dupe_map m WHERE k."originProjectId" = m.dupe_id;

UPDATE "Session" s SET "projectId" = m.canonical_id
  FROM dupe_map m WHERE s."projectId" = m.dupe_id;

UPDATE "MCPToken" t SET "projectId" = m.canonical_id
  FROM dupe_map m WHERE t."projectId" = m.dupe_id;

UPDATE "AuditLog" a SET "projectId" = m.canonical_id
  FROM dupe_map m WHERE a."projectId" = m.dupe_id;

-- PeerCard has @@unique([ownerUserId, ownerProjectId]); drop dupe-side cards
-- whose owner already has a card on the canonical project, then move the rest.
DELETE FROM "PeerCard" pc
  USING dupe_map m
  WHERE pc."ownerProjectId" = m.dupe_id
    AND EXISTS (
      SELECT 1 FROM "PeerCard" pc2
      WHERE pc2."ownerUserId" IS NOT DISTINCT FROM pc."ownerUserId"
        AND pc2."ownerProjectId" = m.canonical_id
    );

UPDATE "PeerCard" pc SET "ownerProjectId" = m.canonical_id
  FROM dupe_map m WHERE pc."ownerProjectId" = m.dupe_id;

DELETE FROM "Project" p USING dupe_map m WHERE p.id = m.dupe_id;

\echo ''
\echo '=== Post-merge verification (all counts must be 0) ==='
SELECT
  (SELECT count(*) FROM "Project"  p WHERE p.id IN (SELECT dupe_id FROM dupe_map))                 AS remaining_dupe_projects,
  (SELECT count(*) FROM "Knowledge" k WHERE k."ownerProjectId"  IN (SELECT dupe_id FROM dupe_map)) AS stranded_knowledge_owned,
  (SELECT count(*) FROM "Knowledge" k WHERE k."originProjectId" IN (SELECT dupe_id FROM dupe_map)) AS stranded_knowledge_origin,
  (SELECT count(*) FROM "Session"  s WHERE s."projectId"        IN (SELECT dupe_id FROM dupe_map)) AS stranded_sessions,
  (SELECT count(*) FROM "MCPToken" t WHERE t."projectId"        IN (SELECT dupe_id FROM dupe_map)) AS stranded_tokens,
  (SELECT count(*) FROM "AuditLog" a WHERE a."projectId"        IN (SELECT dupe_id FROM dupe_map)) AS stranded_audit_logs,
  (SELECT count(*) FROM "PeerCard" pc WHERE pc."ownerProjectId" IN (SELECT dupe_id FROM dupe_map)) AS stranded_peer_cards;

COMMIT;
\echo 'Merge applied.'

\else

ROLLBACK;
\echo ''
\echo 'DRY RUN ONLY — nothing changed. Re-run with -v apply=1 to apply.'

\endif
