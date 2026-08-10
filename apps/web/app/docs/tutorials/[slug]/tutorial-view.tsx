"use client";

import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { SectionHeading } from "@/components/brain/section-heading";
import { getDocsChrome } from "@/lib/brain/docs-content";
import { useLang } from "@/lib/brain/i18n";
import type { TutorialMeta } from "@/lib/brain/tutorial-meta";
import { resolveDocLink } from "@/lib/brain/resolve-doc-link";
import { MermaidDiagram } from "./mermaid-diagram";

interface Props {
  meta: TutorialMeta;
  content: { en: string; th: string | null; de: string | null };
  translated: { en: boolean; th: boolean; de: boolean };
}

/**
 * Themed markdown rendering for a tutorial — the counterpart to
 * `concept-view.tsx`, deliberately NOT sharing its renderer. ConceptView's
 * plain <p>/<li> + one-callout-per-section shape has nowhere to put a table
 * or a second code block; tutorials are built from exactly that content, so
 * this component maps real markdown elements (h2, table, pre/code, blockquote)
 * onto the app's typography tokens instead.
 *
 * Content for all three languages is passed in from the server component
 * (SSG'd at build time — see tutorial-content.ts's build-time-only note) and
 * this component just picks the right one via useLang(), the same instant-
 * switch pattern ConceptView uses.
 */
export function TutorialView({ meta, content, translated }: Props) {
  const lang = useLang();
  const md = content[lang] ?? content.en;
  const isTranslated = translated[lang] ?? false;
  const c = getDocsChrome(lang);

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
        {c.allTutorials}
      </Link>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            margin: 0,
          }}
        >
          {meta.title}
        </h1>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-4)" }}>
          {meta.minutes}
        </span>
      </div>
      <p
        style={{
          fontSize: 17,
          color: "var(--ink-2)",
          lineHeight: 1.55,
          margin: "8px 0 28px",
          maxWidth: 720,
        }}
      >
        {meta.summary}
      </p>

      {!isTranslated && lang !== "en" && (
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
          {c.notYetTranslated}
        </div>
      )}

      <div className="tutorial-md" style={{ maxWidth: 760 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
          {md}
        </ReactMarkdown>
      </div>

      <footer
        style={{
          marginTop: 48,
          paddingTop: 24,
          borderTop: "1px solid var(--line)",
          maxWidth: 720,
        }}
      >
        <a
          href={`https://github.com/bejranonda/ExternalBrain/blob/main/docs/tutorials/${meta.file}.md`}
          target="_blank"
          rel="noopener"
          style={{ color: "var(--accent-text)", fontSize: 14 }}
        >
          {c.sourceOnGithub} ↗
        </a>
      </footer>
    </article>
  );
}

/**
 * Maps markdown elements onto the app's actual type scale rather than
 * accepting react-markdown's unstyled defaults. h1 is skipped deliberately —
 * the source markdown's own `# Title` is redundant with `meta.title` above
 * and would double the heading; tutorials start their body at `##`.
 */
// Typed as `Components` (react-markdown's own type) rather than hand-written
// per-function prop shapes: this tsconfig sets `exactOptionalPropertyTypes`,
// under which a manually written `{ href?: string }` is NOT the same type as
// react-markdown's actual `{ href?: string | undefined }` — the first says
// "may be omitted, but if present is always a string", the second says "may
// literally be the value undefined". Letting each slot's signature come from
// `Components` avoids re-deriving that distinction by hand for every element.
const MD_COMPONENTS: Components = {
  h1: () => null,
  h2: ({ children }) => (
    <div style={{ marginTop: 36 }}>
      <SectionHeading>{children}</SectionHeading>
    </div>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: 16, fontWeight: 600, margin: "24px 0 10px" }}>{children}</h3>
  ),
  p: ({ children }) => (
    <p style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.65, margin: "0 0 14px" }}>
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.65, paddingLeft: 22, margin: "0 0 14px" }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.65, paddingLeft: 22, margin: "0 0 14px" }}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li style={{ marginBottom: 6 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{children}</strong>,
  a: ({ href, children }) => {
    const resolved = resolveDocLink(href ?? "#");
    return (
      <a
        href={resolved.href}
        target={resolved.external ? "_blank" : undefined}
        rel="noreferrer"
        style={{ color: "var(--accent-text)" }}
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: "0 0 14px",
        padding: "10px 14px",
        borderLeft: "3px solid var(--accent)",
        background: "var(--bg-elev-1)",
        borderRadius: 4,
        fontSize: 14,
        color: "var(--ink-2)",
        lineHeight: 1.55,
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ border: "none", borderTop: "1px solid var(--line-soft)", margin: "32px 0" }} />,
  // `pre` wraps `code` for fenced blocks; `code` alone (no wrapping <pre>) is
  // an inline `` `code` `` span, so the two need distinct styling — the
  // common bug here is styling `code` only and getting a monospace-boxed
  // single word in the middle of a sentence.
  //
  // ```mermaid blocks are the third case: react-markdown still nests them as
  // <pre><code className="language-mermaid">, but they must render as a
  // diagram, not text in a monospace box — so `pre` checks its child's
  // className and skips its own box styling when it finds a mermaid block
  // (MermaidDiagram draws its own container), delegating entirely to `code`.
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    const isMermaid =
      child &&
      typeof child === "object" &&
      "props" in child &&
      typeof child.props?.className === "string" &&
      child.props.className.includes("language-mermaid");
    if (isMermaid) return <>{children}</>;
    return (
      <pre
        className="mono"
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          background: "var(--bg-elev-1)",
          border: "1px solid var(--line)",
          borderRadius: 6,
          padding: "14px 16px",
          margin: "0 0 16px",
          overflowX: "auto",
        }}
      >
        {children}
      </pre>
    );
  },
  code: ({ children, className }) => {
    if (className?.includes("language-mermaid")) {
      return <MermaidDiagram code={String(children).replace(/\n$/, "")} />;
    }
    // react-markdown puts a `language-xxx` class on code inside a <pre>
    // (fenced block); inline code has no className. Only style the inline
    // case here — fenced blocks are already styled by the parent <pre>.
    if (className) return <code>{children}</code>;
    return (
      <code
        className="mono"
        style={{
          fontSize: "0.9em",
          background: "var(--bg-elev-1)",
          border: "1px solid var(--line-soft)",
          borderRadius: 3,
          padding: "1px 5px",
        }}
      >
        {children}
      </code>
    );
  },
  // Card-wrapped rather than a bare hairline table — matches the `.panel`
  // treatment every other grouped-content block in the app uses (the /docs
  // index cards, the landing page's feature grid). A naked <table> was the
  // one element on this page that still looked like raw markdown instead of
  // part of the product (2026-08-09).
  table: ({ children }) => (
    <div className="panel" style={{ overflowX: "auto", margin: "0 0 16px", padding: "4px 14px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderBottom: "1px solid var(--line)",
        color: "var(--ink)",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--line-soft)", color: "var(--ink-2)" }}>
      {children}
    </td>
  ),
};
