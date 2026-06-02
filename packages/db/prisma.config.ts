/**
 * Prisma 7 config — supplies datasource.url for migration commands. The
 * runtime client construction in `src/index.ts` builds its own
 * @prisma/adapter-pg from the same DATABASE_URL.
 *
 * Reference: https://pris.ly/d/config-datasource
 */
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
  // Prisma 7 reads `seed` from here, not from `package.json`'s
  // `prisma.seed`. PR #246 wired the seed in package.json originally
  // and `prisma db seed` silently no-op'd against the live dev brain
  // — the seed step in `scripts/deploy.sh` printed "⚠️ No seed command
  // configured" and continued. Moving the config here is the Prisma 7
  // sanctioned location.
  // Reference: https://pris.ly/d/config-migrations-seed
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
