"use client";

/**
 * ValueChip — the `→N  ←M` two-number chip used wherever we show "skills
 * helped you / skills learned from you". Always-on-screen in tables and
 * row previews; the colours match the corresponding detail-panel headers
 * so the visual link between row and expansion is obvious.
 *
 * When both sides are zero, the chip whispers a "no activity yet" phrase
 * instead of "→0  ←0", which reads as a complaint.
 */
export function ValueChip({
  injected,
  extracted,
  variant = "compact",
}: {
  injected: number;
  extracted: number;
  /** "compact" sized for table cells; "row-preview" slightly larger for project rows. */
  variant?: "compact" | "row-preview";
}) {
  const isQuiet = injected === 0 && extracted === 0;
  if (isQuiet) {
    return (
      <span
        className="mono"
        style={{
          fontSize: variant === "compact" ? 11 : 12,
          color: "var(--ink-4)",
        }}
        title="No skills exchanged yet"
      >
        no activity yet
      </span>
    );
  }
  const size = variant === "compact" ? 12 : 13;
  return (
    <span
      className="mono tab-num"
      style={{
        fontSize: size,
        display: "inline-flex",
        gap: 8,
        whiteSpace: "nowrap",
      }}
      title={`${injected} skill${injected === 1 ? "" : "s"} helped you · ${extracted} skill${extracted === 1 ? "" : "s"} learned from you`}
    >
      <span style={{ color: "var(--accent-text)" }}>→{injected}</span>
      <span style={{ color: "var(--violet)" }}>←{extracted}</span>
    </span>
  );
}
