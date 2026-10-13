/**
 * Canary for the DB-gated suites. About twenty suites `describe.skip` when the
 * database is unreachable, so a broken CI service container would turn them
 * all into green skips. CI sets REQUIRE_TEST_DB=1 on the test step; there an
 * unreachable DB is a failure, not a skip. Locally the variable is unset and
 * this test is a no-op.
 */
import { describe, expect, it } from "vitest";
import { db } from "@brain/db";

describe("test database", () => {
  it.runIf(process.env.REQUIRE_TEST_DB === "1")("is reachable when CI requires it", async () => {
    await expect(db.$queryRaw`SELECT 1`).resolves.toBeDefined();
  });
});
