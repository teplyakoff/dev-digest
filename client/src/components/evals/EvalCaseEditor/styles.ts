import type { CSSProperties } from "react";
import type { DiffLineKind } from "./helpers";

/* Co-located styles for EvalCaseEditor (design: `screen_cirunsevalcase.jsx:55-110`).

   Objects for the fixed parts, a function for the part that varies per diff
   line. A spread in JSX would be two `no-restricted-syntax` errors, so
   `diffLineStyle` returns the WHOLE computed style (`client/INSIGHTS.md`). */

export const s = {
  /** Two columns, inputs left and expectation right, at the design's height. */
  body: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    height: 480,
    minHeight: 0,
  } satisfies CSSProperties,

  // ---- left column: name + input tabs -------------------------------------
  left: {
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  } satisfies CSSProperties,
  nameField: { padding: "14px 16px 0" } satisfies CSSProperties,
  inputLabel: {
    padding: "0 16px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 7,
  } satisfies CSSProperties,
  tabPanel: { flex: 1, overflow: "auto", padding: "12px 16px", minHeight: 0 } satisfies CSSProperties,
  previewLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    margin: "12px 0 6px",
  } satisfies CSSProperties,
  /**
   * The diff preview. Rendered as TEXT — one `<div>` per line inside a `<pre>`,
   * never `dangerouslySetInnerHTML`: a stored `input_diff` comes from a
   * third-party repo and is untrusted content by construction.
   */
  diffPre: {
    margin: 0,
    fontSize: 11.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    background: "var(--code-bg)",
    borderRadius: 7,
    padding: 10,
  } satisfies CSSProperties,

  // ---- right column: expected output ---------------------------------------
  right: { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
  rightHeader: {
    padding: "14px 16px 8px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  rightTitle: { fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  expectedBox: { flex: 1, overflow: "auto", padding: "0 16px 16px", minHeight: 0 } satisfies CSSProperties,

  /**
   * A label that names a control for assistive technology without repeating it
   * on screen. `Textarea` (vendored, frozen) forwards no `aria-label` and takes
   * no `id`, so a WRAPPING label is the only way to give the diff and
   * expected-output boxes an accessible name.
   */
  srOnlyLabel: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,

  // ---- chrome --------------------------------------------------------------
  footer: { display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" } satisfies CSSProperties,
  error: {
    margin: "0 16px 12px",
    padding: "9px 12px",
    borderRadius: 7,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    fontSize: 12.5,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
} as const;

const DIFF_LINE_BG: Record<DiffLineKind, string> = {
  add: "var(--code-add)",
  del: "var(--code-del)",
  hunk: "transparent",
  context: "transparent",
};

/** One diff line's whole computed style — background by kind, hunks accented. */
export function diffLineStyle(kind: DiffLineKind): CSSProperties {
  return {
    background: DIFF_LINE_BG[kind],
    color: kind === "hunk" ? "var(--accent-text)" : "inherit",
  };
}
