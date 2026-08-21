# mcp — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

- **Measure the tool-list token cost by spawning the real server and
  serialising `tools/list`, not by eyeballing the schemas.** ~30 lines of Node:
  spawn `./bin/devdigest-mcp`, send `initialize`, then `notifications/initialized`,
  then `tools/list`, and take `JSON.stringify(result.tools).length / 4`. Per-tool
  numbers fall out of the same payload. The estimate that preceded the first
  real measurement was 12% low, and `get_conventions` alone was out by 49% —
  a `z.enum([...]) | 'all'` union serialises far larger than it reads.
  (2026-08-13)

## What Doesn't Work

- **`POST /pulls/:id/review` does not block, whatever its docstring said.**
  `server/src/modules/reviews/service.ts` fires `executor.executeRuns(...)` with
  `void ... .catch(...)` and returns `{ runs, reviews: [] }` immediately, so
  `reviews` is **always** `[]` on that response. The contract's own comment
  claimed the reviews come back "once the (synchronous) run completes" — it was
  wrong from before this package existed, and building a blocking tool on it
  would have produced a tool that always reports zero findings. Blocking is the
  adapter's job: poll `GET /pulls/:id/runs`, filtered to the run ids the POST
  returned. (2026-08-11)

- **`GET /pulls/:id/runs` returns every run the PR ever had, not the new ones.**
  A poller that waits for "any run is `done`" finishes instantly on a PR with
  history, reports the previous run's findings, and looks correct. Filter on the
  `run_id` set that `POST /pulls/:id/review` handed back. Terminal statuses are
  `done | failed | cancelled`. (2026-08-11)

- **A terminal run is not a successful run, and conflating them reports a
  clean bill of health for a pull request nothing reviewed.** The poll's `done`
  predicate is `done | failed | cancelled` — all three END the wait. Mapping
  "the poll settled" onto `status: 'completed'` therefore turned a run that hit
  the API's own 10-minute executor deadline into
  `{"status":"completed","findings_total":0}`, which a model reads as "no
  problems found". Ask the RUNS what happened, never the poll: every run `done`
  → completed, some → partial, none → failed with `isError`. Found by running
  the tool against a real PR (`teplyakoff/quiz-generator#31`, run 63f42ba1,
  600 015 ms, `Run exceeded the 10-minute deadline and was aborted`) — every
  fixture here scripted `… → done`, so no hermetic test could reach it, and
  neither could a review pass. When a poller has more than one terminal state,
  write the fixture for the unhappy ones first. (2026-08-12)

- **There are TWO cancellation windows in the poller, and checking
  `signal.aborted` between ticks covers only one.** An abort that lands while
  `listRuns` is in flight does not resolve the promise — it REJECTS it, with
  whatever `fetch` threw. `api/client.ts` re-throws that rejection unchanged on
  purpose (so the poller can tell "the caller left" from "the API is down"), so
  without a `try` around `opts.fetch` the raw error escapes `pollUntil` and a
  cancelled 15-minute call surfaces as `Unexpected failure: This operation was
  aborted` with **no run ids in it** — strictly worse than the abort that lands
  during the backoff sleep, which returns them. Both windows must end in the
  same `{ status: 'aborted' }`. `FakeApiClient` ignores `signal` entirely, so
  this cannot be exercised through the fake: pin it at `pollUntil` with a
  `fetch` that rejects, and keep a sibling test proving a genuine failure still
  propagates. (2026-08-12)

- **`get_findings`' header names every agent that REVIEWED the pull request, not
  the agents whose findings it is returning** — so it credits agents that found
  nothing. `collect-findings.ts:59-63` pushes `row.agent_name` for every
  `kind: 'review'` row before reading `row.findings`, and a row with an empty
  `findings` array still lands in `agents`. On `teplyakoff/dev-digest#4` the
  output reads *"11 finding(s) … from 3 agent(s): Security Reviewer, General
  Reviewer, API Contract Reviewer"* while the Security Reviewer has **0**
  findings across all four of its runs there; the real split is 8 General + 3 API
  Contract. This actively misleads the caller's model, which is the audience the
  header exists for: it was read as evidence that the security agent had flagged
  the contract break, and it had not. Build `agents` from the rows that
  contributed at least one finding — or from `matched`, so the header describes
  what was actually returned rather than what was scanned. Note the union in the
  comment above it is right and must stay; only the attribution is wrong.
  (2026-08-12)

- **The Inspector command that gets passed around — `npx @modelcontextprotocol/inspector
  tsx src/index.ts` — does not work in this package.** There is no
  `mcp/src/index.ts`; the entrypoint is `src/main.ts`, and the thing to launch is
  `./bin/devdigest-mcp`, which exists specifically so the server does not depend
  on the client's working directory (the tsconfig `paths` to
  `@devdigest/shared` only resolve with `mcp/` as the base). Use
  `npx @modelcontextprotocol/inspector ./bin/devdigest-mcp`, or
  `npm run record:mcp`, which spawns and kills its own Inspector. (2026-08-13)

- **A tool that answers "nothing found" when the server said "nothing is known"
  is worse than one that errors, because its reader is a model.** `GET
  /pulls/:id/blast` returns `200 status:"degraded"` for an unindexed repository —
  a well-formed body with empty arrays. Passing that straight through would let
  a caller conclude nothing calls the changed code, which is a claim about the
  repository that an absent index cannot support. `get_blast_radius` maps
  `degraded` to `isError: true` carrying the server's own reason, and `partial`
  to a normal answer with the caveat inline. This is the one rule that survived
  from the file's stub era; `mcp/AGENTS.md` records it under _Do not touch_.
  (2026-08-13)

- **`.mcp.json` silently accepts keys that do nothing, so "the client still
  starts" proves nothing about a config key.** Probed it directly: three configs
  in temp dirs — one plain, one with `"timeout"`, one with `"zzz_nonsense": true`
  — and `claude mcp list` listed the server identically for all three
  (`probe: /bin/echo hi - ⏸ Pending approval`). No warning, no validation error.
  A misspelled or invented key is therefore indistinguishable from a working one
  at runtime. Confirm a key against the docs before relying on it; `timeout` is
  real (`https://code.claude.com/docs/en/mcp`), but nothing in the client would
  have told us. (2026-08-15)

## Codebase Patterns

- **One row in `reviews` is one AGENT, not one review pass** — carried over from
  `server/INSIGHTS.md:343-356`, because `get_findings` is the second place in
  this repo to get it wrong. `reviews.find(r => r.kind === 'review')` reported
  **0 findings on a PR that had 13**. Union every `kind: 'review'` row.
  (2026-08-11)

- **The caller's model is a second, unprotected audience.** `INJECTION_GUARD`
  hardens the *review* model's prompt. Text that leaves this package — finding
  titles and rationales, PR titles, convention evidence snippets — flows into
  the model that called the tool, which the guard never sees. Everything
  external is wrapped in `wrapUntrusted` on the way out. (2026-08-11)

- **`reviews` rows vary on TWO axes, and "union every `kind: 'review'` row"
  only settles one of them** — refines the 2026-08-11 entry above, which stays
  correct as far as it goes. Rows are plain INSERTs
  (`server/src/modules/reviews/repository/review.repo.ts:25` never upserts), so a
  re-run APPENDS a row. Across agents, union — that is the 0-findings-on-a-13-
  finding-PR bug. Within one agent, take the newest by `created_at`: an older row
  is a verdict the agent has already replaced, and returning both double-counts
  findings it has re-decided. `get_findings`' `all_runs: true` opts back into the
  history. Key the dedupe `agent_id ?? name ?? row id` — a deleted agent leaves
  BOTH id and name null, and keying those together collapses every orphaned
  review in a PR's history into one. (2026-08-15)

- **A default that drops rows must say how many it dropped.** `collectFindings`
  returns `hiddenRuns` and every `get_findings` branch renders it, because a
  total that quietly shrank is indistinguishable from an agent that found less —
  and this is the tool a model reaches for to decide whether a PR is clean. The
  same reasoning gave "reviewed and recorded no findings" its own message,
  separate from "nothing has reviewed this pull request yet". (2026-08-15)

## Tool & Library Notes

- **Vitest does not read tsconfig `paths`.** Both alias sets must be written
  twice, in `tsconfig.json` and in `vitest.config.ts`. The failure mode is
  asymmetric and confusing: `npm run typecheck` is green while every test dies
  at import. (2026-08-11)

- **`registerTool`'s handler takes a second argument, and everything long-running
  depends on it.** `RequestHandlerExtra` carries `signal` (client-side
  cancellation), `sendNotification` and `_meta.progressToken`. A 15-minute
  blocking call is only viable because progress notifications reset the timeout
  of clients that set `resetTimeoutOnProgress`, and only interruptible because of
  `signal`. Register with `(input, extra) => handler(input, deps, extra)`, never
  `(input) => handler(input, deps)`. (2026-08-11)

- **A `"zod/*"` path alias makes every `registerTool` call fail with
  `TS2589: Type instantiation is excessively deep and possibly infinite`.**
  Copied from `reviewer-core/tsconfig.json`, where it is harmless. It is not
  harmless here: `@modelcontextprotocol/sdk` supports zod 3 and zod 4 side by
  side and its own `.d.ts` files import `zod/v3` and `zod/v4/core`. The
  wildcard remaps those through `./node_modules/zod/*` and the resulting types
  explode — and the error points at this package's tool schemas, which are
  fine. Keep the plain `"zod"` self-pin (that is the part that prevents two zod
  instances and a false `instanceof z.ZodError`); drop only the wildcard.
  Nothing here imports a zod sub-path, so it buys nothing. Isolated by
  bisecting the `paths` block, and the reasoning is inlined in
  `tsconfig.json:31-40` so it is not re-added. (2026-08-12)

- **An `outputSchema` enum that lists a status the tool never emits is a lie
  the type system cannot catch, and the SDK will not stop you.**
  `RunAgentOutput.status` advertised `failed | timeout | cancelled` while every
  one of those paths returned text only, so a caller switching on
  `structuredContent.status` fell through to `undefined` on exactly the
  outcomes worth branching on. The reason the payload had been left off was
  caution about emitting it beside `isError`; the SDK settles it —
  `@modelcontextprotocol/sdk/dist/esm/server/mcp.js:193`, `validateToolOutput`
  returns early on `result.isError`, so a structured payload there is
  **forwarded unvalidated rather than rejected**. Emit it on every path. When
  adding a member to an output enum, grep for the code that produces it before
  believing the schema. (2026-08-12)

- **Progress notifications do NOT extend a per-server `timeout` in Claude Code —
  supersedes the 2026-08-11 entry above**, which said a 15-minute blocking call
  "is only viable because progress notifications reset the timeout". That holds
  for an SDK client's `resetTimeoutOnProgress` deadline and for the client's idle
  accounting; it does not hold for the `timeout` key in `.mcp.json`, which the
  docs call a hard wall-clock limit per tool call that progress does not extend
  (`https://code.claude.com/docs/en/mcp`). Three separate numbers, routinely
  confused: `MCP_TIMEOUT` = server STARTUP; `MCP_TOOL_TIMEOUT` = the global
  wall clock; per-server `timeout` = the same wall clock for one server, and it
  wins. Values below 1000 are ignored. `.mcp.json` now sets `960000` against
  `MAX_WAIT_SECONDS = 900` so this server's own deadline fires first and returns
  the `run_id`s — a client abort returns none, and the runs are billed either
  way. (2026-08-15)

## Recurring Errors & Fixes

_(no entries yet)_

## Session Notes

- **2026-08-13** — L04, `get_blast_radius` stopped being a stub. The route it
  had been waiting for (`server/src/modules/blast/`) landed in the same lesson,
  in the order the stub's own docstring prescribed: server route first, then the
  body. Input moved from `repo` + `path` to `pull_request`, matching the route's
  key. Cost: 221 → 275 tokens, and the five tools 1 871 → 1 936 against a hard
  2 000 — 64 tokens of headroom, which will not absorb another filter on another
  tool. The port change was four files as §4 requires (`api/types.ts`,
  `api/client.ts`, `api/fake-client.ts`, and the fake's `FakeApiData` default),
  and the fake answers the real degraded body rather than throwing, so the
  handler's most common real-world state is actually exercised.

- **2026-08-15** — L05 opened on three mentor findings against L04, all three in
  this package. (1) `.mcp.json` had no `timeout`; (2) `list_agents` projected
  `a.provider`; (3) `get_findings` had no `all_runs`. Two things were worth more
  than the fixes. First, the baseline measurement reproduced exactly — the
  `tools/list` recipe in _What Works_ gave 1 936 / 7 745 chars before the change
  and 1 967 / 7 868 after, so the 33-token cost of `all_runs` is measured, not
  estimated, and headroom against the hard 2 000 halved from 64 to 33. Second,
  the `all_runs` default forced the per-agent-vs-per-run distinction into the
  open, and the existing fixture had been hiding it: all three review rows in
  `test/tools.test.ts` carried the SAME `agent_id: 'agent-1'` with different
  names, so a correct `agent_id` dedupe collapsed them to one and reproduced the
  historic 0-findings bug. The fixture was wrong, not the dedupe. Still open and
  untouched here: the _What Doesn't Work_ entry from 2026-08-12 about the header
  crediting agents that found nothing — `all_runs: false` narrows it (fewer rows
  reach `agents`) but does not fix it.

## Open Questions

_(no entries yet)_
