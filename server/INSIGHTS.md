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

- **An `*.it.test.ts` that omits ONE adapter override silently makes live, billed
  API calls — the only symptom is a `waitForPrRuns` timeout.** `appWith` in
  `reviews.it.test.ts` injected only the agent's own LLM provider. When L03 made
  the review path also resolve `openrouter` (the intent classifier) and, because
  that file's PR body reads `Closes #471`, `container.github()`, both fell
  through to `LocalSecretsProvider` → `process.env` → the REAL keys in
  `server/.env`, which vitest loads. Five tests went from 2.8 s to 10 s each
  (`expected 'running' to be 'failed'`, `expected [] to have a length of 1`) and
  real OpenRouter generations were billed. Nothing logged, nothing errored — an
  un-injected port is a live network call, not a failure. When a test triggers a
  code path that resolves a provider by NAME rather than from the fixture, inject
  every external port exhaustively, not minimally. (2026-08-06)

- **A safety bound keyed on "was anything at all missing?" is an off switch, and
  only a run against real data shows it.** The intent scope filter armed on three
  conditions, one of which was `missing_context.length === 0`. Every unit test
  passed and the rule read as prudent. Against three real PRs of this repo it
  armed **zero times** — and on two of them the sole gap was an unfetched
  external link, one being `https://claude.com/claude-code`, the footer every
  Claude Code-authored PR carries. So the feature could essentially never run in
  the repo it was built for. The fix is to distinguish a **material** gap
  (something the collector set out to read and could not: a `linked_issue` or
  `repo_file` marked `unavailable`) from a merely recorded one (a `link` we never
  intended to fetch). Same three PRs afterwards: the one naming a document it
  could not read stays disarmed, the two whose gaps were only URLs arm.
  Generalisable: when a gate's precondition is a count of "anything unusual",
  check what that count actually is on production data before trusting it —
  a fixture chooses its own inputs and will never contain a marketing footer.
  (2026-08-06)

- **A gate that reports only when it acts is indistinguishable from a gate that
  never ran.** The scope filter logged its drops and its disarmed reason, but
  said nothing when armed and clean — so `Scope filter: …` missing from a trace
  could mean "nothing was out of scope" or "the arming rule silently said no",
  and telling them apart meant reading the code. `groundFindings` had it right
  all along: it emits `Citation grounding: N/M passed` unconditionally. The gate
  now emits `Scope filter: N/M kept — every finding was in scope` whenever it is
  armed. Make a gate's *silence* mean exactly one thing. (2026-08-06)

- **A `Parameters<typeof fn>[N]` parameter type can make the onion lint lane
  blind, and it looks like tidy reuse.** `container.loadPrDiff` was typed
  `pull: Parameters<typeof loadDiff>[3], repoRow: Parameters<typeof loadDiff>[4]`,
  which resolve to `PullRow` and `typeof repos.$inferSelect`. Every ring-2 caller
  reaching it through the container therefore depended on an ORM row shape
  **without importing `db/schema`** — so the `RING_2_FORBIDDEN` rule in
  `eslint.config.js` could not fire, by construction, and §5's "row types never
  cross inward" stopped being enforced on that path while still appearing to be.
  The fix is to name the shape structurally at the boundary: `loadDiff` now takes
  `DiffPullRef` (`Pick<PullRow,'id'|'base'|'headSha'>`) and `RepoRef`, which is
  all it ever read. That also retired `diff-loader.ts`'s
  `eslint-disable no-restricted-imports` — the exemption whose own comment asked
  the next person changing the signature to prefer a contract type — so the
  `reviews` module is down from two type-position `db/schema` imports to one
  (`run-executor.ts`). When you re-export a function through the composition
  root, write its parameter types out; inheriting them re-exports the import ban
  too, silently. (2026-08-06)

- **Supersedes the fix in the entry above: enumerating providers is not the
  remedy, `secrets: new MockSecretsProvider({})` is.** The first fix injected
  `llm.openrouter` and `github` and declared the list "exhaustive". It was not.
  `appWith` still injected `llm[provider]` — one of `openai`/`anthropic` — so the
  `{ all: true }` test, which picks up the `provider: 'anthropic'` agent an
  earlier test leaves in the same workspace, still reached
  `container.llm('anthropic')` → `new AnthropicProvider(key)`. It only looked
  fixed because this machine has no `ANTHROPIC_API_KEY`, so it threw
  `ConfigError` and the suite stayed green and cheap — **the bug is invisible
  exactly where it is harmless and bills only on a machine that happens to have
  the key**. Any list of ports is a list someone will fail to extend. Inject an
  EMPTY `MockSecretsProvider` instead: `buildLlm` reads its key through
  `SecretsProvider`, so with nothing to find it raises `ConfigError` before
  constructing a client, and a forgotten port becomes a loud deterministic
  failure on every machine. `MockSecretsProvider` had existed in
  `adapters/mocks.ts` since L01 with zero callers. Verified: with
  `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` set to bogus values in the environment,
  `reviews.it.test.ts` still passes in 2.8 s. (2026-08-06)

- **`pnpm db:generate` is interactive whenever a column is dropped and another
  added on the same table, and it cannot be answered from a pipe.** Renaming
  `pr_intent.intent` → `summary` alongside ten new columns made drizzle-kit ask
  "created or renamed from another column?" for each one. `printf '\033[B\n' |`
  hangs (no TTY) and `script -q /dev/null` hangs too (the keystrokes arrive
  before the prompt, then stdin closes). What works is `expect(1)`, which is on
  macOS by default: spawn `pnpm exec drizzle-kit generate`, match on
  `rename column` → send `\033[B` then `\r`, match on `create column` → send
  `\r`, `exp_continue`. Answering "create" instead of "rename" would have been
  silently wrong rather than an error. (2026-08-06)

- On **pnpm 11**, every `pnpm <script>` in this package fails before running
  anything, with `ERR_PNPM_IGNORED_BUILDS`. pnpm 11 flipped `strictDepBuilds` to
  true, so the automatic pre-run dependency check refuses to pass while any
  dependency's build script is undecided. The fix is `pnpm-workspace.yaml` with
  an `allowBuilds:` map (`cpu-features`, `esbuild`, `protobufjs`, `ssh2` — all
  `false`; none of them need to build, each ships a prebuilt binary via
  optionalDependencies). What does NOT work, and wastes time: a `pnpm` field in
  `package.json`, `strict-dep-builds` in `.npmrc`, and the `npm_config_*` env
  vars — pnpm 11 reads this setting only from `pnpm-workspace.yaml`. (2026-07-27)

- **`buildApp` writes to whatever database `DATABASE_URL` points at, before a
  single route runs — so the test suite fails live review runs in the dev DB.**
  `app.ts:81` awaits `ReviewService.reapStaleRuns()` on every construction, and
  `reapStaleRunningRuns` (`repository/run.repo.ts:105`) is an unscoped
  `UPDATE agent_runs SET status='failed' WHERE status='running'` — no workspace
  filter, no age filter, no error text, no duration. `test/routes-smoke.test.ts`
  calls `buildApp({config})` with `loadConfig({...process.env})` and its own
  docstring claims these tests "don't touch the database (postgres-js connects
  lazily)"; the reaper makes that false. Observed 2026-08-06: a real in-flight
  run (`b78152e4`) was marked `failed` by `pnpm exec vitest run --exclude
  '**/*.it.test.ts'` in another terminal; the provider answered ~3 min later and
  the server logged *"Run had already been cancelled or reaped — keeping that
  status"*, so the run was **billed**, produced 3 findings, persisted its trace,
  and still reads `failed`. Reproduced deterministically: insert one `running`
  row, run `vitest run test/routes-smoke.test.ts`, watch it flip. Do not run the
  suite against a stack with live runs until this is bounded. (2026-08-06)

- **The OpenRouter schema-repair round is real, and it is not cheap.** The intent
  classifier sets no `provider: { require_parameters: true }`, so a `strict` miss
  triggers a silent second request (`openrouter.ts:104-115`). First observed
  2026-08-06 on `dev-digest#4`: `Intent derived (confidence=high, **2 attempts**)
  — 2 630 in / **8 378 out** · **$0.002714**`, against the ~$0.0003 and ~300
  output tokens `docs/plans/L03-intent-layer.md` budgeted — an order of magnitude,
  from one retry. The same call on the same PR minutes earlier took 1 attempt and
  cost $0.000441. So `attempts` in the log is the only thing distinguishing "the
  cheap pass got expensive" from "the price estimate was wrong", and a cost
  regression here will look like model drift if you do not read it. (2026-08-06)

- **Extends the 2026-08-06 `Parameters<typeof fn>[N]` entry above: a
  repository's inferred RETURN type leaks row shapes the same way, and the same
  rule stays blind.** `reviewRepo.getPrFiles` is
  `Promise<(typeof t.prFiles.$inferSelect)[]>` and `reviewsForPull` returns rows
  built from `$inferSelect`, so `modules/smart-diff/service.ts` field-read both
  and depended on two table shapes with **no `db/schema` import** —
  `RING_2_FORBIDDEN` in `eslint.config.js` cannot fire on that either. The
  parameter-position fix was already written down; the return position was not,
  and this was the second instance. Remedy is the same shape as
  `diff-loader.ts`'s: declare locally the fields the service actually reads
  (`PrFileRef`, `FindingRef`) and type the calls through them. A tell that you
  have one of these: a `as Severity`-style cast in a service, which exists only
  because a `text` column arrived as `string`. (2026-08-08)

- **`eslint.config.js` enumerates the ring globs by literal FILENAME, so a new
  module file named anything else is covered by no rule at all.** The lists name
  `service.ts`, `routes.ts`, `repository.ts`, `repository/**`, `helpers.ts`,
  `constants.ts`, `run-executor.ts`, `diff-loader.ts`, `pipeline/**`.
  `modules/smart-diff/classify.ts` — the file holding that whole feature's
  decision logic — matched none, so it could have taken `db/schema` or a sibling
  import with no error, while the module as a whole looked lint-clean. Adding a
  file whose name is not on that list means editing the glob list in the same
  change. Verify it actually bites rather than assuming: plant
  `import * as t from '../../db/schema.js'` in the new file, run `pnpm lint`,
  expect an error naming `no-restricted-imports`, then revert. (2026-08-08)

- **`POST /pulls/:id/review` has never been synchronous, and its own contract
  docstring said it was — for three lessons, through every gate.**
  `vendor/shared/contracts/review-api.ts` claimed the persisted reviews "are
  also returned once the (synchronous) run completes". `modules/reviews/service.ts`
  fires `void this.executor.executeRuns(...).catch(...)` and returns
  immediately, so `reviews` on that response is **always `[]`**. Nothing catches
  a wrong comment: typecheck, lint and every test pass identically whether the
  prose is true or false, and the web client never noticed because it refetches
  on SSE. It cost a whole L04 design premise — a blocking MCP tool built on that
  sentence would have reported zero findings on every PR — and was corrected on
  2026-08-12. When a contract comment describes RUNTIME behaviour rather than
  shape, read the handler before building on it; the field stays because a
  caller finding `[]` needs to know that is by design. (2026-08-12)

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

- **Extends the 2026-07-31 "reverse it in two places" entry: the third place is a
  TEST, and it is the one that fights back.** Reversing "a disabled skill is
  absent from the log and the trace" meant editing four things, not two — the
  code, the comment above the call site, `docs/plans/L02-skills.md`'s exit
  checklist, and `reviews.it.test.ts`, which pinned the old behaviour as
  `expect(off.log.some(l => l.msg.includes('Loaded'))).toBe(false)`. A green
  suite after a reversal means you have not found the assertion yet. Before
  reversing a documented negative decision, grep the tests for the behaviour you
  are about to add, not just the comments describing what you are removing — and
  keep the halves apart in the new wording, because only the log changed here
  while the trace contract (`config.skills` omitted, never `[]`) deliberately did
  not. (2026-08-03)

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

- **A shared helper that a SECOND module needs goes onto the container, not into
  a sibling import — and `modules/reviews/diff-loader.ts` is now the worked
  example.** The intent classifier needs a PR's diff (paths + hunk headers), and
  `loadDiff` lives in `modules/reviews/`, which is a sibling. Importing it would
  have tripped the onion lint lane, and moving the file would have re-pointed the
  review path for no gain. `container.loadPrDiff(workspaceId, pull, repoRow)`
  delegates to it from the composition root, which already imports from
  `modules/` by sanctioned exemption. Same route as `container.skills`. The
  parameter types are taken with `Parameters<typeof loadDiff>[3]` rather than
  re-imported, so the container does not grow its own `db/schema` import.
  (2026-08-06)

- **A repo-path regex that matches nothing is safe and USELESS — make the
  denylist do the rejecting so it can be reported.** The intent module's first
  `REPO_PATH_PATTERN` required a slash and an extension, so a PR body saying
  "see .env for context" matched nothing: the file was never read (correct) but
  also never recorded, so the card could not say the read had been refused. The
  pattern now has a second alternative for dot-segment paths purely so
  `classifyCandidatePath` can return `denied` and put a line in
  `missing_context`. Silence and refusal look identical to a user; only one of
  them is a feature. (2026-08-06)

- **`run_traces.trace` is the ONLY record of what a run loaded, and it is a
  schema-less historical document — query it defensively.** Three rules, learned
  building `GET /skills/:id/stats` (`modules/skills/repository.ts` →
  `traceStats`). (1) Match a skill by NAME: `trace.config.skills[]` stores
  `{name, version, tokens}` and no id, so there is nothing else to join on.
  Names are unique per workspace so it cannot collide, but RENAMING a skill
  orphans every run made under the old name — the count legitimately drops.
  (2) Wrap the array in `CASE WHEN jsonb_typeof(...) = 'array' THEN ... ELSE
  '[]'::jsonb END` before `jsonb_array_elements`. Traces written before L02 have
  no `skills` key, and one written as JSON `null` raises `cannot extract
  elements from a scalar` — a single such row fails the whole endpoint, not just
  its own line. (3) Scope on `agent_runs.workspace_id`; `run_traces` has no
  workspace column, only the run FK. (2026-08-05)

- **One row in `reviews` is one AGENT, not one review pass — so "the latest
  review" is whichever agent finished last, and it is usually not the one with
  the findings.** A single Run Review writes a `kind: 'review'` row per agent.
  On `teplyakoff/dev-digest#5` the newest row was API Contract Reviewer with **0
  findings**, while Test Quality Reviewer (10) and General Reviewer (3) sat
  behind it — so `reviews.find(r => r.review.kind === 'review')` reported zero
  for a PR that really had 13. `modules/smart-diff/service.ts` now unions every
  `kind: 'review'` row instead; the cost, taken knowingly, is that a re-run
  agent's superseded findings stay visible until its older review is deleted.
  Note the seed makes this worse: its findings hang off a review row with **no
  `run_id`**, so they are unreachable from the Agent-runs tab entirely. Check
  with `select r.kind, a.name, count(f.id) from reviews r left join findings f
  on f.review_id=r.id left join agents a on a.id=r.agent_id where r.pr_id=…
  group by r.id, a.name`. (2026-08-08)

- **`getPrFiles` issues no `ORDER BY`, so there is no such thing as a PR's file
  order.** `modules/reviews/repository/pull.repo.ts` is
  `db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId))` — rows come back
  in whatever order Postgres has them, which is insertion order in practice.
  Anything user-facing that says "original order" is therefore describing an
  implementation detail, not PR order and not alphabetical order; a plan that
  claims otherwise is wrong, and one did. If an ordering actually matters, sort
  explicitly at the point of use rather than trusting the read. (2026-08-08)

## Tool & Library Notes

- **`db.execute()` returns the ROWS, not a `{ rows }` wrapper — this codebase is
  on postgres-js, not node-postgres.** `db/client.ts` builds the client with
  `drizzle-orm/postgres-js`, whose `execute` resolves to a `RowList` that IS an
  array, so it is `result[0]`, never `result.rows[0]`. Most drizzle examples
  online show the node-postgres shape; writing `.rows` type-checks (the return
  is loosely typed), compiles, and then reads `undefined` at runtime with no
  error. Also: `count()` and `sum()` come back as **strings** (bigint), so wrap
  every aggregate in `Number(...)`, and an aggregate over zero rows still
  returns one row with nulls — no length check needed, just defaults.
  (2026-08-05)

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

- `Error: No host port found for host IP` from testcontainers' `startContainer`
  during `pnpm test` → a flake in parallel container startup, not your change.
  Observed on `test/intent.it.test.ts` roughly once in six full runs; it passes
  in isolation and on the next full run. Re-run once before investigating, and
  say so rather than retrying until green — a suite that fails one run in six is
  worth naming, not hiding. (2026-08-08)

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

- `OpenRouter returned no choices for Review: Input too long: N input tokens,
  limit is 1048576 for this model`, on every agent of a run → the PR's diff is
  past the model's context window, and **the size you can see in the database is
  not the size that gets sent.** `loadDiff` calls `container.git.diff(...)`
  against the CLONE, whereas `pr_files.patch` is GitHub's copy — and GitHub
  truncates the patch of a large file while `git` does not. `dev-digest#3` stores
  477 KB of patch, next to #5's 463 KB, and produces a **3.6 MB** diff ≈ 937k
  tokens; #5's fits and reviews at 142k. So an estimate built from
  `sum(length(pr_files.patch))` is wrong by an order of magnitude, and the
  failure lands on all N agents at once, minutes apart, with no partial result.
  Measure `git -C server/clones/<repo> diff --no-color <base>...<head> | wc -c`
  instead. Nothing is billed — the request is rejected before processing, so
  `tokens_in`, `tokens_out` and `cost_usd` come back zero or null — but a lock-file
  in the diff is enough to push a PR over on its own. (2026-08-08)

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

- **2026-08-06** — L03 Intent Layer. Built `modules/intent/` on the Conventions
  Extractor's shape (collect → one cheap model call → compute in code → persist)
  and hung it off `container.intent`; migration `0015` renamed
  `pr_intent.intent` → `summary` and added ten provenance columns while the table
  was still empty. The structural call worth remembering: the classifier's Zod
  schema has NO `sources` or `missing_context` field, so a hallucinated source is
  unrepresentable rather than merely unlikely — the same trick the extractor
  plays with evidence snippets. Two things bit: `pnpm db:generate` needed
  `expect(1)` to answer its rename prompts, and `reviews.it.test.ts` started
  making real billed OpenRouter and GitHub calls because `appWith` injected only
  the agent's own provider. `contracts.test.ts` also had to move to
  `Intent.summary` — a renamed contract field breaks the test that pins it, and
  that test is not in any plan's file list.

- **2026-08-05** — L02 mentor-feedback pass. Added `Agent.skills_count`
  (denormalized on `GET /agents` by `AgentsRepository.skillCounts`, the mirror of
  `SkillsRepository.usageCounts`) and `GET /skills/:id/stats`, which reads the
  run traces back rather than adding a counter table — the data was already
  persisted, nothing needed migrating. Seeded `secret-handling` and
  `tenant-scoping` for the Security Reviewer, which had shipped since L01 with an
  empty knowledge layer. Deliberately did NOT implement the design's
  pull-frequency and accept-rate tiles: no table links a finding to the skill
  that provoked it, so both numbers would have been invented.

- **2026-08-08** — L03 homework, Smart Diff server lane. New
  `modules/smart-diff/` (`constants` → `classify` → `service` → `routes`)
  computing role grouping and risk order from path patterns and persisted
  findings, with no model call: the service holds no reachable LLM adapter, a
  stub `llm()` that throws is asserted never called, and the it-test pins that
  `agent_runs` is unchanged across the request. Two things only running it
  revealed — that one `reviews` row is one agent (the endpoint reported 0
  findings on a PR with 13), and that `getPrFiles` has no `ORDER BY`; both are
  entries above. A review pass also found that `classify.ts` sat outside every
  lint ring glob, which was fixed by extending the glob list and proved by
  planting a forbidden import and watching `pnpm lint` fail.

## Open Questions

- The Security, General and Performance Reviewers were all seeded with no skills;
  only the Security Reviewer was fixed (2026-08-05), because that is what the
  review asked for. Whether the other two should get a knowledge layer, or
  whether one deliberately bare agent is useful as the control condition, is
  undecided.

- The seeded General Reviewer agent uses `provider: openrouter`, so a review run
  needs `OPENROUTER_API_KEY` — but `.env.example` presents OpenAI/Anthropic
  first. Unclear whether the seed or the example file is the intended default.
