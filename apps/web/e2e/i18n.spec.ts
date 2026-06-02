import { test, expect } from "@playwright/test";

const SURFACES = ["dashboard", "oracle", "skills", "graph", "autoskill", "sessions"] as const;

// Languages available in the app. TH and DE restored after user feedback —
// the partial-translation problem is now solved by translating new keys
// (empty_hint, ingest_ok_zero) added during the UI revision.
const LANGUAGES = ["en", "th", "de"] as const;

async function setLanguage(
  page: import("@playwright/test").Page,
  lang: "en" | "th" | "de",
) {
  // Set the language via tweaks localStorage so we don't have to open the panel every time.
  await page.evaluate((l) => {
    try {
      const stored = window.localStorage.getItem("bp_tweaks");
      const parsed = stored ? (JSON.parse(stored) as Record<string, string>) : {};
      window.localStorage.setItem("bp_tweaks", JSON.stringify({ ...parsed, language: l }));
    } catch {
      /* ignore */
    }
  }, lang);
}

test.describe("i18n: no missing-key fallbacks across all surfaces", () => {
  for (const lang of LANGUAGES) {
    test.describe(`language: ${lang}`, () => {
      test.beforeEach(async ({ page }) => {
        // Clear tweaks then set the language before navigation
        await page.addInitScript(
          (l) => {
            try {
              window.localStorage.setItem("bp_tweaks", JSON.stringify({ language: l }));
            } catch {
              /* ignore */
            }
          },
          lang,
        );
      });

      for (const surface of SURFACES) {
        test(`${surface} renders no undefined keys`, async ({ page }) => {
          await page.goto(`/#${surface}`);
          await expect(page.locator(`[data-screen-label="${surface}"]`)).toBeVisible({
            timeout: 15_000,
          });
          // Allow the component to fully hydrate
          await page.waitForTimeout(500);

          // Check that no user-visible text contains literal "undefined"
          // Strategy: gather all text content from the page and search for the pattern.
          // We exclude script/style/meta tags to focus on visible UI text.
          const hasUndefined = await page.evaluate(() => {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode(node) {
                  const parent = node.parentElement;
                  if (!parent) return NodeFilter.FILTER_REJECT;
                  const tag = parent.tagName.toLowerCase();
                  if (["script", "style", "noscript"].includes(tag)) {
                    return NodeFilter.FILTER_REJECT;
                  }
                  return NodeFilter.FILTER_ACCEPT;
                },
              },
            );

            const undefinedOccurrences: string[] = [];
            let node: Node | null;
            while ((node = walker.nextNode()) !== null) {
              const text = node.textContent?.trim() ?? "";
              if (text === "undefined" || text.startsWith("undefined.")) {
                undefinedOccurrences.push(text);
              }
            }
            return undefinedOccurrences;
          });

          expect(
            hasUndefined,
            `Surface "${surface}" in lang "${lang}" has undefined key(s): ${hasUndefined.join(", ")}`,
          ).toHaveLength(0);
        });
      }

      test("html[lang] attribute matches the selected language", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator('[data-screen-label]')).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(500);

        const htmlLang = await page.evaluate(() => document.documentElement.getAttribute("lang"));
        expect(htmlLang).toBe(lang);
      });
    });
  }
});
