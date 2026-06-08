import Link from "next/link";
import { DOCS, DOCS_SECTIONS } from "@/lib/brain/docs-content";

/**
 * Landing index for in-app documentation. Grouped by section per the
 * registry; each card links to the concept page and shows the one-line
 * summary so users can skim and find what they need.
 */
export default function DocsIndex() {
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
        Documentation
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
        Plain-English reference for every concept and feature in External Brain.
        If you came here from a (?) icon in the app, the page you want is below.
        For the full technical handbook, see the{" "}
        <a
          href="https://github.com/bejranonda/BrainPlatform/tree/main/docs"
          target="_blank"
          rel="noopener"
          style={{ color: "var(--accent-text)", textDecoration: "underline" }}
        >
          docs/ folder on GitHub
        </a>
        .
      </p>

      {DOCS_SECTIONS.map((section) => (
        <section key={section.heading} style={{ marginBottom: 36 }}>
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
            {section.heading}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {section.slugs.map((slug) => {
              const page = DOCS[slug];
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
          Need help?
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
            For end-user walkthroughs:{" "}
            <a
              href="https://github.com/bejranonda/BrainPlatform/tree/main/docs/tutorials"
              target="_blank"
              rel="noopener"
              style={{ color: "var(--accent-text)" }}
            >
              tutorials/
            </a>{" "}
            (six step-by-step guides).
          </li>
          <li>
            Something broken? Check{" "}
            <a
              href="https://github.com/bejranonda/BrainPlatform/blob/main/docs/tutorials/06-troubleshooting.md"
              target="_blank"
              rel="noopener"
              style={{ color: "var(--accent-text)" }}
            >
              the troubleshooting guide
            </a>{" "}
            or{" "}
            <a
              href="https://github.com/bejranonda/BrainPlatform/issues/new"
              target="_blank"
              rel="noopener"
              style={{ color: "var(--accent-text)" }}
            >
              file an issue
            </a>
            .
          </li>
          <li>
            Operator / production runbook:{" "}
            <a
              href="https://github.com/bejranonda/BrainPlatform/blob/main/docs/RUNBOOK.md"
              target="_blank"
              rel="noopener"
              style={{ color: "var(--accent-text)" }}
            >
              RUNBOOK.md
            </a>
            .
          </li>
        </ul>
      </section>
    </>
  );
}
