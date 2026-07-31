# 02 — Severity Counters (server)

The API half of the L01 homework feature: expose per-severity finding counts —
and the findings behind them — on the PR list, so the studio can show
«3 CRITICAL · 5 WARNING · 2 SUGGESTION» without a click-through. The client half
is specified in
[`client/docs/specs/02-severity-counters.md`](../../../client/docs/specs/02-severity-counters.md).

## Problem

Findings are persisted per review with a severity (`CRITICAL | WARNING |
SUGGESTION`, uppercase, validated by the `Severity` contract), but the PR list
exposes only a score and a cost. To learn whether a CRITICAL is waiting in a PR
you must open it. The list answers "how good is this PR?" (score) and "what did
it cost?" (cost) but not the question a reviewer actually triages by: "what kind
of problems are in it?"

## A reversed decision

`modules/pulls/routes.ts` used to state, next to the latest-review score block:

> The per-severity FINDINGS breakdown is intentionally not surfaced on the list
> — findings live on the PR detail page.

This spec reverses that decision: the FINDINGS column **is** the L01 assignment,
and the hover popup keeps the list glanceable without a click-through. The
comment in `routes.ts` now points here.

## Where the data comes from

No new model calls, no schema change, no migration. `findings.severity` is
already persisted uppercase by `insertFindings`
(`modules/reviews/repository/review.repo.ts`) from the validated `Finding`
contract; the engine's grounding pass has already dropped anything that doesn't
cite a real diff line. The list route only aggregates what is already there.

Counts come from the PR's **latest review** — symmetric with the `score` column
computed from the same review, and with `cost_usd` from the latest done run.
Dismissed findings are **included**: the popup lists exactly what is counted,
and dismissal state lives on the PR detail page where it can be acted on.

## Behaviour

| Route | Field | Semantics |
|---|---|---|
| `GET /repos/:id/pulls` | `PrMeta.findings_by_severity` | latest review's counts, zero-seeded |
| `GET /repos/:id/pulls` | `PrMeta.latest_findings` | the same review's findings, slim, for the popup |

Both are *list-endpoint-only* fields (nullish), exactly like `PrMeta.cost_usd`:
the two `PrDetail` return paths never set them — the detail page derives its
counters from `GET /pulls/:id/reviews`, which already carries full findings.

`GET /pulls/:id/runs` is unchanged. The Agent Runs timeline chips are a
client-side join of `RunSummary` × `ReviewRecord.run_id` on data the page
already fetches.

**Null vs zero.** `null` = never reviewed. `{CRITICAL: 0, WARNING: 0,
SUGGESTION: 0}` + `[]` = a real, clean review. The rule extends the established
`cost_usd = null` semantics: never fake a zero, never null a real one. A
finding dropped by grounding produces a real `0` in its severity, not `null`.

## Contract

```ts
// contracts/platform.ts
export const PrListFinding = z.object({
  severity: Severity,            // from contracts/findings.ts
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  confidence: z.number(),
  rationale: z.string(),         // markdown; the client strips **/` and clamps
});

PrMeta → findings_by_severity: z.object({
           CRITICAL: z.number().int(),
           WARNING: z.number().int(),
           SUGGESTION: z.number().int(),
         }).nullish(),           // list endpoint only
         latest_findings: z.array(PrListFinding).nullish(),
```

`findings_by_severity` reuses the exact key shape of
`AgentStats.findings_by_severity` (`contracts/observability.ts`) rather than
inventing a lowercase variant. `PrListFinding` is a superset of
`AgentColumnFinding` — the popup additionally needs `end_line`, `confidence`
and `rationale`.

Keeping the counter object alongside the array is deliberate: counts are
derivable, but an explicit object means a future cap on the popup array cannot
corrupt the counters.

Contracts are vendored twice — `server/src/vendor/shared/**` and
`client/src/vendor/shared/**` — with no re-vendor script. Both copies must be
edited together or the client's types silently drift from the wire format.

## Implementation shape

A third read-time aggregation block in the list handler, mirroring score and
cost: the latest-review grouping additionally keeps the review `id`, then one
`IN` query over `findings` for those ids, grouped in JS. `countBySeverity`
lives in `modules/pulls/severity.ts` as a pure, zero-seeded helper (the idiom
from `reviewer-core/src/output/to-review.ts`); unknown severity strings are
counted nowhere.

## Verification

- `pnpm exec vitest run --exclude '**/*.it.test.ts'` — `pulls-severity.test.ts`
  covers `countBySeverity` (empty → zeros, mixed, unknown severity ignored);
  `contracts.test.ts` parses a `PrMeta` fixture with the new fields and a
  legacy fixture without them.
- `pnpm exec vitest run .it.test` — `reviews.it.test.ts` runs a review whose
  fixture carries CRITICAL + WARNING + SUGGESTION where grounding drops the
  WARNING, then asserts the list returns
  `{CRITICAL: 1, WARNING: 0, SUGGESTION: 1}` — the `WARNING: 0` real-zero is
  the load-bearing assertion — and that a PR whose only run failed stays
  `null`, not zeros.
- `pnpm db:seed` **does** create a review with findings (unlike `agent_runs`),
  so the column is verifiable on seeded data without a live run.
