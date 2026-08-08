"use client";

import Link from "next/link";
import { CLIENTS, type ClientId } from "@brain/core/install-snippets";
import { useT } from "@/lib/brain/i18n";
import { APP_VERSION, REPO_URL, RELEASES_URL, repoDocUrl } from "@/lib/brain/version";

/**
 * `/` for anonymous visitors — the platform's front page.
 *
 * Until now `/` was a router, not a page: signed out you got
 * `redirect("/signin")`, so the product had no public face at all and a
 * stranger's first impression was a login form.
 *
 * Its job is to ROUTE, not to inform. Everything substantial already exists —
 * `/docs` has the concept pages, `docs/tutorials/` has the walkthroughs, the
 * README has the full pitch. Re-stating any of it here would create the exact
 * drift this repo keeps paying for (KNOWN_ISSUES §0c: one value rendered by
 * several surfaces, corrected in some of them). So: a claim, two doors, four
 * short highlights, and links out. Resist adding sections.
 */

/**
 * Clients deliberately kept off the showcase row, by id so a rename in
 * `@brain/core` is a compile error rather than a silently stale landing page:
 *  - `gemini-cli` is retired (superseded by Antigravity, 2026-06-18)
 *  - `generic` and `rest` are escape hatches, not products — the copy covers
 *    them with "anything else that speaks MCP".
 */
const NOT_SHOWCASED = new Set<ClientId>(["gemini-cli", "generic", "rest"]);

/**
 * Registry labels carry disambiguating detail a landing page shouldn't
 * ("GitHub Copilot — JetBrains / Visual Studio / Eclipse / Xcode"). Trim at the
 * first em-dash or paren and de-duplicate, so the three Copilot rows collapse
 * to one name. Deriving-then-trimming beats a hand-written list: adding a
 * client to the registry adds it here, which is the property that matters.
 */
function showcasedClientNames(): string[] {
  const names = CLIENTS.filter((c) => !NOT_SHOWCASED.has(c.id)).map((c) =>
    c.label.split(/[—(]/)[0]!.trim(),
  );
  return [...new Set(names)];
}

const SECTION_GAP = 44;

export function Landing() {
  const tr = useT();
  const clients = showcasedClientNames();

  const docLinks: Array<{ label: string; href: string; external?: boolean }> = [
    { label: tr("landing.docConcepts"), href: "/docs" },
    { label: tr("landing.docQuickstart"), href: repoDocUrl("docs/QUICKSTART.md"), external: true },
    { label: tr("landing.docTutorials"), href: repoDocUrl("docs/tutorials/README.md"), external: true },
    { label: tr("landing.docMcp"), href: repoDocUrl("docs/MCP_TOOLS.md"), external: true },
    { label: tr("landing.docSecurity"), href: repoDocUrl("docs/SECURITY.md"), external: true },
    { label: tr("landing.docSource"), href: REPO_URL, external: true },
  ];

  const features = [
    { t: tr("landing.f1Title"), b: tr("landing.f1Body") },
    { t: tr("landing.f2Title"), b: tr("landing.f2Body") },
    { t: tr("landing.f3Title"), b: tr("landing.f3Body") },
    { t: tr("landing.f4Title"), b: tr("landing.f4Body") },
  ];

  return (
    <main
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "72px 24px 96px",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: SECTION_GAP }}>
        <div
          className="mono"
          style={{
            fontSize: 12,
            letterSpacing: "0.08em",
            color: "var(--ink-4)",
            marginBottom: 18,
          }}
        >
          EXTERNAL BRAIN
        </div>
        <h1
          style={{
            fontSize: 38,
            fontWeight: 500,
            letterSpacing: "-0.03em",
            lineHeight: 1.2,
            margin: "0 0 16px",
            maxWidth: 680,
          }}
        >
          {tr("landing.heroTitle")}
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "var(--ink-2)",
            lineHeight: 1.6,
            margin: "0 0 28px",
            maxWidth: 620,
          }}
        >
          {tr("landing.heroBody")}
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link className="btn" href="/start">
            {tr("landing.ctaVoucher")}
          </Link>
          <Link className="btn" href="/signin">
            {tr("landing.ctaSignIn")}
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13, color: "var(--ink-3)" }}
          >
            {tr("landing.ctaSelfHost")}
          </a>
        </div>
      </section>

      {/* ── The problem ──────────────────────────────────────────────────── */}
      <section style={{ marginBottom: SECTION_GAP }}>
        <h2 style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-4)", margin: "0 0 10px", letterSpacing: "0.02em" }}>
          {tr("landing.problemTitle")}
        </h2>
        <p style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.6, margin: 0, maxWidth: 640 }}>
          {tr("landing.problemBody")}
        </p>
      </section>

      {/* ── What it does ─────────────────────────────────────────────────── */}
      <section style={{ marginBottom: SECTION_GAP }}>
        <h2 style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-4)", margin: "0 0 16px", letterSpacing: "0.02em" }}>
          {tr("landing.featuresTitle")}
        </h2>
        <div className="welcome-steps">
          {features.map((f) => (
            <section key={f.t} className="panel" style={{ padding: "16px 18px" }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 6px" }}>{f.t}</h3>
              <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, margin: 0 }}>
                {f.b}
              </p>
            </section>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section style={{ marginBottom: SECTION_GAP }}>
        <h2 style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-4)", margin: "0 0 10px", letterSpacing: "0.02em" }}>
          {tr("landing.howTitle")}
        </h2>
        <p style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.6, margin: "0 0 14px", maxWidth: 640 }}>
          {tr("landing.howBody")}
        </p>
        <pre
          className="mono"
          aria-hidden="true"
          style={{
            fontSize: 11.5,
            lineHeight: 1.7,
            color: "var(--ink-3)",
            background: "var(--bg-2)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "14px 16px",
            margin: 0,
            overflowX: "auto",
          }}
        >{`your AI tool  ──MCP──▶  Brain  ──▶  Postgres + pgvector
                         ├─ inject past rules   (before you code)
                         ├─ record the outcome  (after you code)
                         └─ worker: extract · score · decay`}</pre>
      </section>

      {/* ── Works with ───────────────────────────────────────────────────── */}
      <section style={{ marginBottom: SECTION_GAP }}>
        <h2 style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-4)", margin: "0 0 10px", letterSpacing: "0.02em" }}>
          {tr("landing.clientsTitle")}
        </h2>
        <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55, margin: "0 0 14px", maxWidth: 620 }}>
          {tr("landing.clientsBody")}
        </p>
        <ul
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {clients.map((name) => (
            <li key={name} className="chip" style={{ fontSize: 12.5 }}>
              {name}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Read more ────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: SECTION_GAP }}>
        <h2 style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-4)", margin: "0 0 12px", letterSpacing: "0.02em" }}>
          {tr("landing.docsTitle")}
        </h2>
        <ul
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px 20px",
            listStyle: "none",
            padding: 0,
            margin: 0,
            fontSize: 14,
          }}
        >
          {docLinks.map((d) => (
            <li key={d.label}>
              {d.external ? (
                <a href={d.href} target="_blank" rel="noreferrer" style={{ color: "var(--ink-2)" }}>
                  {d.label}
                </a>
              ) : (
                <Link href={d.href} style={{ color: "var(--ink-2)" }}>
                  {d.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <footer
        style={{
          borderTop: "1px solid var(--line)",
          paddingTop: 16,
          fontSize: 12,
          color: "var(--ink-4)",
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <a href={RELEASES_URL} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
          {tr("landing.footerVersion")} {APP_VERSION}
        </a>
        <span>{tr("landing.footerLicence")}</span>
      </footer>
    </main>
  );
}
