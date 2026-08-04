-- Token capabilities (KNOWN_ISSUES §0q — the primitive proposed instead of
-- partitioning Skill by project).
--
-- An allow-list of capability slugs per MCP token. EMPTY MEANS UNRESTRICTED,
-- so every existing token keeps precisely the authority it has today and there
-- is no backfill value to invent — the property whose absence was the reason
-- `Skill.ownerProjectId` was rejected.
--
-- Additive, NOT NULL with a default, no rewrite: `ADD COLUMN ... DEFAULT` is
-- metadata-only in PostgreSQL 11+, so this does not lock the table beyond the
-- brief ACCESS EXCLUSIVE that any ADD COLUMN takes.

-- AlterTable
ALTER TABLE "MCPToken" ADD COLUMN     "capabilities" TEXT[] NOT NULL DEFAULT '{}';
