/**
 * The sunset settings reach all three services that read them
 * (docs/SUNSET.md). Compose forwards only what it names, and a notice that
 * the operator configured but no container received is the silent-off failure
 * `compose-forwards-flags.test.ts` exists for — asserted per service here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const compose = readFileSync(join(__dirname, "..", "..", "..", "..", "deploy", "docker-compose.yml"), "utf8");

function serviceBlock(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, `service ${name}`).toBeGreaterThan(0);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const SUNSET = ["SERVICE_SUNSET_AT", "SERVICE_SUNSET_DELETE_AT", "SERVICE_SUNSET_KIND"];

describe("compose forwards the sunset settings", () => {
  it.each(["web", "mcp-server", "worker"])("%s", (svc) => {
    const block = serviceBlock(svc);
    for (const v of SUNSET) expect(block, `${svc} ${v}`).toContain(`${v}: \${${v}:-}`);
  });
  it("the worker, which sends the notice emails, gets email delivery and the public URL", () => {
    const block = serviceBlock("worker");
    for (const v of ["SERVICE_SUNSET_EMAILS", "EMAIL_PROVIDER", "EMAIL_API_KEY", "RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO", "BRAIN_PUBLIC_HOSTNAME"]) {
      expect(block, v).toContain(`${v}:`);
    }
  });
});
