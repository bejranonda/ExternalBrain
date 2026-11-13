"use client";

/**
 * /settings/data — download everything this Brain holds about you, or import
 * a JSON export from another Brain (docs/SUNSET.md, PRIVACY §5).
 *
 * Downloads are plain links: the browser's own download handling copes with
 * any size, and the session cookie authenticates the GET.
 */

import { useState } from "react";
import { useT } from "@/lib/brain/i18n";
import { apiErrorMessage } from "@/lib/brain/api-error";

const SELF_HOST_GUIDE_URL = "https://github.com/bejranonda/ExternalBrain/blob/main/docs/QUICKSTART.md";

const card: React.CSSProperties = {
  background: "var(--bg-elev-1)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: 24,
  marginBottom: 20,
};
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 600, margin: "0 0 8px" };
const body: React.CSSProperties = { fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6, margin: "0 0 16px" };

type ImportResult = { imported: number; duplicates: number; skipped: number };

export default function YourDataPage() {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setStatus("busy");
    setErrorMsg("");
    try {
      const res = await fetch("/api/me/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await file.text(),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { error?: unknown };
      if (!res.ok) {
        setErrorMsg(apiErrorMessage(t, data.error, res.status));
        setStatus("error");
        return;
      }
      setResult({ imported: data.imported ?? 0, duplicates: data.duplicates ?? 0, skipped: data.skipped ?? 0 });
      setStatus("ok");
    } catch {
      setErrorMsg(t("apiErrors.network"));
      setStatus("error");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--ink)",
        padding: "40px 24px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <a href="/settings/tokens" style={{ fontSize: 13, color: "var(--ink-3)", textDecoration: "none" }}>
          {t("data.back")}
        </a>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "16px 0 4px" }}>{t("data.title")}</h1>
        <p style={{ ...body, marginBottom: 28 }}>{t("data.intro")}</p>

        <section style={card} aria-labelledby="data-download">
          <h2 id="data-download" style={h2}>{t("data.downloadTitle")}</h2>
          <p style={body}>{t("data.downloadBody")}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="btn btn-primary" href="/api/me/export?format=md" download>{t("data.downloadMd")}</a>
            <a className="btn" href="/api/me/export?format=json" download>{t("data.downloadJson")}</a>
          </div>
        </section>

        <section style={card} aria-labelledby="data-import">
          <h2 id="data-import" style={h2}>{t("data.importTitle")}</h2>
          <p style={body}>{t("data.importBody")}</p>
          {status === "ok" && result && (
            <div role="status" style={{ ...body, color: "var(--ink)", marginBottom: 12 }}>
              {t("data.imported", { imported: result.imported, duplicates: result.duplicates, skipped: result.skipped })}
              {result.imported > 0 && <><br />{t("data.importNote")}</>}
            </div>
          )}
          {status === "error" && errorMsg && (
            <div role="alert" style={{ ...body, color: "var(--warn, #d97757)", marginBottom: 12 }}>{errorMsg}</div>
          )}
          <form onSubmit={(e) => { void onImport(e); }} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="file"
              accept="application/json,.json"
              aria-label={t("data.importFile")}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setStatus("idle"); }}
              style={{ fontSize: 13, maxWidth: "100%" }}
            />
            <button type="submit" className="btn" disabled={!file || status === "busy"}>
              {status === "busy" ? t("data.importing") : t("data.importButton")}
            </button>
          </form>
        </section>

        <section style={card} aria-labelledby="data-selfhost">
          <h2 id="data-selfhost" style={h2}>{t("data.selfHostTitle")}</h2>
          <p style={body}>{t("data.selfHostBody")}</p>
          <a href={SELF_HOST_GUIDE_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "var(--accent-text)", fontWeight: 600 }}>
            {t("data.selfHostLink")} ↗
          </a>
        </section>
      </div>
    </main>
  );
}
