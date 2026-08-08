import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A voucher grants ONE isolated tenant per redeemer. Nothing may claim otherwise.
 *
 * `VoucherCode.kind` and `.organizationLabel` were settable through the API and
 * offered in the admin UI as "Organization" + a label field, and **neither is
 * read at redemption**. Every signup path — credentials and OAuth — calls
 * `ensurePersonalOrg(db, userId)`, which creates `org_${userId}`. So a voucher
 * minted as `organization` with the label "Acme Inc." still produced N separate
 * personal tenants, silently: every redemption succeeded, just not into the org
 * the operator intended. The only symptom was a team later discovering they
 * could not see each other's knowledge.
 *
 * Verified on production before this was closed off: two accounts redeeming the
 * same 60-seat code landed in `org_cmsk0ae15…` and `org_cmsk0aeez…`, each the
 * owner of their own org, sharing none.
 *
 * These are source-level assertions on purpose. The behaviour they protect
 * spans an API route, a React page and a bootstrap helper in @brain/core, and
 * the failure mode is a *missing* read rather than a wrong value — so there is
 * no runtime call that returns the wrong answer to catch. What can be caught is
 * the promise being re-added.
 */

const WEB = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(WEB, rel), "utf8");
}

describe("voucher tenancy", () => {
  it("the admin API accepts only personal-kind vouchers", () => {
    const src = read("app/api/admin/vouchers/route.ts");
    // A z.enum([...,"organization"]) here is the exact regression: it makes the
    // dead option reachable again by direct API call even if the UI hides it.
    expect(src).toMatch(/kind:\s*z\.literal\("personal"\)/);
    expect(src).not.toMatch(/z\.enum\(\[\s*"personal",\s*"organization"\s*\]\)/);
  });

  it("the admin API never persists an organizationLabel", () => {
    const src = read("app/api/admin/vouchers/route.ts");
    expect(src).toMatch(/organizationLabel:\s*null/);
    expect(src).not.toMatch(/organizationLabel:\s*body\./);
  });

  it("the admin UI does not offer an Organization kind", () => {
    const src = read("app/admin/vouchers/page.tsx");
    expect(src).not.toMatch(/<option value="organization">/);
  });

  it("the admin UI states that each redeemer gets an isolated tenant", () => {
    // Removing the broken option is not enough — an operator who wanted a
    // shared team tenant needs to be told where that actually lives, or they
    // will simply look for it somewhere else.
    const src = read("app/admin/vouchers/page.tsx");
    expect(src).toMatch(/isolated tenant/i);
    expect(src).toMatch(/invite/i);
  });

  it("registration bootstraps a personal org for every new user", () => {
    // This is the mechanism that makes the isolation true. If it ever becomes
    // conditional, the guarantee above stops holding.
    const src = read("app/api/auth/register/route.ts");
    expect(src).toMatch(/ensurePersonalOrg\(db,\s*newUserId\)/);
  });

  it("every OAuth/credentials sign-up path bootstraps a personal org too", () => {
    // The register route is not the only way an account is created; the
    // NextAuth callbacks create users as well. All of them must bootstrap.
    const src = read("auth.ts");
    const calls = src.match(/ensurePersonalOrg\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});
