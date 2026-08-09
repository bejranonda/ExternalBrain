import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENTS } from "@brain/core/install-snippets";

/**
 * The landing page names supported clients. That is a list of N things which
 * is already owned elsewhere — `CLIENTS` in `@brain/core/install-snippets`,
 * from which the token wizard, the `/welcome` picker, both installers and the
 * `--client` tables all derive.
 *
 * A hand-written list on the landing page would be the §0u defect again: five
 * of eleven clients shipped a config shape no client accepts, each surface
 * looking correct in isolation. A marketing page is the *most* likely surface
 * to go stale, because nothing breaks when it does — it just quietly advertises
 * a tool you dropped, or omits one you added.
 */

const LANDING = join(__dirname, "..", "..", "components", "brain", "landing.tsx");

describe("the landing page derives its client list", () => {
  const src = readFileSync(LANDING, "utf8");

  it("imports the registry", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bCLIENTS\b[^}]*\}\s*from\s*"@brain\/core\/install-snippets"/);
  });

  it("does not hardcode any client display name", () => {
    // Trimmed the same way the page trims them, so this compares like with
    // like: a page listing "Cursor" in prose is the failure we're catching.
    const names = CLIENTS.map((c) => c.label.split(/[—(]/)[0]!.trim()).filter(
      // "Other MCP-aware client" / "Non-MCP tool" are escape hatches whose
      // words legitimately appear in prose; they are never showcased chips.
      (n) => !/^(Other|Non-MCP)/.test(n),
    );
    const hardcoded = names.filter((n) => src.includes(`"${n}"`) || src.includes(`>${n}<`));
    expect(
      hardcoded,
      "These client names are written into landing.tsx literally. Derive them " +
        "from CLIENTS instead so adding or retiring a client updates the page.",
    ).toEqual([]);
  });

  it("excludes retired and escape-hatch clients by id, not by label text", () => {
    // Matching on label prose ("… retired …") would break the moment someone
    // rewords a label; ids are the wire contract and a rename is a type error.
    expect(src).toMatch(/NOT_SHOWCASED[\s\S]{0,120}"gemini-cli"/);
    expect(src).toContain("Set<ClientId>");
  });

  it("still has clients left to show after the exclusions", () => {
    // Guards the vacuous case: an exclusion set that grew to cover everything
    // would render an empty row and pass every assertion above.
    const excluded = new Set(["gemini-cli", "generic", "rest"]);
    const shown = CLIENTS.filter((c) => !excluded.has(c.id));
    expect(shown.length).toBeGreaterThanOrEqual(5);
  });
});
