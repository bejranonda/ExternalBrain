import { notFound } from "next/navigation";
import Link from "next/link";
import { DOCS } from "@/lib/brain/docs-content";
import type { Metadata } from "next";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const page = DOCS[slug];
  if (!page) return { title: "Not found — Documentation" };
  return {
    title: `${page.title} — Brain Platform docs`,
    description: page.summary,
  };
}

export function generateStaticParams() {
  return Object.keys(DOCS).map((slug) => ({ slug }));
}

export default async function ConceptPage({ params }: Params) {
  const { slug } = await params;
  const page = DOCS[slug];
  if (!page) notFound();

  return (
    <article>
      <Link
        href="/docs"
        className="mono"
        style={{
          fontSize: 12,
          color: "var(--ink-3)",
          textDecoration: "none",
          display: "inline-block",
          marginBottom: 16,
        }}
      >
        ← all concepts
      </Link>

      <h1
        style={{
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "0 0 12px",
          lineHeight: 1.1,
        }}
      >
        {page.title}
      </h1>
      <p
        style={{
          fontSize: 17,
          color: "var(--ink-2)",
          lineHeight: 1.55,
          margin: "0 0 32px",
          maxWidth: 720,
        }}
      >
        {page.summary}
      </p>

      {page.surfaces && page.surfaces.length > 0 && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 28,
            background: "var(--bg-elev-1)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.55,
          }}
        >
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginRight: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Where you see this
          </span>
          {page.surfaces.join(" · ")}
        </div>
      )}

      {page.sections.map((section, i) => (
        <section key={i} style={{ marginBottom: 32 }}>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: "-0.01em",
              margin: "0 0 14px",
            }}
          >
            {section.heading}
          </h2>
          {section.body.map((para, j) => (
            <p
              key={j}
              style={{
                fontSize: 15,
                color: "var(--ink-2)",
                lineHeight: 1.65,
                margin: "0 0 12px",
                maxWidth: 720,
              }}
            >
              {para}
            </p>
          ))}
          {section.bullets && (
            <ul
              style={{
                fontSize: 15,
                color: "var(--ink-2)",
                lineHeight: 1.65,
                paddingLeft: 22,
                margin: "8px 0 0",
                maxWidth: 720,
              }}
            >
              {section.bullets.map((b, k) => (
                <li key={k} style={{ marginBottom: 8 }}>
                  {b}
                </li>
              ))}
            </ul>
          )}
          {section.callout && (
            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                background: "var(--bg-elev-1)",
                border: "1px solid var(--line)",
                borderLeft: "3px solid var(--accent)",
                borderRadius: 4,
                fontSize: 14,
                color: "var(--ink-2)",
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
                maxWidth: 720,
              }}
            >
              {section.callout}
            </div>
          )}
        </section>
      ))}

      {(page.related && page.related.length > 0) || page.repoDoc ? (
        <footer
          style={{
            marginTop: 48,
            paddingTop: 24,
            borderTop: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 720,
          }}
        >
          {page.related && page.related.length > 0 && (
            <div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                }}
              >
                Related concepts
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {page.related.map((s) => {
                  const r = DOCS[s];
                  if (!r) return null;
                  return (
                    <Link
                      key={s}
                      href={`/docs/concepts/${s}`}
                      style={{
                        fontSize: 13,
                        color: "var(--ink-2)",
                        background: "var(--bg-elev-1)",
                        border: "1px solid var(--line)",
                        borderRadius: 4,
                        padding: "6px 10px",
                        textDecoration: "none",
                      }}
                    >
                      {r.title} →
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
          {page.repoDoc && (
            <div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                }}
              >
                Deeper reference
              </div>
              <a
                href={page.repoDoc.href}
                target="_blank"
                rel="noopener"
                style={{ color: "var(--accent-text)", fontSize: 14 }}
              >
                {page.repoDoc.label} ↗
              </a>
            </div>
          )}
        </footer>
      ) : null}
    </article>
  );
}
