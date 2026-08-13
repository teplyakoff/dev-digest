import type { CSSProperties } from "react";

/** Co-located styles for BlastTab (style OBJECTS, as everywhere in this route —
    consumed as `style={s.x}`, never as class strings). */
export const s = {
  summaryStrip: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 14,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  sep: { color: "var(--text-muted)" } satisfies CSSProperties,
  sha: { color: "var(--text-muted)", marginLeft: "auto" } satisfies CSSProperties,

  /** Partial-index banner. Warning-coloured because the caveat is the point:
      an absent caller under a partial index proves nothing. */
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    background: "var(--warn-bg)",
    padding: 14,
    marginBottom: 16,
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  bannerTitle: {
    fontSize: 13.5,
    fontWeight: 650,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  bannerBody: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginTop: 6,
    lineHeight: 1.5,
  } satisfies CSSProperties,

  section: { marginBottom: 22 } satisfies CSSProperties,

  // ---- Symbol node --------------------------------------------------------
  symbolCard: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--surface)",
    marginBottom: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  symbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "10px 12px",
    background: "none",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  symbolName: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  symbolKind: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  symbolCount: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,

  callerList: {
    listStyle: "none",
    margin: 0,
    padding: "0 12px 10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    paddingLeft: 20,
  } satisfies CSSProperties,
  callerArrow: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  callerSymbol: { color: "var(--text-muted)" } satisfies CSSProperties,
  /** The fallback when there is no repo/sha to build a link from — same text,
      no affordance, rather than a link that goes nowhere. */
  callerPlain: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  noCallers: {
    padding: "0 12px 10px 32px",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  // ---- Downstream chips ---------------------------------------------------
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12.5,
    background: "var(--surface-2)",
  } satisfies CSSProperties,
  chipRoute: { color: "var(--text-primary)" } satisfies CSSProperties,
  chipDepth: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  emptyLine: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
};

/**
 * A downstream chip, tinted by DISTANCE rather than by method.
 *
 * The reviewer's question is "how sure are we this is affected", and depth is
 * the only thing on the row that answers it. Colouring by HTTP verb instead
 * would spend the strongest visual channel on the least decisive fact.
 *
 * Returns the WHOLE style rather than an accent to merge at the call site: a
 * spread in JSX is an inline object, which this repo's lint rejects (and which
 * is a new reference on every render).
 */
export function chipStyle(depth: number): CSSProperties {
  if (depth <= 0) {
    return { ...s.chip, borderColor: "var(--accent)", color: "var(--accent-text)" };
  }
  if (depth === 1) return { ...s.chip, borderColor: "var(--border-strong)" };
  return s.chip;
}
