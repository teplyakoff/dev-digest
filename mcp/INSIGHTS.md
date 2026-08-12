# mcp — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

_(no entries yet)_

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

_(no entries yet)_

## Open Questions

_(no entries yet)_
