-- Phase 2a: add slug to Project
--
-- Operator sequence for migrate deploy:
--   1. This file runs as a single transaction via `prisma migrate deploy`.
--      The slug backfill is embedded here so no manual step is required.
--   2. If you are running this against a DB with existing rows, the DO block
--      below handles uniqueness — duplicate slugs within the same org are
--      suffixed with -2, -3, etc.  Edge case: a name that is entirely
--      non-alphanumeric (e.g. "---") will receive slug 'project-<8 chars of id>'.

-- Step 1: add slug as nullable so the backfill can populate it.
ALTER TABLE "Project" ADD COLUMN "slug" TEXT;

-- Step 2: backfill — sluggify name, uniquify within org.
WITH base AS (
  SELECT
    id,
    "organizationId",
    lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) AS raw,
    row_number() OVER (
      PARTITION BY "organizationId",
                   lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
      ORDER BY "createdAt"
    ) AS rn
  FROM "Project"
),
slugged AS (
  SELECT
    id,
    CASE
      WHEN rn = 1 THEN trim(both '-' from raw)
      ELSE trim(both '-' from raw) || '-' || rn::text
    END AS slug
  FROM base
)
UPDATE "Project" p
SET slug = s.slug
FROM slugged s
WHERE p.id = s.id;

-- Step 3: handle empty-slug edge case (name was entirely non-alphanumeric).
UPDATE "Project"
SET slug = 'project-' || substr(id, 4, 8)
WHERE slug IS NULL OR slug = '';

-- Step 4: enforce NOT NULL.
ALTER TABLE "Project" ALTER COLUMN "slug" SET NOT NULL;

-- Step 5: unique index (org, slug).
CREATE UNIQUE INDEX "Project_organizationId_slug_key"
  ON "Project"("organizationId", "slug");
