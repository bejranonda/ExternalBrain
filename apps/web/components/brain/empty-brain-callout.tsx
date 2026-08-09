"use client";

import { Icon } from "./icons";
import { useT } from "@/lib/brain/i18n";

interface Props {
  /** Open the Teach modal. */
  onTeach: () => void;
}

/**
 * Prominent "your Brain is empty" panel rendered on the dashboard above the
 * stats grid when the user has zero Knowledge items. Replaces the prior
 * silent "0 / 0 / 0 / 0" first-impression with an actionable next step.
 *
 * Two equally-weighted CTAs: the install path (token + MCP client) and the
 * teach path (manual rule). Either gets the user past the empty state.
 */
export function EmptyBrainCallout({ onTeach }: Props) {
  const t = useT();
  return (
    <div
      className="panel"
      style={{
        padding: "20px 22px",
        marginBottom: 14,
        borderLeft: "3px solid var(--accent)",
        background: "var(--bg-elev-1)",
      }}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2
            style={{
              margin: "0 0 6px",
              fontSize: 18,
              fontWeight: 500,
              letterSpacing: "-0.01em",
            }}
          >
            {t("callout.title")}
          </h2>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            {t("callout.body")}
          </p>
          <ol
            style={{
              margin: "0 0 14px",
              padding: "0 0 0 20px",
              fontSize: 14,
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            <li style={{ marginBottom: 4 }}>
              <strong>{t("callout.step1_lead")}</strong>
              {t("callout.step1_rest")}
            </li>
            <li>
              <strong>{t("callout.step2_lead")}</strong>
              {t("callout.step2_rest")}
            </li>
          </ol>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {/* Primary CTA repointed /welcome → quick start (2026-08-09).
                /welcome was the right target when it taught install in three
                steps; it is now post-install verification only, so sending
                someone with an empty Brain there showed them a "waiting for
                your first session" spinner and no way to install. The quick
                start is the page that actually teaches the install. */}
            <a
              href="/docs/tutorials/00-quick-start"
              className="btn btn-primary"
              style={{ fontSize: 13, textDecoration: "none" }}
            >
              <Icon name="link" size={11} /> {t("callout.get_started")}
            </a>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 13 }}
              onClick={onTeach}
            >
              <Icon name="plus" size={11} /> {t("skills.empty_teach")}
            </button>
            <a
              href="/settings/tokens"
              className="btn btn-ghost"
              style={{ fontSize: 13, textDecoration: "none" }}
            >
              {t("sessions.get_token")}
            </a>
            <a
              href="/api/onboard.sh"
              target="_blank"
              rel="noopener"
              className="btn btn-ghost"
              style={{ fontSize: 13, textDecoration: "none" }}
              title={t("sessions.install_hint")}
            >
              {t("sessions.view_install")}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
