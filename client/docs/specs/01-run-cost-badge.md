# 01 — Run Cost Badge (client)

The studio half of the L01 lab feature: show what each review run cost. The API
half — where the number comes from and how it is persisted — is specified in
[`server/docs/specs/01-run-cost-badge.md`](../../../server/docs/specs/01-run-cost-badge.md).

## Problem

You press **Run Review** and have no idea whether you just spent $0.001 or
$0.20. Cost is the first metric a user can act on — it decides whether the
stronger model is worth it on the agent that gates merges — and today it is
invisible everywhere in the UI.

## Behaviour

One new component, `RunCostBadge`, in two variants, on three surfaces.

### The component

`src/components/run-cost-badge/` — shared, because two route levels use it. Not
in `src/vendor/ui`, which is vendored and off-limits.

```tsx
<RunCostBadge usd={0.012} />                                   // "$0.012"
<RunCostBadge usd={0.014} tokensIn={8200} tokensOut={1300} size="lg" />
                                                               // "$0.014  8.2K→1.3K"
```

It renders as **text, not a pill**: `mono tnum`, 11.5px (13px at `size="lg"`),
weight 500, `var(--text-secondary)`; the optional token flow sits 6px to its
right in `var(--text-muted)` at weight 400; native `title` tooltip. This mirrors
`CostBadge` in the design bundle (`primitives.jsx`), which is the visual source
of truth — `ConfidenceNum` is the closest existing component in the codebase.

### Formatting

`formatCost(usd)`:

| Input | Output | Why |
|---|---|---|
| `null` / `undefined` | `—` | no run, or a run with no cost data |
| `0` | `$0` | free models are real; not the same as "unknown" |
| `≥ 1` | `$1.50` | 2 decimals |
| `≥ 0.01` | `$0.012` | 3 decimals — **never** `$0.01` |
| `> 0` | `$0.0013` | 4 decimals, so sub-cent runs don't collapse to `$0.00` |

The `> 0 → 4 decimals` branch is a deliberate refinement of the design's plain
`usd < 1 ? toFixed(3)`: a typical OpenRouter run costs ~$0.0013, which 3 decimals
would render as `$0.001`. Rounding a real cost down to zero is the one failure
mode this feature exists to avoid.

`formatTokenFlow(in, out)` → `"8.2K→1.3K"`. Note the existing `formatTokens` in
`RunTraceDrawer/helpers.ts` uses lowercase `"15k→1.2k"` for the TOKENS stat tile;
that tile is unchanged, so both formats coexist by design.

### Surface 1 — PR list (`/repos/:repoId/pulls`)

A **COST** column between STATUS and UPDATED, showing the cost of that PR's
latest completed run (`PrMeta.cost_usd`), dollars only. Never reviewed → `—`,
consistent with how the SCORE column already renders an unreviewed PR.

The table is a CSS grid, not a `<table>`: the column is added by extending `GRID`
and `COLUMN_KEYS` in `pulls/constants.ts`, which the header row and `PRRow`
share.

### Surface 2 — PR detail, "Agent runs" tab

Three placements, matching the design:

- **Verdict banner** — under `CircularScore` / `PR SCORE`, separated by a
  hairline rule, prefixed with an 11px `Icon.DollarSign`: the `size="lg"`
  variant with tokens (`$0.014  8.2K→1.3K`). `VerdictBanner` has no run data
  today, so `ReviewRunAccordion` matches `review.run_id` against the
  `RunSummary` list from `usePrRuns` and passes cost + tokens down.
- **Timeline row** — under the timestamp, `mono tnum` 11px
  `var(--text-secondary)`: `9,119 tok · $0.0013`. Only for `status === "done"`.
- **Review run card header** — the compact variant between the score badge and
  the timestamp.

### Surface 3 — Run trace drawer

A fourth `Stat` tile, `COST`, after `TOKENS` in the Stats section, reading
`trace.stats.cost_usd`.

## Rules that hold everywhere

- **A run with no cost data shows `—`, never `$0.00`.** Failed, cancelled and
  in-flight runs persist `cost_usd = null`; `0` means a genuinely free run.
- **Zero extra model calls.** Every number already exists in data the page
  fetches; nothing new is requested and nothing is computed from a client-side
  price table.
- Data comes only through the existing hooks (`usePulls`, `usePrRuns`,
  `useRunTrace`) — no `fetch` in a component.
- All user-facing text goes through next-intl (`list.columns.cost`,
  `trace.stat.cost`), never hardcoded in JSX.

## Verification

- `pnpm test` — `RunCostBadge.test.tsx` covers the format table above and the
  token variant; `PRRow.test.tsx` covers the COST cell and its `—` state;
  `RunHistory.test.tsx` / `RunTraceDrawer.test.tsx` fixtures carry `cost_usd`.
- `pnpm typecheck`.
- Manually, after a live run: the badge, the trace tile and the run log must all
  show the same number, formatted with at least three significant digits
  (`$0.012`, not `$0.01`). Cancel a run mid-flight and confirm `—`. Check both
  themes — the badge is built on `var(--text-secondary)` / `var(--text-muted)`.

`pnpm db:seed` creates no `agent_runs` rows, so on seeded data every surface
correctly shows `—`. Browser e2e flows can assert the column header and the `—`
state; the real figures need a live run.
