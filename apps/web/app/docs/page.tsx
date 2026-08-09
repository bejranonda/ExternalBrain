"use client";

import Link from "next/link";
import { DOCS_SECTIONS, getDoc, getDocsChrome } from "@/lib/brain/docs-content";
import { TUTORIALS } from "@/lib/brain/tutorial-meta";
import { useLang } from "@/lib/brain/i18n";

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

      {/* Tutorials — step-by-step walkthroughs, distinct from the concept
          cards above (those explain what a thing IS; these show how to DO
          something end-to-end). Renders real markdown via /docs/tutorials/
          [slug] rather than the concept-card format, which has no room for
          install commands or comparison tables — see tutorial-content.ts. */}
      <section id="tutorials" style={{ marginBottom: 36, scrollMarginTop: 24 }}>
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
          {c.sections["tutorials"] ?? "Tutorials"}
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {TUTORIALS.map((t) => (
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
                <h3 style={{ fontSize: 16, fontWeight: 500, margin: 0, color: "var(--ink)" }}>
                  {t.title}
                </h3>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)", whiteSpace: "nowrap" }}>
                  {t.minutes}
                </span>
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5, margin: 0 }}>
                {t.summary}
              </p>
            </Link>
          ))}
        </div>
      </section>

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
            {c.helpTutorialsPre}
            <a href="#tutorials" style={{ color: "var(--accent-text)" }}>
              {c.helpTutorialsLink}
            </a>
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
