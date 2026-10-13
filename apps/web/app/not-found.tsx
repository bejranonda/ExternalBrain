import { getServerT } from "@/lib/brain/i18n-server";

/**
 * Custom 404 — replaces Next.js's bare default so newcomers who land on
 * a bad org/project URL get a path back to their Brain instead of a
 * dead end. (UX-newcomer-pass-6)
 */
export default async function NotFound() {
  const t = await getServerT();
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        fontFamily: "var(--font-sans)",
        color: "var(--ink)",
        background: "var(--bg)",
      }}
    >
      <div
        className="panel"
        style={{
          padding: "32px 28px",
          maxWidth: 480,
          textAlign: "center",
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          {t("errorPage.notFoundEyebrow")}
        </div>
        <h1
          style={{
            margin: "0 0 10px",
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: "-0.02em",
          }}
        >
          {t("errorPage.notFoundTitle")}
        </h1>
        <p
          style={{
            margin: "0 0 20px",
            fontSize: 14,
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          {t("errorPage.notFoundBody")}
        </p>
        <div
          className="row"
          style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}
        >
          <a
            href="/"
            className="btn btn-primary"
            style={{ fontSize: 13, textDecoration: "none" }}
          >
            {t("errorPage.backHome")}
          </a>
          <a
            href="/settings"
            className="btn btn-ghost"
            style={{ fontSize: 13, textDecoration: "none" }}
          >
            {t("app.settings")}
          </a>
        </div>
      </div>
    </main>
  );
}
