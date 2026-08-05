import type { CSSProperties } from "react";

/**
 * The gutter and the textarea must agree on `fontSize`, `lineHeight`,
 * `fontFamily` and vertical padding or the numbers drift from their lines a
 * little further with every row. They are declared once here and spread into
 * both, so the pair cannot be edited apart.
 */
const TYPE: CSSProperties = {
  fontSize: 13,
  lineHeight: `${20}px`,
  fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
};

const LINE = 20;
const PAD_Y = 10;

/** Annotated rather than inferred: spreading `TYPE` into these makes TypeScript
 *  want to name `csstype`'s internals, which it cannot do portably (TS2742). */
export const s: {
  frame: (rows: number) => CSSProperties;
  gutter: CSSProperties;
  gutterLine: CSSProperties;
  input: CSSProperties;
} = {
  /**
   * Height is pinned from `rows` on purpose. The frame is a flex row, so with an
   * `auto` height the tallest child wins — and the gutter has no reason to be
   * short, since it renders one div per line. A 300-line skill would then render
   * a 6000 px editor and neither child would ever scroll, which also quietly
   * kills the gutter's scroll sync.
   */
  frame: (rows: number): CSSProperties => ({
    display: "flex",
    alignItems: "stretch",
    boxSizing: "border-box",
    width: "100%",
    height: rows * LINE + PAD_Y * 2,
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
    // Resizing the frame, not the textarea inside it — the child is height:100%
    // and would otherwise be dragged out of step with the gutter.
    resize: "vertical",
  }),

  gutter: {
    ...TYPE,
    flexShrink: 0,
    padding: `${PAD_Y}px 8px`,
    textAlign: "right",
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    borderRight: "1px solid var(--border)",
    userSelect: "none",
    // Scrolled programmatically in step with the textarea; its own scrollbar
    // would let the two drift apart.
    overflow: "hidden",
  },

  gutterLine: { whiteSpace: "pre" },

  input: {
    ...TYPE,
    flex: 1,
    minWidth: 0,
    height: "100%",
    boxSizing: "border-box",
    padding: `${PAD_Y}px 12px`,
    border: "none",
    background: "transparent",
    color: "var(--text-primary)",
    outline: "none",
    resize: "none",
    // `wrap="off"` is what makes a gutter honest: one logical line renders as
    // one visual row, so line N of the body really is beside the number N.
    // Soft wrapping would silently offset every number below the first wrap.
    whiteSpace: "pre",
    overflow: "auto",
  },
};
