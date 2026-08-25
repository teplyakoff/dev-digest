import type { CSSProperties } from "react";
import type { Line } from "./helpers";

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
    // Clears the TWO stacked sticky headers above a file card, measured in the
    // running app: the PR header (`PrDetailHeader/styles.ts`, 175 px) and the
    // smart-diff group header (`SmartDiffViewer/styles.ts`, 31 px), both at
    // `top: 0` inside the same scroller. Without it a card scrolled to by
    // `?file=<path>` lands under them: its diff shows and its own header — the
    // file name, the one thing proving the link went where it claimed — does
    // not. `scroll-margin-top` is what the browser subtracts during
    // `scrollIntoView`, so it cannot race the scroll the way a follow-up
    // `scrollBy` would. A wrapped PR title makes the real header taller and
    // costs a row of context, never the file name.
    scrollMarginTop: 214,
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,

  // ---- Smart Diff overlay (opt-in via FileCard's `smart` prop) ------------
  /** Header badge: "N findings", clickable, beside the comment count. */
  findingsBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    padding: "1px 7px",
    borderRadius: 5,
    border: "none",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    cursor: "pointer",
  } satisfies CSSProperties,
  /** Header chip marking a file past LARGE_FILE_LINES. */
  largeChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    padding: "1px 7px",
    borderRadius: 5,
    background: "var(--warn-bg)",
    color: "var(--warn)",
  } satisfies CSSProperties,
  /** Footer list for findings no rendered line can host (see findings.ts). */
  unanchoredWrap: {
    borderTop: "1px solid var(--border)",
    margin: "4px 14px 4px 58px",
    paddingTop: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  unanchoredTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;

/**
 * The 3px full-height rail in the severity colour, on a line that carries a
 * finding. Absolute inside the row, which is why `lineRowFor` takes `anchored`.
 */
export function findingRailFor(color: string): CSSProperties {
  return { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color };
}

/** The right-hand severity tag on a diff line — a real button (it navigates). */
export function findingTagFor(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "0 10px 0 0",
    fontSize: 10.5,
    fontWeight: 600,
    color,
    background: "none",
    border: "none",
    cursor: "pointer",
    flexShrink: 0,
  };
}

/** A finding that could not be anchored to a line, rendered as a chip. */
export function unanchoredChipFor(color: string, bg: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 9px",
    borderRadius: 6,
    border: "none",
    fontSize: 11.5,
    fontWeight: 600,
    color,
    background: bg,
    cursor: "pointer",
    maxWidth: "100%",
  };
}

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/**
 * Row background per line kind (add/del tinted, others transparent).
 *
 * `anchored` adds the containing block the finding rail is positioned against.
 * It is a parameter rather than an unconditional `position: relative` so that a
 * `FileCard` with no `smart` prop emits exactly the style attribute it emits
 * today — the mode separation has to be invisible when the mode is off.
 */
export function lineRowFor(kind: Line["kind"], anchored = false): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return {
    display: "flex",
    alignItems: "stretch",
    fontSize: 13,
    lineHeight: "20px",
    background,
    ...(anchored ? { position: "relative" as const } : {}),
  };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}
