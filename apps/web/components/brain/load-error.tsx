"use client";

import { useState } from "react";
import { useT } from "@/lib/brain/i18n";

/**
 * The state a surface shows when its data fetch failed.
 *
 * Its whole job is to NOT look like the empty state: a failed fetch used to
 * fall back to zero counts, and a Brain with hundreds of skills greeted its
 * owner with the new-user "teach your first rule" callout.
 */
export function LoadError({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry: () => Promise<void> | void;
}) {
  const t = useT();
  const [retrying, setRetrying] = useState(false);
  return (
    <div
      role="alert"
      className="panel"
      style={{
        padding: "28px 24px",
        margin: "0 auto",
        maxWidth: 520,
        textAlign: "center",
        borderLeft: "3px solid var(--warn)",
      }}
    >
      <h2 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 500, color: "var(--ink)" }}>
        {title}
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55 }}>
        {body}
      </p>
      <button
        type="button"
        className="btn btn-primary"
        style={{ fontSize: 13 }}
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          try {
            await onRetry();
          } finally {
            setRetrying(false);
          }
        }}
      >
        {retrying ? t("common.retrying") : t("common.retry")}
      </button>
    </div>
  );
}
