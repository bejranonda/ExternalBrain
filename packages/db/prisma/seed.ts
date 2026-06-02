/**
 * Idempotent seed for local dev + CI e2e (#236).
 *
 * Produces exactly the quantities the playwright suite asserts against:
 *   - 1 admin user (Alex)
 *   - 1 organization + 1 default project
 *   - 6 closed sessions (mix of success/failure outcomes)
 *   - 16 skills (Knowledge rows of mixed types) — matches onboarding.spec.ts
 *     and skills.spec.ts "list has 16 items" assertions; the count must
 *     stay >= 16 so the onboarding-modal auto-open path stays dormant in
 *     normal runs (the auto-open case is tested via API mock instead)
 *   - 4 pending AutoskillProposals
 *
 * Re-runnable: every write goes through `upsert` with deterministic ids,
 * so a second run is a no-op (no duplicates, no broken state).
 *
 * NEVER run on prod. `scripts/deploy-prod.sh` sets `SEED_ON_DEPLOY=false`
 * explicitly to skip. `scripts/deploy.sh` defaults to true but the
 * variable is overrideable for local dev who wants a clean DB.
 *
 * Wired via `packages/db/prisma.config.ts` `migrations: { seed: ... }`
 * (Prisma 7 location — `package.json#prisma.seed` was deprecated and
 * silently no-op'd during the initial PR #246 deploy).
 * Invoked by `pnpm --filter @brain/db exec prisma db seed`.
 */
import { PrismaClient } from "../src/generated/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires an explicit driver adapter — `new PrismaClient()`
// alone throws because the engine layer was replaced by the adapter
// pattern in v7. Match `packages/db/src/index.ts` so the seed's
// connection lifecycle behaves identically to the runtime singleton.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "",
});
const db = new PrismaClient({ adapter });

// Deterministic ids so the seed is fully idempotent. cuid-looking
// strings used so they pass any cuid validation the schema implies.
const ALEX_ID = "seed_alex_____________________";
const ORG_ID = "seed_org_personal____________";
const PROJECT_ID = "seed_project_default_________";

async function seedUser(): Promise<void> {
  await db.user.upsert({
    where: { id: ALEX_ID },
    create: {
      id: ALEX_ID,
      email: "alex@brain.local",
      name: "Alex",
      role: "admin",
    },
    update: { role: "admin" },
  });
}

async function seedOrgAndProject(): Promise<void> {
  await db.organization.upsert({
    where: { id: ORG_ID },
    create: { id: ORG_ID, slug: "alex-personal", name: "Alex (personal)" },
    update: {},
  });
  // Alex is owner of his personal org (role=owner per OrganizationMember).
  await db.organizationMember.upsert({
    where: { orgId_userId: { orgId: ORG_ID, userId: ALEX_ID } },
    create: { orgId: ORG_ID, userId: ALEX_ID, role: "owner" },
    update: { role: "owner" },
  });
  await db.project.upsert({
    where: { id: PROJECT_ID },
    create: {
      id: PROJECT_ID,
      organizationId: ORG_ID,
      ownerUserId: ALEX_ID,
      name: "Default",
      slug: "default",
      framework: "nextjs",
      language: "typescript",
    },
    update: {},
  });
}

async function seedSessions(): Promise<void> {
  // 6 sessions; deterministic ids; mix of outcomes; all closed so KEA
  // would normally fire (but the seed doesn't trigger pg-boss jobs).
  const outcomes = ["success", "success", "success", "success", "partial", "failed"] as const;
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const id = `seed_session_${i.toString().padStart(2, "0")}_______`;
    const startedAt = new Date(now - (6 - i) * 86_400_000);
    const endedAt = new Date(startedAt.getTime() + 30 * 60_000);
    await db.session.upsert({
      where: { id },
      create: {
        id,
        userId: ALEX_ID,
        projectId: PROJECT_ID,
        clientType: "claude_code",
        startedAt,
        endedAt,
        outcome: outcomes[i],
      },
      update: { endedAt, outcome: outcomes[i] },
    });
  }
}

async function seedKnowledge(): Promise<void> {
  // 16 Knowledge rows matching the test assertion in skills.spec.ts /
  // onboarding.spec.ts. Spread across the 5 types so the dashboard's
  // KnowledgeTypes panel has rows for each. Scope=user so they retrieve
  // without projectId (per the #218 fix). Embeddings are NULL — the
  // worker's backfill job populates them within 10 minutes; tests that
  // need them can wait or run after the deploy.
  const rules: Array<{
    type: "reflex" | "recipe" | "heuristic" | "principle" | "anti_principle";
    trigger: string;
    rule: string;
    rationale: string;
  }> = [
    { type: "reflex", trigger: "writing TypeScript", rule: "Always end files with a newline", rationale: "POSIX compatibility" },
    { type: "reflex", trigger: "calling fetch in Node", rule: "Wrap in try/catch — fetch never rejects on HTTP errors", rationale: "Common JS footgun" },
    { type: "reflex", trigger: "committing to git", rule: "Run prettier before committing", rationale: "Avoids spurious diffs from whitespace" },
    { type: "recipe", trigger: "building a React form", rule: "Use react-hook-form + zod resolver for typed validation", rationale: "Best-in-class form library combo" },
    { type: "recipe", trigger: "adding a new Prisma migration", rule: "Run prisma migrate dev locally, then squash if needed before PR", rationale: "Keeps migrations atomic" },
    { type: "recipe", trigger: "Deno or Bun env detection", rule: "Use process.versions.bun ?? process.versions.deno", rationale: "Single-source-of-truth runtime check" },
    { type: "heuristic", trigger: "debugging a flaky test", rule: "Run with --repeat-each=10 first to confirm it's actually flaky", rationale: "Cheap and decisive" },
    { type: "heuristic", trigger: "naming a new function", rule: "Prefer verb-first if it returns void, noun-first if it returns a value", rationale: "Reads like English at the call site" },
    { type: "heuristic", trigger: "choosing log level", rule: "info for happy-path lifecycle, warn for self-recovered errors, error for crashes", rationale: "Matches operator expectations on log scanning" },
    { type: "principle", trigger: "designing a new API", rule: "Make invalid states unrepresentable in the type system", rationale: "Catches whole classes of bugs at compile time" },
    { type: "principle", trigger: "writing tests", rule: "Test behavior, not implementation", rationale: "Refactoring shouldn't break tests" },
    { type: "principle", trigger: "naming things", rule: "Prefer specific over generic", rationale: "future-readers benefit; you won't be there to explain" },
    { type: "anti_principle", trigger: "wanting a shared mutable global", rule: "Don't use module-level mutable state for caches", rationale: "Hard to test, hard to invalidate, race-prone" },
    { type: "anti_principle", trigger: "writing error handling", rule: "Don't swallow errors with empty catch blocks", rationale: "Hides bugs and makes incidents undiagnosable" },
    { type: "anti_principle", trigger: "using setTimeout for sync", rule: "Don't await in a loop when you could Promise.all", rationale: "Wastes wall time when concurrent dispatch is possible" },
    { type: "reflex", trigger: "writing a new React component", rule: "Co-locate the component, its test, and its styles in one directory", rationale: "Speeds navigation; makes the move/delete unit atomic" },
  ];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]!;
    const id = `seed_knowledge_${i.toString().padStart(2, "0")}_____`;
    await db.knowledge.upsert({
      where: { id },
      create: {
        id,
        type: r.type,
        scope: "user",
        ownerUserId: ALEX_ID,
        ownerProjectId: PROJECT_ID,
        triggerText: r.trigger,
        ruleText: r.rule,
        rationale: r.rationale,
        confidence: 0.85,
        tags: ["seed"],
        extractedBy: "imported",
        visibility: "project",
      },
      update: {},
    });
  }
}

async function seedAutoskillProposals(): Promise<void> {
  // 4 pending proposals so autoskill.spec's "seed has 4" matches.
  // Each anchored to a different session for realistic dispersal.
  const proposals = [
    { confidence: "high", target: "knowledge", reasoning: "Pattern detected across 3 sessions: user consistently uses zod for validation." },
    { confidence: "high", target: "knowledge", reasoning: "User has rejected `var` declarations 5 times in the last week." },
    { confidence: "medium", target: "skill", reasoning: "Useful skill candidate: 'configure pg-boss for crash-safe worker'." },
    { confidence: "medium", target: "rules", reasoning: "Recurring lint config: dropped `no-console` rule in 3 of 4 projects." },
  ];
  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i]!;
    const id = `seed_proposal_${i.toString().padStart(2, "0")}______`;
    await db.autoskillProposal.upsert({
      where: { id },
      create: {
        id,
        userId: ALEX_ID,
        sessionId: `seed_session_${i.toString().padStart(2, "0")}_______`,
        target: p.target,
        confidence: p.confidence,
        diff: `+ /* ${p.reasoning} */`,
        patch: { kind: p.target, summary: p.reasoning },
        reasoning: p.reasoning,
        status: "pending",
      },
      update: {},
    });
  }
}

async function main(): Promise<void> {
  console.log("[seed] starting…");
  await seedUser();
  await seedOrgAndProject();
  await seedSessions();
  await seedKnowledge();
  await seedAutoskillProposals();
  console.log(
    "[seed] done — 1 user (Alex/admin), 1 org, 1 project, 6 sessions, 16 knowledge rows, 4 autoskill proposals",
  );
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
