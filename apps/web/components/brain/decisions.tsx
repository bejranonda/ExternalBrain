"use client";

import { useMemo } from "react";
import { useT } from "@/lib/brain/i18n";
import { useProjectScope } from "@/lib/brain/use-project-scope";
import { useKnowledge } from "@/lib/brain/use-knowledge";

/**
 * Decisions surface — the project's settled choices as shared memory.
 *
 * Decisions are Knowledge rows tagged "decision" (spec 2026-06-16). This view
 * is a read-only changelog destination; capture happens over MCP
 * (brain_teach_knowledge), browsing/editing lives in Skills (filter by the
 * same tag), and the Oracle cites them. We deliberately reuse useKnowledge
 * rather than a new fetch — tags already flow to the client.
 */
export function Decisions() {
  const t = useT();
  const { scope } = useProjectScope();
  const { items, loadState } = useKnowledge(scope);

  const decisions = useMemo(
    () => items.filter((i) => i.tags.includes("decision")),
    [items],
  );

  return (
    <div className="scroll" style={{ padding: "24px 32px 96px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em" }}>
          {t("decisions.title")}
        </h1>
        <p
          style={{
            margin: "2px 0 18px",
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.4,
          }}
        >
          {t("decisions.subtitle")}
        </p>

        {loadState === "loading" ? (
          <p style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("decisions.loading")}</p>
        ) : decisions.length === 0 ? (
          <div className="panel" style={{ padding: "20px 22px" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 500 }}>
              {t("decisions.empty_title")}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
              {t("decisions.empty_body")}
            </p>
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {decisions.map((d) => (
              <li key={d.id} className="panel" style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{d.title}</div>
                {d.body && d.body !== d.title && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-2)",
                      marginTop: 6,
                      lineHeight: 1.5,
                    }}
                  >
                    {d.body}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 8 }}>{d.updated}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
