# server — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

- `./scripts/dev.sh` boots the whole stack from zero and is genuinely idempotent:
  it reuses an already-running `devdigest-postgres` container instead of failing
  on the fixed container name, and re-running installs only what is missing.
  (2026-07-27)

## What Doesn't Work

- `db.select().from(t.repos)` inside an `*.it.test.ts` returns the **seeded** repo,
  not the one your test just created: `beforeAll` runs `seed()`, so
  `acme/payments-api` is row one. A test that builds its own fixture must use the
  row `setupRepoAndPr` hands back. The symptom is a confusing
  `Cannot read properties of undefined` several lines later, when you look your PR
  up in that repo's list and it isn't there. (2026-07-28)

- `pnpm db:seed` inserts a review but **no `agent_runs` row**. Everything derived
  from a run — cost, tokens, duration, the PR timeline — is therefore empty on
  freshly seeded data. An integration or e2e test cannot assert a real value for
  any of them without triggering a run first; asserting the empty state is all
  seeded data can support. (2026-07-28)

- On **pnpm 11**, every `pnpm <script>` in this package fails before running
  anything, with `ERR_PNPM_IGNORED_BUILDS`. pnpm 11 flipped `strictDepBuilds` to
  true, so the automatic pre-run dependency check refuses to pass while any
  dependency's build script is undecided. The fix is `pnpm-workspace.yaml` with
  an `allowBuilds:` map (`cpu-features`, `esbuild`, `protobufjs`, `ssh2` — all
  `false`; none of them need to build, each ships a prebuilt binary via
  optionalDependencies). What does NOT work, and wastes time: a `pnpm` field in
  `package.json`, `strict-dep-builds` in `.npmrc`, and the `npm_config_*` env
  vars — pnpm 11 reads this setting only from `pnpm-workspace.yaml`. (2026-07-27)

## Codebase Patterns

- The Zod contracts are **vendored twice — `server/src/vendor/shared/**` and
  `client/src/vendor/shared/**` — and there is no re-vendor script.** Both
  `CLAUDE.md` files say "edit the source, then re-vendor", but the only mechanism
  is copying by hand. Add a field to one copy only and nothing fails loudly: the
  client type-checks against its own stale copy and simply reads `undefined` at
  runtime. Today the two differ only in comments — keep it that way. (2026-07-28)

- **Cost attribution is injected into the engine, never built into it.**
  `reviewer-core` must stay free of a price table (its no-side-effects
  invariant), so `platform/container.ts` passes `PriceBook.estimate` into
  `OpenRouterProvider` as the `estimateCost` hook. What this means when you read
  a `cost_usd`: on `openrouter` it is the provider's **real** `usage.cost` and
  reconciles with the OpenRouter dashboard; on `openai`/`anthropic` it is an
  estimate from the static table in `adapters/llm/pricing.ts`, which is only as
  fresh as that file. (2026-07-28)

- **`cost_usd = null` means UNKNOWN; `0` means the run was free.** Never collapse
  the two. `estimateCost` returns `null` for an unknown model slug, and
  `reviewer-core/src/review/run.ts` null-poisons the total across map-reduce
  chunks — one unpriced chunk makes the whole run's cost `null` rather than a
  misleading partial sum. The failure/cancel paths in `run-executor.ts` write
  `null` for the same reason, so the UI can show "—" instead of "$0.00".
  (2026-07-28)

## Tool & Library Notes

- The API imports `reviewer-core`'s raw TypeScript through a tsconfig path alias,
  so `reviewer-core/node_modules` must exist or boot dies with
  `ERR_MODULE_NOT_FOUND` — even though nothing in `server/package.json` references
  that package. `scripts/dev.sh` installs it separately, with **npm**, for exactly
  this reason. (2026-07-27)

## Recurring Errors & Fixes

- `relation ... does not exist` on a fresh boot → migrations were never applied.
  The server does not migrate on boot by design. Run `pnpm db:migrate`. (2026-07-27)

## Session Notes

- **2026-07-27** — First boot from zero on this machine. Docker Desktop was not
  running; after starting it, Postgres, migrations and seed all came up clean.
  Verified `/health/ready` → `{"ready":true}` and the seeded demo data (repo
  `acme/payments-api`, PR #482, the built-in agents).

- **2026-07-28** — Built the L01 Run Cost Badge. Almost nothing had to be
  computed: `reviewer-core` already returned `outcome.costUsd` and
  `run-executor.ts` was discarding it. The work was restoring
  `agent_runs.cost_usd` (migration `0010`, the exact inverse of `0009`), putting
  `cost_usd` back on `RunStats`/`RunSummary` and adding it to `PrMeta`, then
  carrying the value through `completeAgentRun`. Verified live against
  openrouter: a 14 289 → 1 499-token run reported $0.001573117, which matches the
  deepseek-v4-flash list price to within rounding.

## Open Questions

- The seeded General Reviewer agent uses `provider: openrouter`, so a review run
  needs `OPENROUTER_API_KEY` — but `.env.example` presents OpenAI/Anthropic
  first. Unclear whether the seed or the example file is the intended default.
