import type { CSSProperties } from "react";
import type { BriefRiskLevel } from "@devdigest/shared";

/**
 * The three risk colours, reusing the tokens the rest of the app already spends
 * on severity — `--crit` / `--warn` / `--ok`. Three DIFFERENT tokens is the
 * property AC-37 is about; the accompanying text (NFR-7) is in the component,
 * because colour alone is not a readable risk level.
 */
const RISK_COLOR: Record<BriefRiskLevel, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--ok)",
};

/** The whole computed style for a risk pill, same reason as above. */
export function riskPillFor(level: BriefRiskLevel): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: RISK_COLOR[level],
    background: "transparent",
    border: `1px solid ${RISK_COLOR[level]}`,
    whiteSpace: "nowrap",
  };
}

/** The severity dot on one risk row — the same three tokens, smaller. */
export function riskDotFor(level: BriefRiskLevel): CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: 99,
    flexShrink: 0,
    marginTop: 6,
    background: RISK_COLOR[level],
  };
}

export const s = {
  wrap: { marginBottom: 18 } satisfies CSSProperties,
  headerActions: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  headline: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  } satisfies CSSProperties,
  what: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  why: {
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    margin: "6px 0 0",
    paddingLeft: 12,
    borderLeft: "2px solid var(--border-strong)",
  } satisfies CSSProperties,
  section: { marginTop: 18 } satisfies CSSProperties,
  colLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  riskList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  riskRow: { display: "flex", gap: 8, alignItems: "flex-start" } satisfies CSSProperties,
  riskTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  riskBody: { fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  riskRefs: {
    display: "block",
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 2,
  } satisfies CSSProperties,
  focusList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  /** A real `<button>`: keyboard-activable without a mouse (NFR-7), and the
   *  affordance is a navigation the reviewer can also reach with Tab. */
  focusButton: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "none",
    borderRadius: 6,
    padding: "4px 6px",
    cursor: "pointer",
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  focusPath: {
    color: "var(--accent)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "48%",
    flexShrink: 0,
  } satisfies CSSProperties,
  focusReason: {
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  focusMore: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 8,
    display: "block",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  emptyState: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  footer: {
    marginTop: 16,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  footerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /**
   * Warning-coloured for the same reason `IntentCard`'s missing-context line is:
   * a brief assembled on a partial input and one assembled on the whole thing
   * render identically without it (AC-56).
   */
  dropped: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--warn)",
  } satisfies CSSProperties,
  droppedIcon: { flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  ungrounded: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--warn)",
    marginBottom: 8,
  } satisfies CSSProperties,
} as const;
