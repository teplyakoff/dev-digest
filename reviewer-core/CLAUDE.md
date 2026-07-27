# `@devdigest/reviewer-core` — the review engine

Pure logic: diff → prompt → LLM → grounded findings. The pipeline diagram and the
public API are in `README.md` — do not restate them here.

## Commands (npm, NOT pnpm)

`npm test` — vitest with a stubbed `LLMProvider`; no keys, no network.
`npm run typecheck` · `npm run build` is also a type-check: **this package never
emits JS.** The server consumes its raw TypeScript through a path alias.

## Map

`prompt.ts` (assembly + injection guard) · `grounding.ts` (the citation gate) ·
`llm/` (provider + structured output) · `review/run.ts` (orchestration) ·
`review/reduce.ts` · `output/to-review.ts` (CI payload)

## Conventions

- **No side effects except the injected `LLMProvider`.** No DB, no GitHub, no
  filesystem, no `process.env`. That purity is the whole point — it is what makes
  the engine mock-testable. If you need I/O, it belongs in the server.
- Every piece of external content is wrapped with `wrapUntrusted()` before it can
  reach the model. No exceptions.
- The score is computed from the findings that survived grounding. Never trust
  the model's self-reported score.
- Optional prompt slots (`skills`, `memory`, `specs`, `callers`) are omitted when
  empty — later lessons start filling them. Leave the slots in place.

## Do not touch

`INJECTION_GUARD` (`prompt.ts`) and `groundFindings` (`grounding.ts`) are the
product's two safety gates. Change them deliberately and with a test, never in
passing while doing something else.

## Read when

- you need to see how the server calls this → `../server/src/modules/reviews/run-executor.ts`
- specifying new work → `docs/specs/`

Before working here read `INSIGHTS.md`; append to it at the end of the session.
