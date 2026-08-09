#!/usr/bin/env node
/**
 * Bakes docs/tutorials/*.md into a TS module of string constants, run as
 * apps/web's build script's first step (chained in package.json, not a
 * `prebuild` lifecycle hook — pnpm's handling of implicit pre/post hooks
 * varies by version/config, and this repo shouldn't depend on that).
 *
 * Why codegen instead of `fs.readFileSync` at request time: this app's root
 * layout reads a cookie (`bp_lang`), which — per KNOWN_ISSUES.md — forces
 * EVERY route to render dynamically per-request rather than being served as
 * a cached static file, even routes with `generateStaticParams`. A runtime
 * `readFileSync` in that model runs on every live request, in a container
 * that never gets `docs/` copied into its final runtime stage (only the
 * builder stage has it — see deploy/Dockerfile). That combination 500s in
 * production. Baking content into the compiled bundle at build time — the
 * same thing docs-content.ts does by hand for concept pages — has zero
 * runtime disk I/O and needs nothing in the runtime image.
 *
 * Plain Node, no TS/tsx dependency: this script's own logic doesn't need
 * types, and `tsx` isn't a dependency of @brain/web (only of @brain/db) —
 * adding it just to run an 80-line file-reader would be tooling weight for
 * no real benefit.
 *
 * Output is gitignored (a build artifact, not source) and regenerated on
 * every build; do not hand-edit apps/web/lib/brain/tutorial-content.generated.ts.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const TUTORIALS_DIR = join(REPO_ROOT, "docs", "tutorials");
const OUT_FILE = join(REPO_ROOT, "apps", "web", "lib", "brain", "tutorial-content.generated.ts");

// Kept in sync with tutorial-meta.ts's TUTORIALS array by hand — both are
// short, stable lists that change only when a tutorial is added, and a
// generator reading tutorial-meta.ts back would need to parse TypeScript.
const FILES = [
  "00-quick-start",
  "01-getting-started",
  "02-asking-the-oracle",
  "03-teaching-knowledge",
  "04-managing-tokens",
  "05-exporting-rules",
  "06-troubleshooting",
  "07-skill-types-explained",
];
const LANGS = ["en", "th", "de"];

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const entries = [];
let missing = 0;

for (const file of FILES) {
  const en = readIfExists(join(TUTORIALS_DIR, `${file}.md`));
  if (en === null) {
    console.error(`✗ missing required EN source: docs/tutorials/${file}.md`);
    missing++;
    continue;
  }
  entries.push(`  "${file}.en": ${JSON.stringify(en)},`);

  for (const lang of LANGS) {
    if (lang === "en") continue;
    const localized = readIfExists(join(TUTORIALS_DIR, `${file}.${lang}.md`));
    if (localized !== null) {
      entries.push(`  "${file}.${lang}": ${JSON.stringify(localized)},`);
    }
  }
}

if (missing > 0) {
  console.error(`generate-tutorial-content: ${missing} required file(s) missing — aborting build.`);
  process.exit(1);
}

const header = `/**
 * GENERATED — do not edit by hand.
 * Source: docs/tutorials/*.md
 * Regenerate: node scripts/generate-tutorial-content.mjs
 * (also runs automatically as apps/web's \`build\` script, chained before \`next build\`)
 *
 * Keyed "<file>.<lang>" e.g. "00-quick-start.en". Only languages that have a
 * translated file on disk get an entry — tutorial-content.ts falls back to
 * ".en" when a "<file>.th" / "<file>.de" key is absent.
 */
export const TUTORIAL_MARKDOWN: Record<string, string> = {
${entries.join("\n")}
};
`;

writeFileSync(OUT_FILE, header, "utf8");
console.log(`✓ wrote ${OUT_FILE.replace(REPO_ROOT + "/", "")} (${entries.length} entries)`);
