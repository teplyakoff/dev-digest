import type { CSSProperties } from "react";

/* Co-located styles for the Evals tab (design: `screen_agents.jsx:157-178`).

   Style OBJECTS consumed as `style={s.x}`. A spread in JSX
   (`style={{ ...s.a, ...s.b }}`) is TWO `no-restricted-syntax` lint errors, not
   zero (`client/INSIGHTS.md`) — anything computed is a FUNCTION here returning
   the whole style object, the same shape `EvalMetricStrip/styles.ts` uses. */

export const s = {
  wrap: { maxWidth: 720 } satisfies CSSProperties,
  subtitle: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginTop: -6,
    marginBottom: 12,
  } satisfies CSSProperties,
  /**
   * The "View full dashboard →" link in the metrics header.
   *
   * A plain `next/link` carrying these styles rather than the `MonoLink`
   * primitive: `MonoLink` switches ELEMENT TYPE by prop — with an `href` it is
   * an `<a target="_blank">`, without one a `<button>` — so it is wrong for
   * in-app navigation either way, and wrapping it in a `next/link` nests a
   * button inside an anchor (`client/INSIGHTS.md`, 2026-08-05).
   */
  viewDashboard: {
    fontSize: 12.5,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
  /** The "scoring is mechanical" note under the strip — icon + one line. */
  note: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  noteIcon: { flexShrink: 0, color: "var(--text-muted)" } satisfies CSSProperties,
  casesHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 22,
    marginBottom: 14,
  } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  /** `N eval cases · gold set · N runs`, straight off the fetched set (AC-75). */
  summary: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  loading: { fontSize: 12.5, color: "var(--text-muted)", padding: "16px 0" } satisfies CSSProperties,
  /**
   * The server's own reason for a refused run (409 concurrent batch, 422 empty
   * set), shown verbatim rather than replaced by a generic sentence — the same
   * rule the seeding path follows for its 422.
   */
  error: {
    marginTop: 10,
    padding: "8px 11px",
    borderRadius: 7,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 12,
  } satisfies CSSProperties,
} as const;
