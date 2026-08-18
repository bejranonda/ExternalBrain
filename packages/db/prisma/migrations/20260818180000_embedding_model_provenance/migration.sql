-- Embedding provenance.
--
-- Vectors produced by different embedding models are not comparable: measured
-- cosine similarity for the SAME sentence across gemini-embedding-001 and
-- gemini-embedding-2-preview was -0.024 (orthogonal). Before this column the
-- backfill only filled `embedding IS NULL`, so changing the model left a
-- silently mixed index — new query vectors scored ~0 against every existing
-- row, with no error anywhere. Recording which model produced each vector is
-- what makes a model change detectable, and therefore repairable.
--
-- NULL means "written before this column existed"; the backfill treats NULL
-- as stale and re-embeds it, which converges the table onto one model.

ALTER TABLE "Knowledge" ADD COLUMN IF NOT EXISTS "embeddingModel" TEXT;
ALTER TABLE "Skill"     ADD COLUMN IF NOT EXISTS "embeddingModel" TEXT;

-- Partial indexes: the backfill's hot query is "rows needing work", which is
-- a small slice of the table. Indexing only the rows that still have a vector
-- keeps these tiny while making the staleness scan cheap.
CREATE INDEX IF NOT EXISTS "Knowledge_embeddingModel_idx"
  ON "Knowledge" ("embeddingModel")
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Skill_embeddingModel_idx"
  ON "Skill" ("embeddingModel")
  WHERE embedding IS NOT NULL;
