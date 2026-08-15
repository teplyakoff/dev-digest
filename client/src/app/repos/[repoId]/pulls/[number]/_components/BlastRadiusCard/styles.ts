import type { CSSProperties } from "react";

/** Co-located styles, ported from `blast.jsx` in the L02 design bundle
    (`_assets/L02/DevDigest Design (standalone) (3).html`). Numbers that look
    arbitrary — 12.5 px type, 18 px indent, the 10 px connector offset — are the
    design's, not guesses. */
export const s = {
  // ---- header: stat row + view toggle -------------------------------------
  header: {
    display: "flex",
    alignItems: "center",
    marginBottom: 10,
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  statRow: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    alignItems: "center",
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "var(--text-secondary)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  statIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  statNum: { color: "var(--text-primary)", fontWeight: 650 } satisfies CSSProperties,

  toggle: {
    marginLeft: "auto",
    display: "flex",
    gap: 2,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 2,
  } satisfies CSSProperties,

  sha: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,

  // ---- tree ---------------------------------------------------------------
  tree: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  symbolHeaderBase: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 6px",
    borderRadius: 6,
    cursor: "pointer",
    width: "100%",
    border: "none",
    textAlign: "left",
  } satisfies CSSProperties,
  chevron: { color: "var(--text-muted)", transition: "transform .12s" } satisfies CSSProperties,
  symbolIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  symbolName: { fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  symbolCount: { fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" } satisfies CSSProperties,
  symbolBody: { padding: "4px 0 8px 14px" } satisfies CSSProperties,

  callerName: { color: "var(--text-muted)", fontSize: 11.5 } satisfies CSSProperties,
  /** Same text, no affordance — used when there is no sha to build a URL from. */
  callerPlain: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  noCallers: { fontSize: 12, color: "var(--text-muted)", padding: "2px 0 4px 18px" } satisfies CSSProperties,

  chipRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    padding: "8px 0 2px 18px",
  } satisfies CSSProperties,
  cronRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    padding: "6px 0 2px 18px",
  } satisfies CSSProperties,

  orphanGroup: { marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  orphanLabel: { fontSize: 11.5, color: "var(--text-muted)", marginBottom: 6 } satisfies CSSProperties,

  // ---- graph --------------------------------------------------------------
  graphScroll: { overflowX: "auto" } satisfies CSSProperties,
  graphSvg: { display: "block" } satisfies CSSProperties,
  legend: {
    display: "flex",
    gap: 14,
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 8,
    paddingLeft: 4,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  graphCaption: { fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 } satisfies CSSProperties,

  // ---- states -------------------------------------------------------------
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    background: "var(--warn-bg)",
    padding: 12,
    marginBottom: 12,
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  bannerTitle: { fontSize: 13, fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,
  bannerBody: { fontSize: 12, color: "var(--text-secondary)", marginTop: 5, lineHeight: 1.5 } satisfies CSSProperties,
  emptyLine: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
};

/** A tab of the Tree | Graph switch. Whole style returned, never spread at the
    call site — a spread in JSX is an inline object the lint bans. */
export function viewTabStyle(active: boolean): CSSProperties {
  return {
    padding: "3px 10px",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 5,
    border: "none",
    textTransform: "capitalize",
    cursor: "pointer",
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  };
}

/** The symbol row, which the design tints when expanded. */
export function symbolHeaderStyle(open: boolean): CSSProperties {
  return { ...s.symbolHeaderBase, background: open ? "var(--bg-hover)" : "transparent" };
}

/** Chevron rotation — the design rotates one icon rather than swapping two. */
export function chevronStyle(open: boolean): CSSProperties {
  return { ...s.chevron, transform: open ? "rotate(90deg)" : "none" };
}

/**
 * One row of the tree, indented by depth.
 *
 * The connector lines are absolutely positioned against this padding, so the
 * 18 px step and the 10 px back-offset have to agree with `connectorStyle`.
 */
export function treeRowStyle(depth: number): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "3px 0",
    paddingLeft: depth * 18,
    position: "relative",
    fontSize: 12.5,
  };
}

/** The vertical guide; stops halfway down on the last child so the elbow closes. */
export function connectorVerticalStyle(depth: number, last: boolean): CSSProperties {
  return {
    position: "absolute",
    left: depth * 18 - 10,
    top: 0,
    bottom: last ? "50%" : 0,
    width: 1,
    background: "var(--border-strong)",
  };
}

/** The horizontal elbow into the row. */
export function connectorElbowStyle(depth: number): CSSProperties {
  return {
    position: "absolute",
    left: depth * 18 - 10,
    top: "50%",
    width: 8,
    height: 1,
    background: "var(--border-strong)",
  };
}
