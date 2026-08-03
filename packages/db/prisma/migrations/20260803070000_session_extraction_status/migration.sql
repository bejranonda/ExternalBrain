-- Session extraction status (pre-release audit P3-R3, KNOWN_ISSUES §0q).
--
-- Records whether the KEA extraction pipeline ran for a session, separately
-- from `outcome` — which is the CLIENT's report of whether the user's coding
-- task succeeded. Before this, a session whose extraction failed all three
-- retries still read `outcome = 'success'` with no knowledge extracted, so the
-- dashboard counted it as productive and the flywheel metric counted a session
-- that taught nothing.
--
-- All three columns are nullable with no default and no backfill: existing
-- rows correctly read "extraction status unknown" rather than being asserted
-- to have succeeded. Additive only — no rewrite, no lock beyond the brief
-- ACCESS EXCLUSIVE that ADD COLUMN ... NULL takes in Postgres 11+.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "extractionStatus" TEXT,
ADD COLUMN     "extractionError" VARCHAR(500),
ADD COLUMN     "extractionAt" TIMESTAMP(3);
