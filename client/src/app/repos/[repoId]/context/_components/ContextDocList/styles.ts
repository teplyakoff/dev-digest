import type { CSSProperties } from "react";

/**
 * Co-located styles for the document list.
 *
 * Every entry is either a plain object or a FUNCTION returning the whole
 * computed style. A `{...a, ...b}` spread in JSX is two `no-restricted-syntax`
 * errors, so a row that varies by state composes here rather than at the call
 * site.
 */
export const s = {
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  row: (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid transparent",
    background: selected ? "var(--bg-hover)" : "transparent",
    borderColor: selected ? "var(--border)" : "transparent",
    cursor: "pointer",
    textAlign: "left",
  }),
  name: {
    flex: 1,
    fontSize: 13,
    color: "var(--text-primary)",
    // A long document name truncates rather than pushing the token count off
    // the row; the full name stays reachable through `title`.
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  tokens: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  /**
   * Reached by nobody reads as muted, reached by someone reads as live. A
   * function rather than two exported objects: the caller passes the condition
   * and never assembles the style itself, which is what keeps the JSX free of
   * spread-merged style objects.
   */
  agents: (any: boolean): CSSProperties => ({
    fontSize: 11.5,
    fontWeight: any ? 600 : 400,
    color: any ? "var(--accent)" : "var(--text-muted)",
    flexShrink: 0,
  }),
} as const;
