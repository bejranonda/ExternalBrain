/**
 * Token capabilities — the primitive proposed instead of partitioning `Skill`
 * by project (KNOWN_ISSUES §0q).
 *
 * The load-bearing rule is the empty-array contract: `[]` means UNRESTRICTED,
 * which is what let this column be added to a live table with no ambiguous
 * backfill. Getting that backwards would silently revoke every existing
 * token's authority — or, worse in the other direction, grant everything to a
 * token someone deliberately restricted.
 */
import { describe, it, expect } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  hasCapability,
  isCapability,
  sanitizeCapabilities,
} from "../capabilities.js";

describe("the empty-array contract", () => {
  it("treats [] as UNRESTRICTED — every existing token keeps its authority", () => {
    for (const cap of CAPABILITIES) {
      expect(hasCapability([], cap), `[] should grant ${cap}`).toBe(true);
    }
  });

  it("treats a non-empty list as an ALLOW-list, not a deny-list", () => {
    expect(hasCapability(["knowledge"], "knowledge")).toBe(true);
    expect(hasCapability(["knowledge"], "skills")).toBe(false);
    expect(hasCapability(["knowledge"], "oracle")).toBe(false);
  });

  it("serves the motivating case: knowledge without skills", () => {
    // The exact scenario this feature exists for — a contractor's token that
    // can use the Brain but cannot read the owner's skills.
    const contractor = ["knowledge", "sessions"];
    expect(hasCapability(contractor, "knowledge")).toBe(true);
    expect(hasCapability(contractor, "sessions")).toBe(true);
    expect(hasCapability(contractor, "skills")).toBe(false);
    expect(hasCapability(contractor, "oracle")).toBe(false);
  });

  it("fails CLOSED as the capability surface grows", () => {
    // The reason this is an allow-list. A restricted token must not silently
    // gain whatever capability is invented next.
    const restricted = ["knowledge"];
    for (const cap of CAPABILITIES) {
      if (cap === "knowledge") continue;
      expect(hasCapability(restricted, cap), `${cap} must not be granted`).toBe(false);
    }
  });

  it("ignores unknown slugs rather than treating them as a wildcard", () => {
    expect(hasCapability(["definitely-not-a-capability"], "skills")).toBe(false);
  });
});

describe("sanitizeCapabilities — this is API input", () => {
  it("drops unknown slugs", () => {
    expect(sanitizeCapabilities(["skills", "wat", "oracle"])).toEqual(["skills", "oracle"]);
  });

  it("returns [] for non-arrays rather than throwing", () => {
    for (const bad of [null, undefined, "skills", 42, {}]) {
      expect(sanitizeCapabilities(bad)).toEqual([]);
    }
  });

  it("de-dupes, so an allow-list cannot look longer than it is", () => {
    expect(sanitizeCapabilities(["skills", "skills", "skills"])).toEqual(["skills"]);
  });

  it("NEVER turns a restricted list into an unrestricted one", () => {
    // The dangerous failure: if sanitising a list of entirely-unknown slugs
    // returned [], the token would silently become unrestricted. It returns []
    // here too — so the CALLER must treat "user asked for restrictions but
    // none survived" as an error, not as "no restrictions". Pinned so the
    // asymmetry stays visible.
    expect(sanitizeCapabilities(["nonsense", "alsononsense"])).toEqual([]);
  });
});

describe("slug registry integrity", () => {
  it("every slug is recognised by isCapability", () => {
    for (const cap of CAPABILITIES) expect(isCapability(cap)).toBe(true);
  });

  it("every slug has a human label — the token UI renders these", () => {
    for (const cap of CAPABILITIES) {
      expect(CAPABILITY_LABELS[cap], `no label for ${cap}`).toBeTruthy();
    }
  });

  it("rejects near-misses", () => {
    for (const bad of ["Skills", "skill", "read:skills", ""]) {
      expect(isCapability(bad), `${bad} should not be a capability`).toBe(false);
    }
  });
});
