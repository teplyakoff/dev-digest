# 01 — Run Cost Badge (server)

The API half of the L01 lab feature: persist and expose what each review run
cost, so the studio can show it. The client half is specified in
[`client/docs/specs/01-run-cost-badge.md`](../../../client/docs/specs/01-run-cost-badge.md).

## Problem

A review run spends real money, and today the number is thrown away. The engine
already computes it — `ReviewOutcome.costUsd` arrives in
`src/modules/reviews/run-executor.ts` alongside `tokensIn` / `tokensOut` — but
the executor destructures only the tokens, so the cost never reaches the
database or any route. `agent_runs` has `tokens_in` / `tokens_out` and no cost
column.

Nobody can answer "what did this run cost?", "what has this PR cost so far?", or
"is the expensive model worth it?" without opening the OpenRouter dashboard.

## Where the number comes from

No new model calls, no new provider work. The chain already exists:

1. `reviewer-core/src/llm/openrouter.ts` sends `usage: { include: true }` to
   OpenRouter and reads the **real** generation cost from `usage.cost`.
2. When the provider doesn't report a cost (OpenAI, Anthropic, a cold
   OpenRouter response), it falls back to the injected `estimateCost` hook.
   `platform/container.ts` injects `PriceBook.estimate` — live OpenRouter
   `/models` prices, 6h TTL — which itself falls back to the static table in
   `adapters/llm/pricing.ts`.
3. Unknown model slug → `estimateCost` returns `null`.
4. `reviewer-core/src/review/run.ts` sums per-chunk costs across a map-reduce
   run with **null poisoning**: if any chunk's cost is unknown, the run's cost is
   `null`. A partially-known total would be a lie, so we don't report one.

Pricing stays on the server. `reviewer-core` must not gain a price table — its
invariant is "no side effects except the injected `LLMProvider`".

## Behaviour

**Persist.** On a successful run, `completeAgentRun` writes `cost_usd` together
with the tokens, and the same value goes into the run trace's `stats.cost_usd`.

**Never fake a number.** A failed, cancelled, or still-running run stores
`cost_usd = null`, not `0`. `0` is a legitimate value (free models exist), so
the two states must stay distinguishable end to end. The pre-work failure path
(`failAll`) and `traceFromBuffer` write `null` for the same reason.

**Expose.**

| Route | Field | Semantics |
|---|---|---|
| `GET /pulls/:id/runs` | `RunSummary.cost_usd` | this run's cost |
| `GET /runs/:id/trace` | `RunStats.cost_usd` | this run's cost |
| `GET /repos/:id/pulls` | `PrMeta.cost_usd` | **latest completed run** of that PR |

`PrMeta.cost_usd` is denormalized on read, exactly like the existing latest-review
`score`: one `IN` query over `agent_runs` (`status = 'done'`, newest first),
grouped in JS. It is a *list-endpoint-only* field — deliberately the latest run,
not a per-PR total, so it stays symmetric with the `score` column next to it.

## Contract

`cost_usd` is nullable USD, `number` — matching the existing `AgentColumn.cost_usd`
in `contracts/observability.ts` and the `cost_usd` columns on `ci_runs` /
`eval_runs`.

```ts
// contracts/trace.ts
RunStats   → cost_usd: z.number().nullable()
RunSummary → cost_usd: z.number().nullable()

// contracts/platform.ts
PrMeta     → cost_usd: z.number().nullish()   // list endpoint only
```

Contracts are vendored twice — `server/src/vendor/shared/**` and
`client/src/vendor/shared/**` — with no re-vendor script. Both copies must be
edited together or the client's types silently drift from the wire format.

## Schema

`agent_runs` gains `cost_usd double precision` (nullable). Generate the
migration with `pnpm db:generate`; never hand-write it and never edit an applied
one. Migrations do not run on boot — apply with `pnpm db:migrate`, or the API
answers `relation ... does not exist`.

## Verification

- `pnpm exec vitest run .it.test` — `reviews.it.test.ts` asserts that after a
  run the `agent_runs` row has a non-null `cost_usd` (`MockLLMProvider` reports
  `costUsd: 0.001` per call), that `GET /pulls/:id/runs` carries it, and that
  `GET /runs/:id/trace` exposes `stats.cost_usd`. A cancelled run asserts
  `cost_usd === null`.
- `pnpm exec vitest run --exclude '**/*.it.test.ts'` — `contracts.test.ts`
  parses a `RunTrace` fixture that includes `stats.cost_usd`.
- Live check, on one run against `openrouter`: the persisted `cost_usd` must
  equal the sum of `usage.cost` in that run's log and the figure OpenRouter's
  dashboard reports for the same generation.

`pnpm db:seed` creates a review but **no** `agent_runs` rows, so on freshly
seeded data every cost is legitimately absent. Only a live run exercises the
real number.
