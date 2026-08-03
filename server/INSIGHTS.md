# server — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

- `./scripts/dev.sh` boots the whole stack from zero and is genuinely idempotent:
  it reuses an already-running `devdigest-postgres` container instead of failing
  on the fixed container name, and re-running installs only what is missing.
  (2026-07-27)

- To find out **where a run is actually stuck**, read its SSE replay buffer:
  `curl -s -m 6 -N localhost:3001/runs/<runId>/events`. It replays every event
  from the start of the run, so the last line names the step that never
  returned — far faster than reading the dev server's stdout. Note the buffer is
  per-run but the shared pre-work events (`Loading PR diff…`, `Diff ready — N
  changed file(s); starting M agent run(s)`) appear in *every* run's buffer, so a
  buffer that stops right after "Diff ready" means that agent has not started
  yet, not that it hung. (2026-07-28)

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

- **A review run can hang forever, and one hang wedges every other agent.**
  Nothing on the path sets a deadline: `reviewPullRequest`
  (`reviewer-core/src/review/run.ts`) has no timeout and no `AbortSignal` on the
  LLM call, so a provider request that never answers leaves the run `running`
  indefinitely. Because `run-executor.ts:110` iterates agents **sequentially**,
  the agents queued behind it never start either — all three rows sit in
  `running` while only the first is really doing anything. Seen twice on
  2026-07-28 with `openrouter`/`deepseek-v4-flash`, stuck 20+ min at `Reviewing
  all files in one pass` while a direct `curl` to the same model answered in
  3.7s, so "the provider is up" does not rule this out. `POST /runs/:id/cancel`
  frees the executor and writes `cancelled` + `cost_usd = null`, but does NOT
  abort the in-flight request — the socket stays ESTABLISHED. The boot reaper
  only helps after a restart, so a live hang needs a manual cancel. (2026-07-28)

- **Supersedes the "can hang forever" entry above (2026-07-28): the run does not
  hang, it finishes — eventually — and `cancel` does not stop it.** Checking
  `duration_ms` on the two runs that looked hung: **945 s** and **674 s**, against
  8–99 s for every other run on the same PR and model. So the failure mode is an
  un-bounded provider call that can take 10–16 min, not an infinite one, and the
  sequential loop at `run-executor.ts:110` blocks the queued agents for that whole
  time. The part that actually bites: `POST /runs/:id/cancel` frees the executor
  and writes `cancelled`, but does **not** abort the in-flight request — when the
  call finally returns, `completeAgentRun` overwrites the row back to `done` with
  a real `cost_usd`. Runs `6a63fe8c` / `23ba28d6` / `33cf84f0` were cancelled at
  13:29:27Z, screenshotted as `cancelled` at 13:42Z, and read `done` afterwards.
  Do not trust a `cancelled` row to stay cancelled, and do not bill from one.
  (2026-07-28)

- **Seeded PR files carry `patch: null`.** `GET /pulls/:id` on the seeded
  `acme/payments-api` #482 returns file rows with real `additions`/`deletions`
  but no patch text, so triggering a review against seeded data gives the agent
  nothing to ground findings against. Any work that needs a *real* run — cost,
  tokens, findings — must target a genuinely imported repo with a clone, not the
  seed. (2026-07-28)

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
  `AGENTS.md` files say "edit the source, then re-vendor", but the only mechanism
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

- **A negative decision recorded in a code comment must be reversed in two
  places.** `modules/pulls/routes.ts` used to say the per-severity findings
  breakdown is "intentionally not surfaced on the list"; the severity-counters
  feature reversed that. If only the code changes, the stale comment instructs
  the next reader to restore the old behaviour — so the reversal edits the
  comment *and* names the decision in `docs/specs/02-severity-counters.md`.
  When you reverse a documented "we deliberately don't do X", grep for the
  comment that documents it. (2026-07-31)

- **Nothing in `server/src` opens a database transaction, and there is no `DbTx`
  type.** `grep -rn "\.transaction("` over `server/src` returns zero hits, and
  `db/client.ts` exports only `Db`, `DbHandle` and `createDb`. Every write today
  is a single statement, so the question has never come up. The first multi-write
  operation needs the alias added next to `Db`:
  `export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];` — then
  repository methods take `tx?: DbTx` and resolve `const invoker = tx ?? this.db`,
  so the *service* owns the boundary and the repository stays usable both inside
  and outside a transaction. Do not open a transaction inside a repository method:
  two repositories each opening their own gives two transactions and no
  atomicity. (2026-08-03)

- **A `done` write can no longer resurrect a cancelled run — but only because
  `completeAgentRun` now filters on status.** This closes the 2026-07-28 entry
  above ("cancel does not stop it"): the settle query carries
  `WHERE id = :id AND (status = 'running' OR status = :incomingStatus)`, so
  `running → anything` and `cancelled → cancelled` are allowed while
  `cancelled → done` is refused. The second half matters and is easy to delete by
  accident: `POST /runs/:id/cancel` writes ONLY `status`, so the executor's catch
  path still has to come back and fill in `duration_ms` and `error`. The method
  now returns a boolean — `false` means the write was refused, and the executor
  logs it rather than assuming it won. Regression tests:
  `test/run-settle.it.test.ts`. (2026-08-03)

- **The `findings` CHECK constraints and `vendor/shared/contracts/findings.ts`
  must be edited together.** Migration `0011` pins the exact enum members into
  the database, and they are NOT what you would guess: severity is UPPERCASE
  (`CRITICAL`/`WARNING`/`SUGGESTION`) while category and kind are lowercase
  (`bug`/`security`/`perf`/`style`/`test`, `finding`/`secret_leak`/
  `lethal_trifecta`/`phantom`/`hook`). Add a member to the Zod enum without
  adding it to the CHECK and inserts fail at runtime with
  `new row for relation "findings" violates check constraint`. Verify against
  live data before adding any further CHECK:
  `select severity, count(*) from findings group by 1`. (2026-08-03)

## Tool & Library Notes

- **`pnpm lint` enforces the onion rings, and six violations are deliberately
  exempted IN THE CODE, not in the config.** Each carries an
  `eslint-disable-next-line no-restricted-imports` with the reason directly
  above it: four `node:fs` imports in `repo-intel` (awaiting a `SourceReader`
  port) and two type-position `db/schema` imports in `reviews` (sanctioned by
  the skill's §15). `grep -rn "eslint-disable-next-line no-restricted-imports"
  src` is the live list of backend architectural debt — shorter than the skill's
  §15 table, because the rest were fixed. Do not add a seventh without the same
  written reason. (2026-08-03)

- The API imports `reviewer-core`'s raw TypeScript through a tsconfig path alias,
  so `reviewer-core/node_modules` must exist or boot dies with
  `ERR_MODULE_NOT_FOUND` — even though nothing in `server/package.json` references
  that package. `scripts/dev.sh` installs it separately, with **npm**, for exactly
  this reason. (2026-07-27)

- **`pnpm db:generate` rewrites `migrations/meta/_journal.json`** and adds a
  `migrations/meta/NNNN_snapshot.json` beside it, so "already-applied files in
  `src/db/migrations/` are do-not-touch" (`AGENTS.md`) holds for the `.sql`
  files only. Any automated check that treats the whole folder as immutable
  fires on every legitimate new migration instead: generating `0011` shows
  `meta/_journal.json` as MODIFIED and `meta/0011_snapshot.json` as ADDED in the
  same diff. Scope such a check to `*.sql`, and expect the snapshot to be large
  (3 560 lines for `0011`) — it is generated, not worth reviewing. (2026-08-03)

## Recurring Errors & Fixes

- `relation ... does not exist` on a fresh boot → migrations were never applied.
  The server does not migrate on boot by design. Run `pnpm db:migrate`. (2026-07-27)

- `expected [ { …(16) }, { …(16) } ] to have a length of 1 but got 2` in
  `reviews.it.test.ts` after touching `REVIEW_FIXTURE` → the fixture feeds
  **every** test in the file, not just the main run test. Adding one finding
  cascades into: `review.score` (grounded findings × `SEVERITY_PENALTY` =
  35/12/3 in `reviewer-core/src/review/reduce.ts`), the `'N/M passed'`
  grounding strings on both the trace and the run row, `findingsCount`, and the
  dual-provider test's own findings-length assert. Grep the file for every
  count/score assertion before extending the fixture. (2026-07-31)

- `Error: MockLLMProvider fixture failed schema: ...` → the canned fixture no
  longer satisfies the Zod schema the *caller* passed to `completeStructured`.
  `MockLLMProvider` (`src/adapters/mocks.ts`) runs `req.schema.safeParse(fixture)`
  and throws on failure by design, so a contract change breaks the fixture loudly
  instead of letting a stale shape flow into the test. Fix the fixture (or the
  `structuredBySchema` entry for that `schemaName`), not the mock. (2026-08-03)

## Session Notes

- **2026-08-03** — Architecture pass driven by the `onion-architecture` skill.
  Turned §14 into a lint lane (`server/eslint.config.js` + the `lint` workflow),
  which reproduced the skill's §15 violation table exactly — 19 errors — and then
  drove fixing 13 of them. Extracted `pulls/` into
  routes→service→repository→helpers (395 → 57-line `routes.ts`, 12 new
  Docker-free tests in `test/pulls-helpers.test.ts`), and gave `polling`,
  `settings` and `workspace` the same trio. Promoted the constants that caused
  the sibling/adapter-inward imports to ring 1 (`platform/job-kinds.ts`,
  `platform/source-scope.ts`, `db/constants.ts`). Added `DbTx` and the first
  three transactions in the codebase. Migration `0011` added the four missing
  indexes on `reviews`/`findings`/`agent_runs` — those tables had none at all
  beyond their PK, while the PR list reads all three on every request.
  `scripts/vendor-shared.sh` now re-vendors the contracts and CI fails on drift;
  it found the copies had ALREADY diverged on five files, including a `Provider`
  enum on the client missing `'openrouter'` — the provider the seeded default
  agent runs on.

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

- **2026-07-31** — L01 rework: severity counters. The list handler in
  `modules/pulls/routes.ts` gained a third read-time aggregation block (latest
  review's findings → `PrMeta.findings_by_severity` + `latest_findings`),
  mirroring the score/cost blocks; no migration — severity was already
  persisted per finding. The null-vs-zero rule extended to counters, with the
  it-test asserting the grounding-dropped WARNING lands as a real `0`.

## Open Questions

- The seeded General Reviewer agent uses `provider: openrouter`, so a review run
  needs `OPENROUTER_API_KEY` — but `.env.example` presents OpenAI/Anthropic
  first. Unclear whether the seed or the example file is the intended default.
