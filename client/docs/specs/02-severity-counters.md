# 02 — Severity Counters (client)

The studio half of the L01 homework feature: show what *kind* of problems a
review found — «3 CRITICAL · 5 WARNING · 2 SUGGESTION» — everywhere a run's
outcome is summarized, with the finding details one hover away. The API half is
specified in
[`server/docs/specs/02-severity-counters.md`](../../../server/docs/specs/02-severity-counters.md).

## Problem

A review's outcome is currently a single number («3 finding(s) · 1 blocker(s)»).
Three suggestions and three criticals read identically. The severity split is
the triage signal — it decides whether you open the PR now or after lunch — and
today it exists only inside the findings list itself.

## Behaviour

One new shared component pair on three surfaces.

### The component

`src/components/severity-counters/` — shared, because two route levels use it
(the `run-cost-badge/` precedent). Not in `src/vendor/ui`, which is vendored
and off-limits; the severity colours, icons and labels come from the vendored
`SEV` tokens, same source as `SeverityBadge`.

```tsx
<SeverityCounters findings={items} />                       // chips, hover popup
<SeverityCounters findings={null} />                        // "—" (unreviewed)
<SeverityCounters findings={items} counts={serverCounts}
                  placement="up" width={360}
                  suffix={<span>· 2 blockers</span>} />
```

Each severity with a non-zero count renders as `<icon> <count>` in the severity
colour with a dotted underline and `cursor: help` — the design bundle's
`FindingsCell` / `RunFindings` markup. `findings == null` **and** all-zero
counts both render a muted `—`; a popup only exists when there are findings.
`counts` is optional — when the server has pre-aggregated (`PrMeta`), pass it;
otherwise it is derived with `countBySeverity(findings)`.

`findings` is a structural `SlimFinding` type satisfied by both `PrListFinding`
(list payload) and `FindingRecord` (reviews payload) — that is what makes the
timeline surface a zero-fetch join.

### The popup

`FindingsPopover`, a port of the design's `FindingsTooltip`: absolutely
positioned under (or above, `placement="up"`) the chips, width 360–380,
`--bg-elevated` / `--border-strong` / radius 10 / `--shadow-modal`, `ddpop`
animation; uppercase «N findings» header; a scrollable column (max 300px) of
findings sorted by severity, each with a compact `SeverityBadge`, title,
`CategoryTag`, mono `file:start[-end]` line ref, `ConfidenceNum`, and the
rationale stripped of markdown and clamped to two lines.

Hover-triggered: the popover is a child of the `mouseenter`/`mouseleave`
wrapper, so moving the pointer into it keeps it open and no click-outside
logic is needed.

### Surface 1 — PR list (`/repos/:repoId/pulls`)

A **FINDINGS** column between SCORE and STATUS (the design's position), reading
`PrMeta.findings_by_severity` / `PrMeta.latest_findings` — the latest review,
symmetric with SCORE. Never reviewed → `—`, exactly like SCORE and COST.
The cell stops click propagation (the row navigates) and rows in the bottom
half of the list open the popup upward (`idx >= Math.ceil(total / 2)`).

The table is a CSS grid: the column is added by extending `GRID` and
`COLUMN_KEYS` in `pulls/constants.ts`. The card's `overflow: hidden` clipped
absolute popups and becomes `visible` — the design's list container does the
same, for the same reason.

### Surface 2 — PR detail, findings panel (filter chips)

Inside each `FindingsPanel` (per review accordion — that is where the list the
chips filter lives): a chips row above the findings, one `Chip` per severity
with its icon, colour and count, then a hairline divider; the existing
«Hide low confidence» toggle moves to the right edge.

**Filter semantics: independent toggles** (the design-file behaviour, chosen
over the assignment's literal solo reading): every chip starts active; clicking
one toggles that severity off/on; the visible list is the union of active
severities, then the hideLow filter, then the severity sort. All chips off is a
legal state and shows the existing "no findings match" empty state. Severities
outside the three filterable ones (`INFO`) are never hidden.

### Surface 3 — Agent Runs timeline rows

For each settled run whose review still exists, the «N finding(s) · M
blocker(s)» text line is replaced by the severity chips plus a muted
«· M blocker(s)» suffix, popup included. The data is a client-side join —
`FindingsTab` already fetches reviews (`usePrReviews`), builds
`Map<review.run_id, findings>` and passes it down; `RunSummary` is unchanged.
Runs without a joinable review (deleted review, summary kind) keep the legacy
text line as the fallback.

## Rules that hold everywhere

- **`—`, never a fake zero row.** `null`/absent and all-zero both render `—`;
  a popup never renders for an empty findings list.
- **Zero extra fetches.** The list rides on `usePulls`; the timeline joins
  `usePrReviews` × `usePrRuns`, both already on the page. No `fetch` in a
  component; no new hook.
- Severity colours/icons/labels come from the vendored `SEV` tokens only — no
  fourth ad-hoc severity map. (Three route-local maps already drift;
  `RunTraceDrawer`'s `FindingsSection` maps SUGGESTION to `--accent`,
  inconsistent with `--sugg` — flagged as follow-up, not touched here.)
- User-facing text through next-intl: `list.columns.findings` (prReview),
  `severityCounters.count` (common). Chip labels come from `SEV[sv].label`,
  the same source `SeverityBadge` already uses.

## Verification

- `pnpm test` — `SeverityCounters.test.tsx` covers chips per non-zero severity,
  the `—` states (null and all-zero), hover mounting/unmounting the popup, line
  ref collapsing (`:11` vs `:3-9`), suffix rendering; `PRRow.test.tsx` the
  FINDINGS cell + `—`; `FindingsPanel.test.tsx` chip toggling incl. the all-off
  empty state and composition with hideLow; `RunHistory.test.tsx` chips with
  blockers suffix and the legacy-text fallback.
- `pnpm typecheck`.
- Manually on seeded data (`pnpm db:seed` creates a review with 1 CRITICAL +
  1 WARNING): the FINDINGS column shows chips on the seeded PR and `—`
  elsewhere; a bottom-half row opens its popup upward; clicking inside the
  popup does not navigate; the panel chips filter and restore; both themes.
  Timeline chips need a live run (seed writes no `agent_runs` rows).
