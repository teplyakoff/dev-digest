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

## Open Questions

_(no entries yet)_
