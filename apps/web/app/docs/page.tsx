"use client";

import Link from "next/link";
import { DOCS_SECTIONS, getDoc, getDocsChrome } from "@/lib/brain/docs-content";
import { TUTORIALS, type TutorialMeta } from "@/lib/brain/tutorial-meta";
import { useLang } from "@/lib/brain/i18n";

/** Shared card grid for both tutorial sections — same visual weight as the
 *  concept-card grid below, so "Get started" and "Guides" don't read as a
 *  lesser kind of content next to "Core concepts". */
function TutorialGrid({ items }: { items: TutorialMeta[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((t) => (
        <Link
          key={t.slug}
          href={`/docs/tutorials/${t.slug}`}
          className="panel"
          style={{
            padding: "16px 18px",
            textDecoration: "none",
            color: "inherit",
            display: "block",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--bg-elev-1)",
            transition: "border-color 0.15s, transform 0.15s",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <h3 style={{ fontSize: 16, fontWeight: 500, margin: 0, color: "var(--ink)" }}>{t.title}</h3>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)", whiteSpace: "nowrap" }}>
              {t.minutes}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5, margin: 0 }}>{t.summary}</p>
        </Link>
      ))}
    </div>
  );
}

/**
 * Landing index for in-app documentation. Grouped by section per the
 * registry; each card links to the concept page and shows the one-line
 * summary so users can skim and find what they need.
 *
 * Client component so it reacts to the unauth <LocalePicker /> instantly via
 * useLang(); it still server-renders in the cookie-resolved language (the
 * LangProvider seeds the context from the bp_lang cookie). #59.
 */
export default function DocsIndex() {
  const lang = useLang();
  const c = getDocsChrome(lang);
  return (
    <>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "0 0 8px",
        }}
      >
        {c.indexTitle}
      </h1>
      <p
        style={{
          fontSize: 16,
          color: "var(--ink-2)",
          lineHeight: 1.55,
          margin: "0 0 36px",
          maxWidth: 720,
        }}
      >
        {c.indexIntro}{" "}
        {c.indexHandbookPre}
        <a
          href="https://github.com/bejranonda/ExternalBrain/tree/main/docs"
          target="_blank"
          rel="noopener"
          style={{ color: "var(--accent-text)", textDecoration: "underline" }}
        >
          {c.indexHandbookLink}
        </a>
        .
      </p>

      {/* Tutorials FIRST, concepts below (reordered 2026-08-09).
          Quick start used to be the 12th card on this page, under eleven
          concept cards — a first-time visitor met "what is Autoskill" before
          "how do I connect". Someone who lands here without a working
          install needs a walkthrough, not a concept explainer, first.

          Split into two grids, not one flat "Tutorials" list (2026-08-09):
          of the 8 files under docs/tutorials/, only 00 and 01 are actually
          onboarding walkthroughs meant to be followed once, start to finish.
          02/03/05 are technique guides for someone already connected who
          wants to do one specific thing well — real content, wrong shelf
          next to "Quick start". 04 and 07 aren't tutorials at all (see
          tutorial-meta.ts's TutorialMeta.category doc comment for the full
          reasoning) and don't appear in either grid; they're cross-linked
          from their matching concept card instead. 06 doesn't appear here
          either — it's reachable only via the "Need help?" footer link,
          which is its one correct entry point.

          Renders real markdown via /docs/tutorials/[slug] rather than the
          concept-card format, which has no room for install commands,
          comparison tables, or diagrams — see tutorial-content.ts. */}
      <section id="get-started" style={{ marginBottom: 36, scrollMarginTop: 24 }}>
        <h2
          className="mono"
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 600,
            margin: "0 0 14px",
          }}
        >
          {c.sections["getStarted"] ?? "Get started"}
        </h2>
        <TutorialGrid items={TUTORIALS.filter((t) => t.category === "get-started")} />
      </section>

      <section id="guides" style={{ marginBottom: 36, scrollMarginTop: 24 }}>
        <h2
          className="mono"
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 600,
            margin: "0 0 14px",
          }}
        >
          {c.sections["guides"] ?? "Guides"}
        </h2>
        <p style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5, margin: "-6px 0 14px", maxWidth: 620 }}>
          {c.guidesIntro ?? "Already connected? Level up one specific thing."}
        </p>
        <TutorialGrid items={TUTORIALS.filter((t) => t.category === "guide")} />
      </section>

      {DOCS_SECTIONS.map((section) => (
        <section key={section.id} style={{ marginBottom: 36 }}>
          <h2
            className="mono"
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 600,
              margin: "0 0 14px",
            }}
          >
            {c.sections[section.id] ?? section.heading}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {section.slugs.map((slug) => {
              const page = getDoc(lang, slug);
              if (!page) return null;
              return (
                <Link
                  key={slug}
                  href={`/docs/concepts/${slug}`}
                  className="panel"
                  style={{
                    padding: "16px 18px",
                    textDecoration: "none",
                    color: "inherit",
                    display: "block",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--bg-elev-1)",
                    transition: "border-color 0.15s, transform 0.15s",
                  }}
                >
                  <h3
                    style={{
                      fontSize: 16,
                      fontWeight: 500,
                      margin: "0 0 6px",
                      color: "var(--ink)",
                    }}
                  >
                    {page.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--ink-2)",
                      lineHeight: 1.5,
                      margin: 0,
                    }}
                  >
                    {page.summary}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      <section style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid var(--line)" }}>
        <h2
          className="mono"
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 600,
            margin: "0 0 14px",
          }}
        >
          {c.needHelpTitle}
        </h2>
        <ul
          style={{
            fontSize: 14,
            color: "var(--ink-2)",
            lineHeight: 1.7,
            paddingLeft: 20,
            margin: 0,
          }}
        >
          <li>
            {/* Points at the quick start, not `#tutorials`. The anchor was
                technically valid but useless: this footer sits BELOW the
                tutorials grid, so it sent the reader back up to something
                they had already scrolled past. A "need help?" link should
                lead somewhere new. */}
            {c.helpTutorialsPre}
            <Link href="/docs/tutorials/00-quick-start" style={{ color: "var(--accent-text)" }}>
              {c.helpTutorialsLink}
            </Link>
            {c.helpTutorialsPost}
          </li>
          <li>
            {c.helpBrokenPre}
            <Link href="/docs/tutorials/06-troubleshooting" style={{ color: "var(--accent-text)" }}>
              {c.helpBrokenLink}
            </Link>
            {c.helpBrokenMid}
            <a
              href="https://github.com/bejranonda/ExternalBrain/issues/new"
              target="_blank"
              rel="noopener"
              style={{ color: "var(--accent-text)" }}
            >
              {c.helpBrokenLink2}
            </a>
            {c.helpBrokenPost}
          </li>
          <li>
            {c.helpRunbookPre}
            <a
              href="https://github.com/bejranonda/ExternalBrain/blob/main/docs/DEPLOY_CHECKLIST.md"
              target="_blank"
              rel="noopener"
              style={{ color: "var(--accent-text)" }}
            >
              {c.helpRunbookLink}
            </a>
            {c.helpRunbookPost}
          </li>
        </ul>
      </section>
    </>
  );
}
