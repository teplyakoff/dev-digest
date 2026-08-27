import type { CSSProperties } from "react";
import type { IconName } from "@devdigest/ui";
import type { EvalCaseStatus } from "../../helpers";

/* Co-located styles for EvalCaseRow (design: `components2.jsx:43-64`).

   Anything that varies is a FUNCTION returning the WHOLE style object. A spread
   in JSX is two `no-restricted-syntax` errors, not zero
   (`client/INSIGHTS.md`). */

export const s = {
  name: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    textAlign: "left",
    maxWidth: 320,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  body: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } satisfies CSSProperties,
  result: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
} as const;

/**
 * The status glyph, one per state.
 *
 * `errored` gets its OWN icon and its own colour — AC-79 exists because reusing
 * the red cross makes "the run itself fell over" indistinguishable from "the
 * agent answered and was wrong", and those two send you to different places.
 * `never` is a neutral dot, never a red cross (AC-78).
 */
export const STATUS_ICON: Record<EvalCaseStatus, { icon: IconName; color: string }> = {
  passed: { icon: "CheckCircle", color: "var(--ok)" },
  failed: { icon: "XCircle", color: "var(--crit)" },
  errored: { icon: "AlertTriangle", color: "var(--warn)" },
  never: { icon: "Dot", color: "var(--text-muted)" },
};

/**
 * The row frame.
 *
 * `highlighted` is the `?case=<id>` deep link landing on its row. Deliberately
 * has NO CSS transition: a transitioned property in this repo's verification
 * pane reports its pre-transition value from `getComputedStyle` forever, which
 * has already cost an hour of chasing a focus ring that was in fact correct
 * (`client/INSIGHTS.md`, 2026-08-10). `scrollMarginTop` keeps the row clear of
 * the tab body's padding when it is scrolled into view.
 */
export function rowStyle(highlighted: boolean, hovered: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: `1px solid ${highlighted ? "var(--accent)" : "var(--border)"}`,
    boxShadow: highlighted ? "0 0 0 2px var(--accent-bg)" : "none",
    background: hovered ? "var(--bg-hover)" : "var(--bg-elevated)",
    marginBottom: 6,
    scrollMarginTop: 24,
  };
}

/** The status glyph's colour, driven by the state map above. */
export function statusIconStyle(status: EvalCaseStatus): CSSProperties {
  return { color: STATUS_ICON[status].color, flexShrink: 0 };
}

/**
 * The expectation-direction pill — MUST FIND / MUST NOT FLAG (AC-82).
 *
 * A badge of its own rather than a colour on the name: the direction changes
 * what a pass MEANS, so it has to be readable without decoding a hue.
 */
export function directionPillStyle(mustFind: boolean): CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.03em",
    padding: "1px 7px",
    borderRadius: 4,
    whiteSpace: "nowrap",
    flexShrink: 0,
    color: mustFind ? "var(--accent-text)" : "var(--text-muted)",
    background: mustFind ? "var(--accent-bg)" : "var(--bg-hover)",
    border: `1px solid ${mustFind ? "var(--accent)" : "var(--border-strong)"}`,
  };
}

/**
 * The action cluster. Hover RAISES the opacity; it never mounts or unmounts the
 * buttons, so every action stays reachable by Tab and by a test that never
 * fires a `mouseenter`.
 */
export function actionsStyle(hovered: boolean): CSSProperties {
  return { display: "flex", gap: 2, flexShrink: 0, opacity: hovered ? 1 : 0.4 };
}
