"use client";

import Link from "next/link";
import { CLIENTS, type ClientId } from "@brain/core/install-snippets";
import { SectionHeading } from "@/components/brain/section-heading";
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
 *
 * Typography note (2026-08-09): the first version invented its own scale
 * (11.5–16px, one uniform tiny gray label for every heading) instead of the
 * app's actual tokens — `--text-xs/sm/base/lg/xl` (12/14/16/20/24, see
 * globals.css) and the `--accent` lime used nowhere on the page. That made
 * every section read as equally (un)important. Fixed here by giving section
 * headings real weight (matching `/docs`'s 20px concept headings), reserving
 * the small-caps "eyebrow" treatment for the one place it was already correct
 * (the kicker above H1), and borrowing the `--accent` tick that
 * `.rail-item.active::before` already uses to mark "this matters" elsewhere
 * in the app — so the page reads as part of the same product, not a third
 * visual dialect.
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

export function Landing() {
  const tr = useT();
  const clients = showcasedClientNames();

  const docLinks: Array<{ label: string; href: string; external?: boolean }> = [
    // docConcepts ("Concepts" → /docs) removed 2026-08-09 — /docs is now the
    // section's own primary CTA above, so listing it again as one chip among
    // five external GitHub links was a redundant second click to the same
    // place, framed as if it were a peer of "Security & privacy" instead of
    // the section's actual point.
    //
    // NOT docs/QUICKSTART.md — that guide is for someone self-hosting a NEW
    // instance (Docker Engine, .env, an LLM provider key). A visitor on an
    // existing deployment has no use for it; clicking it used to strand them
    // in infrastructure setup instructions for a task they weren't doing.
    // /welcome is the actual in-app quick-start: pick your AI tool, copy the
    // install command, watch for your first session to land — already public
    // (no sign-in required to view it) and already localized.
    // Repointed /welcome → the real quick-start tutorial (2026-08-09).
    // Earlier today this was moved off docs/QUICKSTART.md (the self-hosting
    // operator guide) onto /welcome, which was then the in-app install flow.
    // /welcome is now verification-only, so "Quick start" has to point at the
    // tutorial that actually teaches the install.
    { label: tr("landing.docQuickstart"), href: "/docs/tutorials/00-quick-start" },
    // In-app as of 2026-08-09 (was repoDocUrl("docs/tutorials/README.md")) —
    // see apps/web/lib/brain/tutorial-content.ts for why tutorials get their
    // own markdown renderer instead of the concept-page format.
    { label: tr("landing.docTutorials"), href: "/docs/tutorials/00-quick-start" },
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
      {/* The eyebrow-caps treatment belongs here and nowhere else on the page
          — a kicker sitting directly above a much larger headline is the one
          place small-caps-over-big-type actually reads as intentional. */}
      <section style={{ marginBottom: 64 }}>
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
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            margin: "0 0 18px",
            maxWidth: 680,
          }}
        >
          {tr("landing.heroTitle")}
        </h1>
        <p
          style={{
            fontSize: 17,
            color: "var(--ink-2)",
            lineHeight: 1.6,
            margin: "0 0 32px",
            maxWidth: 600,
          }}
        >
          {tr("landing.heroBody")}
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {/* Primary conversion action gets the accent fill — the app's own
              .btn-primary — so it's visually distinct from "Sign in", which
              most first-time visitors are not yet ready to do. The first
              version gave both buttons the same plain .btn treatment, which
              is the same "no hierarchy" mistake as the section headings. */}
          <Link className="btn btn-primary" href="/start" style={{ height: 36, padding: "0 16px", fontSize: 14 }}>
            {tr("landing.ctaVoucher")}
          </Link>
          <Link className="btn" href="/signin" style={{ height: 36, padding: "0 16px", fontSize: 14 }}>
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
      <section style={{ marginBottom: 48, paddingTop: 40, borderTop: "1px solid var(--line-soft)" }}>
        <SectionHeading>{tr("landing.problemTitle")}</SectionHeading>
        <p style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.65, margin: 0, maxWidth: 620 }}>
          {tr("landing.problemBody")}
        </p>
      </section>

      {/* ── What it does — the cornerstone section, gets the most room ──── */}
      <section style={{ marginBottom: 64 }}>
        <SectionHeading>{tr("landing.featuresTitle")}</SectionHeading>
        <div className="welcome-steps" style={{ marginTop: 20 }}>
          {features.map((f) => (
            <section key={f.t} className="panel" style={{ padding: "18px 20px" }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 8px", color: "var(--ink)" }}>
                {f.t}
              </h3>
              <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, margin: 0 }}>
                {f.b}
              </p>
            </section>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <SectionHeading>{tr("landing.howTitle")}</SectionHeading>
        <p style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.65, margin: "0 0 16px", maxWidth: 620 }}>
          {tr("landing.howBody")}
        </p>
        <pre
          className="mono"
          aria-hidden="true"
          style={{
            fontSize: 12,
            lineHeight: 1.8,
            color: "var(--ink-2)",
            background: "var(--bg-elev-1)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r)",
            padding: "16px 18px",
            margin: 0,
            overflowX: "auto",
          }}
        >{`your AI tool  ──MCP──▶  `}<span style={{ color: "var(--accent-text)" }}>Brain</span>{`  ──▶  Postgres + pgvector
                         ├─ inject past rules   (before you code)
                         ├─ record the outcome  (after you code)
                         └─ worker: extract · score · decay`}</pre>
      </section>

      {/* ── Works with ───────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 48 }}>
        <SectionHeading>{tr("landing.clientsTitle")}</SectionHeading>
        <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55, margin: "0 0 16px", maxWidth: 600 }}>
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

      {/* ── Documentation ────────────────────────────────────────────────── */}
      {/* Promoted to a real SectionHeading (2026-08-09) — this used to be a
          13px mono "READ MORE" utility label, the same demoted-relative-to-
          everything-else treatment the whole page got fixed for elsewhere
          (see the SectionHeading component's own history). /docs is a real
          destination with real content (tutorials + concept primers), not a
          footnote — it deserves the same visual weight as "What it does" or
          "How it works" above it, and a real primary link instead of being
          one chip among six external GitHub URLs. */}
      <section style={{ marginBottom: 40, paddingTop: 32, borderTop: "1px solid var(--line-soft)" }}>
        <SectionHeading>{tr("landing.docsTitle")}</SectionHeading>
        <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55, margin: "0 0 16px", maxWidth: 600 }}>
          {tr("landing.docsIntro")}
        </p>
        <div style={{ marginBottom: 16 }}>
          <Link className="btn btn-primary" href="/docs" style={{ textDecoration: "none" }}>
            {tr("landing.docsCta")}
          </Link>
        </div>
        {/* Rendered as chips (the app's own tag idiom, same class as the
            client row above) rather than a bare underlined-text list — a
            link row and a tag row look identical unless something
            distinguishes "click to leave the page" from "click to compare
            tools". These are the deeper, occasional-reference links; /docs
            itself (above) is the one most visitors actually want. */}
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
          {docLinks.map((d) =>
            d.external ? (
              <li key={d.label}>
                <a href={d.href} target="_blank" rel="noreferrer" className="chip" style={{ textDecoration: "none" }}>
                  {d.label} ↗
                </a>
              </li>
            ) : (
              <li key={d.label}>
                <Link href={d.href} className="chip" style={{ textDecoration: "none" }}>
                  {d.label}
                </Link>
              </li>
            ),
          )}
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
