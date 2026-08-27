import type { CSSProperties } from "react";
import type { DiffToken } from "./helpers";

/* Co-located styles for RunCompare (design:
   `screen_skillslab_evaldashboard.jsx:303-341`).

   Style OBJECTS consumed as `style={s.x}`, plus FUNCTIONS returning the WHOLE
   computed style for the parts that vary — a spread in JSX is two
   `no-restricted-syntax` errors, not zero (`client/INSIGHTS.md`). */

export const s = {
  body: { padding: "16px 18px" } satisfies CSSProperties,
  deltas: { display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" } satisfies CSSProperties,
  card: {
    flex: 1,
    minWidth: 170,
    padding: "12px 14px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  cardLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 8,
  } satisfies CSSProperties,
  cardValues: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  oldValue: { fontSize: 15, color: "var(--text-muted)" } satisfies CSSProperties,
  newValue: { fontSize: 21, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  arrow: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  /** The em dash. Muted on purpose: unknown must not read as a headline number. */
  unknown: { color: "var(--text-muted)", cursor: "help" } satisfies CSSProperties,

  incomparable: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "11px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    marginBottom: 16,
  } satisfies CSSProperties,
  incomparableTitle: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  incomparableHint: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginTop: 2,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  warnIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,

  legend: {
    display: "flex",
    gap: 14,
    fontSize: 11.5,
    color: "var(--text-secondary)",
    margin: "8px 0 10px",
  } satisfies CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  /** A long prompt scrolls INSIDE the diff area; the modal never grows past it. */
  diff: {
    fontSize: 12.5,
    lineHeight: 1.75,
    background: "var(--code-bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "14px 16px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 320,
    overflow: "auto",
  } satisfies CSSProperties,
  /** AC-90 / AC-91: an explicit sentence, never an empty panel. */
  diffMessage: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px dashed var(--border-strong)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  loading: { padding: "28px 18px", fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  footer: { display: "flex", gap: 8, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;

/** A legend swatch — the same two tokens the diff itself is painted with. */
export function legendSwatchStyle(kind: "old" | "new"): CSSProperties {
  return {
    width: 11,
    height: 11,
    borderRadius: 3,
    background: kind === "old" ? "var(--code-del)" : "var(--code-add)",
    flexShrink: 0,
  };
}

/** One diff token: removed words struck through in red, added words in green. */
export function diffTokenStyle(kind: DiffToken["kind"]): CSSProperties {
  return {
    background:
      kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent",
    color: kind === "same" ? "var(--text-secondary)" : "var(--text-primary)",
    textDecorationLine: kind === "del" ? "line-through" : "none",
    textDecorationColor: "var(--crit)",
  };
}

/**
 * A delta badge.
 *
 * `invert` is the cost card: on recall, precision and citation accuracy "up" is
 * an improvement, and on cost it is a regression. A KNOWN zero is neutral in
 * both — nothing about a flat metric should read as progress.
 */
export function deltaStyle(
  direction: "up" | "down" | "flat",
  invert = false,
): CSSProperties {
  const good = invert ? "down" : "up";
  const bad = invert ? "up" : "down";
  const color =
    direction === good ? "var(--ok)" : direction === bad ? "var(--crit)" : "var(--text-secondary)";
  return { fontSize: 11.5, fontWeight: 600, color };
}
