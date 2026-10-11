import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every env var a service's code reads must be delivered to that service.
 *
 * Compose passes a container ONLY the names in its `environment:` block (no
 * service uses `env_file:`), so a var read by code but not named there is a
 * setting the operator can change in `.env` with no effect and no error. That
 * shape has shipped repeatedly: BRAIN_DEPLOY_ENV made a production guard inert
 * (§0ax); MAX_ORACLE_COST_USD_PER_DAY and PG_BOSS_SCHEMA never reached
 * mcp-server, KEA_MODEL never reached web, CROSS_SESSION_* / KEA_REFINE_MODEL
 * reached nothing (§0ay). `compose-forwards-flags.test.ts` already covered
 * web's `envFlag` reads; this generalises it to every service and every read.
 *
 * Two sources of reads:
 *  - each app's own source — scanned, so a new read is checked automatically;
 *  - packages/core + packages/db — shared code that runs in several
 *    services. Import-graph reachability through the `@brain/core` barrel is
 *    not decidable by grep, so CORE_CONSUMERS declares which services run
 *    each var's code path, and a sweep fails on any core read the manifest
 *    has not classified. A new core read therefore forces a decision.
 */

const REPO = join(__dirname, "..", "..", "..", "..");
const COMPOSE = readFileSync(join(REPO, "deploy", "docker-compose.yml"), "utf8");

type Service = "web" | "mcp-server" | "worker" | "bootstrap";
const APPS: Service[] = ["web", "mcp-server", "worker"];
const LLM: Service[] = ["web", "mcp-server", "worker"];
const EMBED: Service[] = ["web", "mcp-server", "worker", "bootstrap"];
const ORACLE: Service[] = ["web", "mcp-server"];

/** Core/db env reads → the services whose code path reaches them. */
const CORE_CONSUMERS: Record<string, Service[]> = {
  DATABASE_URL: ["web", "mcp-server", "worker", "bootstrap"],
  // llm.ts — every LLM caller (web: oracle + meeting extract; mcp: oracle; worker: KEA).
  ANTHROPIC_API_KEY: EMBED,
  ANTHROPIC_BASE_URL: EMBED,
  DASHSCOPE_API_KEY: LLM,
  OPENAI_API_KEY: EMBED,
  BILLING_MODE: EMBED,
  // embedding.ts — teach/retrieve/oracle/backfill.
  EMBEDDING_API_KEY: EMBED,
  EMBEDDING_BASE_URL: EMBED,
  EMBEDDING_DIMENSIONS: EMBED,
  EMBEDDING_MODEL: EMBED,
  GOOGLE_GEMINI_API_KEY: EMBED,
  GEMINI_API_KEY: EMBED,
  // oracle.ts + cost.ts — both Oracle doors.
  ORACLE_MODEL: [...ORACLE, "worker"], // worker: KEA cross-session falls back to it
  V2_ORACLE_TASKS: ORACLE,
  MAX_ORACLE_COST_USD_PER_DAY: ORACLE,
  // kea.ts / autoskill-classifier.ts — worker only.
  KEA_MODEL: ["worker"],
  KEA_REFINE_MODEL: ["worker"],
  CROSS_SESSION_KEA_MODEL: ["worker"],
  CROSS_SESSION_WINDOW: ["worker"],
  AUTOSKILL_MODEL: ["worker"],
  AUTOSKILL_SHADOW: ["worker"],
  AUTOSKILL_LLM_CLASSIFIER: ["worker"],
  AUTOSKILL_CLASSIFY_MAX: ["worker"],
  AUTOSKILL_FEWSHOT_TOKEN_BUDGET: ["worker"],
  // email.ts — only web sends mail.
  EMAIL_PROVIDER: ["web"],
  EMAIL_API_KEY: ["web"],
  EMAIL_FROM: ["web"],
  EMAIL_REPLY_TO: ["web"],
  RESEND_API_KEY: ["web"],
  RESEND_API: ["web"],
  // logger.ts
  LOG_LEVEL: APPS,
  SENTRY_DSN: APPS,
  SENTRY_TRACES_SAMPLE_RATE: APPS,
};

/**
 * Reads that legitimately need no compose entry. Each needs a reason a
 * reviewer can check — an unexplained entry here is the bug this file exists
 * to catch, wearing a disguise.
 */
const NOT_FROM_COMPOSE: Record<string, string> = {
  NODE_ENV: "set by the Dockerfile stage",
  PORT: "set by the Dockerfile (web)",
  HOSTNAME: "set by the Dockerfile (web)",
  MCP_TRANSPORT: "set by the Dockerfile (mcp-server)",
  MCP_SERVER_HTTP_PORT: "set by the Dockerfile (mcp-server)",
  SKIP_DB_INIT: "build-time only (next build)",
  NEXT_RUNTIME: "set by Next.js itself",
  BRAIN_MCP_TOKEN: "stdio transport only; the container runs http",
  INTERNAL_SELF_ORIGIN: "optional override; the loopback default is correct in the container",
  NEXTAUTH_URL: "Auth.js v4 name, read only as a last-resort fallback after AUTH_URL",
  WORKER_HEALTH_PORT: "default 9091 is what the compose healthcheck probes; changing it alone would break the probe",
  CI: "test/CI environments only",
};

const APP_ROOTS: Record<Exclude<Service, "bootstrap">, string> = {
  web: join(REPO, "apps", "web"),
  "mcp-server": join(REPO, "apps", "mcp-server", "src"),
  worker: join(REPO, "apps", "worker", "src"),
};

const SKIP = new Set(["node_modules", ".next", "dist", "generated", "e2e", "tests", ".turbo", "__tests__"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/(\.d|\.config)\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const READ_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g,
  /process\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g,
  /env(?:Flag|Int)\(\s*["']([A-Z][A-Z0-9_]+)["']/g,
  // envForWeb()/envForMcp()/envForWorker() results, conventionally `env`.
  /\benv(?:For[A-Z]\w*\(\))?\.([A-Z][A-Z0-9_]{2,})\b/g,
];

function readsIn(files: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const re of READ_PATTERNS) {
      for (const m of src.matchAll(re)) {
        const name = m[1]!;
        if (name.startsWith("NEXT_PUBLIC_")) continue; // inlined at build time
        if (!found.has(name)) found.set(name, relative(REPO, f));
      }
    }
  }
  return found;
}

function serviceBlock(name: Service): string {
  const start = COMPOSE.indexOf(`\n  ${name}:\n`);
  expect(start, `no \`${name}:\` service in docker-compose.yml`).toBeGreaterThan(-1);
  const rest = COMPOSE.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 3);
}

const delivered = (svc: Service, name: string) =>
  new RegExp(`^\\s*${name}:`, "m").test(serviceBlock(svc));

describe("compose delivers every env var each service reads", () => {
  for (const svc of Object.keys(APP_ROOTS) as Array<keyof typeof APP_ROOTS>) {
    it(`${svc}: its own source's reads`, () => {
      const reads = readsIn(sources(APP_ROOTS[svc]));
      expect(reads.size, "vacuous sweep — the read patterns matched nothing").toBeGreaterThan(3);
      const missing = [...reads]
        .filter(([n]) => !(n in NOT_FROM_COMPOSE) && !delivered(svc, n))
        .map(([n, f]) => `${n} (read in ${f})`);
      expect(missing, `Add each to the \`${svc}:\` environment block as NAME: \${NAME:-<default>}`).toEqual([]);
    });
  }

  it("every core/db env read is classified in CORE_CONSUMERS", () => {
    const reads = readsIn([
      ...sources(join(REPO, "packages", "core", "src")),
      ...sources(join(REPO, "packages", "db", "src")),
    ]);
    expect(reads.size).toBeGreaterThan(10);
    const unclassified = [...reads]
      .filter(([n]) => !(n in CORE_CONSUMERS) && !(n in NOT_FROM_COMPOSE))
      .map(([n, f]) => `${n} (read in ${f})`);
    expect(
      unclassified,
      "New env read in shared code: add it to CORE_CONSUMERS with the services whose code path reaches it",
    ).toEqual([]);
  });

  it("each service receives the core vars its code path reads", () => {
    const missing: string[] = [];
    for (const [name, svcs] of Object.entries(CORE_CONSUMERS)) {
      for (const svc of svcs) if (!delivered(svc, name)) missing.push(`${name} → ${svc}`);
    }
    expect(missing).toEqual([]);
  });

  it("no direct env read falls back with `??` (empty string is not absent)", () => {
    // `X: ${X:-}` delivers "" — and `process.env.X ?? fallback` keeps it,
    // turning an unset model into model "" and an unset window into
    // Number("") === 0. `||` is the correct operator for env strings.
    const files = [
      ...Object.values(APP_ROOTS).flatMap((d) => sources(d)),
      ...sources(join(REPO, "packages", "core", "src")),
      ...sources(join(REPO, "packages", "db", "src")),
    ];
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/process\.env(?:\.[A-Z0-9_]+|\[["'][A-Z0-9_]+["']\])(?:\?\.\w+\([^)]*\))?\s*\?\?/.test(line)) {
          offenders.push(`${relative(REPO, f)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
