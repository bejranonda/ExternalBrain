#!/usr/bin/env node
/**
 * Enforce the package boundary: types → db → core → (mcp-server | web | worker).
 *
 * CLAUDE.md and GUIDELINES §1 have long said "violations fail CI", but until
 * 2026-10-11 nothing checked it — the rule held only because nobody had
 * broken it yet (KNOWN_ISSUES §0ay). Two independent checks, because each can
 * be broken without the other:
 *   1. package.json — no package declares a dependency it may not have;
 *   2. source — no import specifier reaches a forbidden package, whether by
 *      name (`@brain/web`) or by a relative path that walks into another
 *      package's directory (`../../apps/worker/src/x.js`).
 *
 * Usage: node scripts/check-package-boundaries.mjs   (exit 1 on violation)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Directory → package name, and what each package may import. */
const PACKAGES = {
  "packages/types": { name: "@brain/types", allow: [] },
  "packages/db": { name: "@brain/db", allow: ["@brain/types"] },
  "packages/core": { name: "@brain/core", allow: ["@brain/types", "@brain/db"] },
  "apps/mcp-server": { name: "@brain/mcp-server", allow: ["@brain/types", "@brain/db", "@brain/core"] },
  "apps/web": { name: "@brain/web", allow: ["@brain/types", "@brain/db", "@brain/core"] },
  "apps/worker": { name: "@brain/worker", allow: ["@brain/types", "@brain/db", "@brain/core"] },
};
const BY_NAME = Object.fromEntries(Object.entries(PACKAGES).map(([dir, p]) => [p.name, dir]));

const SKIP = new Set(["node_modules", "dist", ".next", ".turbo", "generated", "test-results", "playwright-report"]);
const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*)["']([^"']+)["']/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (SOURCE.test(name) && !name.endsWith(".d.ts")) yield p;
  }
}

/** Which package directory a path lies in, or null (repo root, scripts/, …). */
function packageOf(absPath) {
  const rel = relative(ROOT, absPath).split(sep).join("/");
  return Object.keys(PACKAGES).find((dir) => rel === dir || rel.startsWith(dir + "/")) ?? null;
}

const violations = [];

for (const [dir, pkg] of Object.entries(PACKAGES)) {
  const manifest = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies });
  for (const dep of declared.filter((d) => d.startsWith("@brain/"))) {
    if (!pkg.allow.includes(dep)) violations.push(`${dir}/package.json declares ${dep}`);
  }

  for (const file of files(join(ROOT, dir))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(SPECIFIER)) {
      const spec = m[1];
      let target = null;
      if (spec.startsWith("@brain/")) {
        const name = spec.split("/").slice(0, 2).join("/");
        target = BY_NAME[name] ?? null;
        if (!target) violations.push(`${relative(ROOT, file)} imports unknown package ${name}`);
      } else if (spec.startsWith(".")) {
        target = packageOf(resolve(dirname(file), spec));
      }
      if (!target || target === dir) continue;
      if (!pkg.allow.includes(PACKAGES[target].name)) {
        const line = src.slice(0, m.index).split("\n").length;
        violations.push(`${relative(ROOT, file)}:${line} → ${PACKAGES[target].name} ("${spec}")`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Package-boundary violations (types → db → core → apps; apps never import each other):");
  for (const v of violations) console.error(`  ✗ ${v}`);
  process.exit(1);
}
console.log(`package boundaries OK (${Object.keys(PACKAGES).length} packages)`);
