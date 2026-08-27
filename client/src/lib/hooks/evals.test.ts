/* evals.test.ts — the cache behaviour of the L06 eval hooks (SPEC-08).
 *
 * WHY THIS FILE EXISTS, AND WHY NO COMPONENT TEST CAN REPLACE IT. Every one of
 * this feature's component tests stubs `@/lib/hooks/evals`, so none of them can
 * see a single thing this module actually does. Two of those things fail
 * loudly only in production:
 *
 *   - A POLL THAT DOES NOT STOP. `useEvalDashboard` and `useEvalBatches` compute
 *     `refetchInterval` FROM THEIR OWN LAST RESPONSE — the poll's condition is
 *     read off the data the poll itself replaces. Get the terminal case wrong
 *     and the tab hits the API every four seconds for as long as it stays open,
 *     with no error, no log and nothing on screen to show for it. The first
 *     place that surfaces is a screencast of the feature.
 *   - AN INVALIDATION THAT MISSES, OR ONE THAT IS TOO WIDE. A missed one is a
 *     stale number that looks right until reload; too wide a one refetches 50
 *     batch rows on every save in the case editor.
 *
 * HOW THESE ASSERT. Almost nothing here reads a query key or spies on
 * `invalidateQueries`. The reads are mounted as REAL queries over a mocked
 * `fetch`, and the claim "this list was invalidated" is checked as "this URL
 * was requested again" — output, not calls (`onion-architecture` §12, and the
 * same reason `frontend-architecture` §10 keeps the keys module-private: a test
 * that retyped them would be the coupling the rule forbids).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CreateEvalCaseFromFinding,
  EvalBatchRecord,
  EvalCaseRecord,
  EvalCaseUpsertBody,
  EvalDashboard,
} from "@devdigest/shared";
import { usePrReviews } from "./reviews";
import {
  useCreateEvalCase,
  useCreateEvalCaseFromFinding,
  useDeleteEvalCase,
  useEvalBatch,
  useEvalBatches,
  useEvalCases,
  useEvalDashboard,
  useRunEvalBatch,
  useUpdateEvalCase,
} from "./evals";

/**
 * The module's own poll cadence, which is a private constant by design.
 *
 * It is mirrored rather than exported, and the tests below straddle it — nothing
 * at `POLL_MS - 1`, one refetch at `POLL_MS` — so the NUMBER is pinned too. A
 * cadence quietly dropped to 500 ms would be four times the API load for the
 * same screen and would still pass a test that only advanced "enough".
 */
const POLL_MS = 4000;

const AGENT = "agent-1";

// ---------------------------------------------------------------------------
// A mocked API that answers by path, and counts what was asked of it.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();

/** Bodies keyed by the path suffix that selects them; later entries win. */
let routes: [string, () => unknown][] = [];

function route(suffix: string, body: () => unknown) {
  routes = [...routes, [suffix, body]];
}

/** How many times a path suffix was requested — the invalidation observable. */
function callsTo(suffix: string): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;
}

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function batch(o: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    id: "b1",
    agent_id: AGENT,
    agent_version: 3,
    system_prompt_snapshot: "You are a reviewer.",
    provider: "openrouter",
    model: "deepseek/deepseek-v4",
    status: "complete",
    cases_total: 8,
    cases_completed: 8,
    recall: 0.75,
    precision: 0.5,
    citation_accuracy: 1,
    cost_usd: 0.0013,
    partial: false,
    started_at: "2026-08-20T10:00:00.000Z",
    finished_at: "2026-08-20T10:04:00.000Z",
    ...o,
  };
}

function dash(o: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: AGENT,
    cases_total: 8,
    current: {
      recall: 0.75,
      precision: 0.5,
      citation_accuracy: 1,
      traces_passed: 6,
      traces_total: 8,
      cost_usd: 0.0013,
      partial: false,
    },
    latest_batch: batch(),
    delta: null,
    trend: [],
    recent_runs: [],
    alert: null,
    ...o,
  };
}

function evalCase(o: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: AGENT,
    name: "hardcoded-secret",
    input_diff: "@@ -1 +1 @@",
    input_files: null,
    input_meta: null,
    expected_output: [],
    notes: null,
    expectation: "must_find",
    source_finding_id: "f1",
    ...o,
  };
}

const UPSERT: EvalCaseUpsertBody = {
  owner_kind: "agent",
  owner_id: AGENT,
  name: "hardcoded-secret",
  input_diff: "@@ -1 +1 @@",
  input_files: null,
  input_meta: null,
  expected_output: [],
  expectation: "must_find",
};

beforeEach(() => {
  routes = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    const path = String(url);
    const hit = [...routes].reverse().find(([suffix]) => path.endsWith(suffix));
    const body = hit ? hit[1]() : {};
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
});

/* ==========================================================================
   1. THE POLL STOPS.
   ========================================================================== */

/** Let queued microtasks and any timers due at `ms` run inside React's act(). */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useEvalDashboard — polls only while a batch is in flight", () => {
  it("schedules a refetch at exactly the poll cadence while `running`, then stops", async () => {
    vi.useFakeTimers();
    // The self-referential part: the FIRST response says a batch is running, so
    // a poll is armed; the second says it finished, so the same callback must
    // now answer `false` and the interval has to clear itself.
    let status: EvalBatchRecord["status"] = "running";
    route("/eval-dashboard", () => dash({ latest_batch: batch({ status }) }));

    renderHook(() => useEvalDashboard(AGENT), { wrapper });
    await advance(0);
    expect(callsTo("/eval-dashboard")).toBe(1);

    // Nothing early — this straddle is what pins the cadence itself.
    await advance(POLL_MS - 1);
    expect(callsTo("/eval-dashboard")).toBe(1);

    status = "complete";
    await advance(1);
    expect(callsTo("/eval-dashboard")).toBe(2);

    // THE ASSERTION THIS FILE WAS WRITTEN FOR. The second response is terminal,
    // so no third request may ever be made. A poll that keeps its interval here
    // hits the API every four seconds for the life of the tab.
    await advance(POLL_MS * 5);
    expect(callsTo("/eval-dashboard")).toBe(2);
  });

  it("never arms a poll when the first response is already terminal", async () => {
    vi.useFakeTimers();
    route("/eval-dashboard", () => dash({ latest_batch: batch({ status: "complete" }) }));

    renderHook(() => useEvalDashboard(AGENT), { wrapper });
    await advance(0);
    await advance(POLL_MS * 5);

    expect(callsTo("/eval-dashboard")).toBe(1);
  });

  it("reads the LIFECYCLE channel, not the numbers channel", async () => {
    vi.useFakeTimers();
    // `current` deliberately keeps pointing at the last FINISHED batch while a
    // new one runs. A poll keyed on `current` would go quiet during exactly the
    // window it exists for.
    route("/eval-dashboard", () =>
      dash({ latest_batch: batch({ id: "b2", status: "running", finished_at: null }) }),
    );

    renderHook(() => useEvalDashboard(AGENT), { wrapper });
    await advance(0);
    await advance(POLL_MS);

    expect(callsTo("/eval-dashboard")).toBe(2);
  });
});

describe("useEvalBatches — polls off its own rows, and stops with them", () => {
  it("polls while any row is `running` and stops once none is", async () => {
    vi.useFakeTimers();
    let rows = [batch({ id: "b2", status: "running" }), batch({ id: "b1" })];
    route(`/agents/${AGENT}/eval-batches`, () => rows);

    renderHook(() => useEvalBatches(AGENT), { wrapper });
    await advance(0);
    expect(callsTo("/eval-batches")).toBe(1);

    await advance(POLL_MS - 1);
    expect(callsTo("/eval-batches")).toBe(1);

    // The running row settles — the list's own condition goes false.
    rows = [batch({ id: "b2" }), batch({ id: "b1" })];
    await advance(1);
    expect(callsTo("/eval-batches")).toBe(2);

    await advance(POLL_MS * 5);
    expect(callsTo("/eval-batches")).toBe(2);
  });

  it("does not poll a history with no running row", async () => {
    vi.useFakeTimers();
    route(`/agents/${AGENT}/eval-batches`, () => [batch()]);

    renderHook(() => useEvalBatches(AGENT), { wrapper });
    await advance(0);
    await advance(POLL_MS * 5);

    expect(callsTo("/eval-batches")).toBe(1);
  });
});

describe("the reads are disabled without an owner", () => {
  it("asks for nothing when the agent id is null or undefined", async () => {
    // The failure this prevents is a request to `/agents/null/eval-cases`, which
    // 404s and surfaces as an error state on a page that is merely still
    // resolving which agent it is about.
    renderHook(
      () => ({
        cases: useEvalCases(null),
        dashboard: useEvalDashboard(undefined),
        batches: useEvalBatches(null),
        batch: useEvalBatch(null),
      }),
      { wrapper },
    );

    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ==========================================================================
   2. `useRunEvalBatch` — one mutation, three effects.
   ========================================================================== */

describe("useRunEvalBatch — what the 202 does to the cache", () => {
  it("seeds the batch row, so its poll starts with data and no loading flash", async () => {
    const started = batch({ id: "b-new", status: "running", finished_at: null });
    route(`/agents/${AGENT}/eval-batches`, () => started);

    const run = renderHook(() => useRunEvalBatch(AGENT), { wrapper });
    await act(async () => {
      await run.result.current.mutateAsync();
    });

    // A consumer that now watches this batch has its row IMMEDIATELY — on the
    // very first render, from the mutation's own response body. Without the
    // seed it would mount into `isLoading`, and the "a batch is running" state
    // would flicker through "unknown" on the way in.
    const watch = renderHook(() => useEvalBatch("b-new"), { wrapper });
    expect(watch.result.current.data).toEqual(started);
    expect(watch.result.current.isLoading).toBe(false);
  });

  it("invalidates the dashboard AND the batch history, so both move at once", async () => {
    route(`/agents/${AGENT}/eval-dashboard`, () => dash());
    route(`/agents/${AGENT}/eval-batches`, () => [batch()]);
    route(`/agents/${AGENT}/eval-cases`, () => [evalCase()]);

    const view = renderHook(
      () => ({
        cases: useEvalCases(AGENT),
        dashboard: useEvalDashboard(AGENT),
        batches: useEvalBatches(AGENT),
        run: useRunEvalBatch(AGENT),
      }),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.batches.data).toBeDefined());

    const before = {
      dashboard: callsTo(`/agents/${AGENT}/eval-dashboard`),
      batches: callsTo(`/agents/${AGENT}/eval-batches`),
      cases: callsTo(`/agents/${AGENT}/eval-cases`),
    };

    await act(async () => {
      await view.result.current.run.mutateAsync();
    });

    // The dashboard refetch is what makes `latest_batch.status` say `running`
    // — i.e. what disables the run action without waiting for the next
    // scheduled poll (AC-80).
    await waitFor(() =>
      expect(callsTo(`/agents/${AGENT}/eval-dashboard`)).toBe(before.dashboard + 1),
    );
    // The history gains its `running` row now, rather than whenever the list
    // next happens to refetch. `+2` counts the POST, which shares this suffix.
    await waitFor(() =>
      expect(callsTo(`/agents/${AGENT}/eval-batches`)).toBe(before.batches + 2),
    );
    // …and the CASE SET did not move: running a batch changes no case. This is
    // the boundary half — an invalidation that fires on everything is not the
    // same feature as one that fires on the right things.
    expect(callsTo(`/agents/${AGENT}/eval-cases`)).toBe(before.cases);
  });
});

/* ==========================================================================
   3. `invalidateEvals` is deliberately NARROW.
   ========================================================================== */

describe("invalidateEvals — the case set moves, the batch history does not", () => {
  /** Mount all three reads plus the case mutations against one agent. */
  function mountAll() {
    route(`/agents/${AGENT}/eval-cases`, () => [evalCase()]);
    route(`/agents/${AGENT}/eval-dashboard`, () => dash());
    route(`/agents/${AGENT}/eval-batches`, () => [batch()]);
    route("/eval-cases", () => evalCase());
    route("/eval-cases/case-1", () => evalCase());

    return renderHook(
      () => ({
        cases: useEvalCases(AGENT),
        dashboard: useEvalDashboard(AGENT),
        batches: useEvalBatches(AGENT),
        create: useCreateEvalCase(),
        update: useUpdateEvalCase(),
        remove: useDeleteEvalCase(),
      }),
      { wrapper },
    );
  }

  it("saving a NEW case refetches the case list and the dashboard, never the history", async () => {
    const view = mountAll();
    await waitFor(() => expect(view.result.current.batches.data).toBeDefined());
    const casesBefore = callsTo(`/agents/${AGENT}/eval-cases`);
    const batchesBefore = callsTo(`/agents/${AGENT}/eval-batches`);

    await act(async () => {
      await view.result.current.create.mutateAsync(UPSERT);
    });

    // The dashboard moves because `cases_total` is denormalized onto it.
    await waitFor(() =>
      expect(callsTo(`/agents/${AGENT}/eval-cases`)).toBe(casesBefore + 1),
    );
    // THE BOUNDARY. Widening `invalidateEvals` to cover the history would
    // refetch up to 50 batch rows on every save in the case editor — invisible
    // on screen, and the reason this assertion is on absence.
    expect(callsTo(`/agents/${AGENT}/eval-batches`)).toBe(batchesBefore);
  });

  it("editing an existing case moves the same two, and only those two", async () => {
    const view = mountAll();
    await waitFor(() => expect(view.result.current.batches.data).toBeDefined());
    const casesBefore = callsTo(`/agents/${AGENT}/eval-cases`);
    const batchesBefore = callsTo(`/agents/${AGENT}/eval-batches`);

    await act(async () => {
      await view.result.current.update.mutateAsync({ id: "case-1", body: UPSERT });
    });

    await waitFor(() =>
      expect(callsTo(`/agents/${AGENT}/eval-cases`)).toBe(casesBefore + 1),
    );
    expect(callsTo(`/agents/${AGENT}/eval-batches`)).toBe(batchesBefore);
  });

  it("deleting takes its agent from the ARGUMENT, because the response has no owner", async () => {
    // `DELETE /eval-cases/:id` answers `{ deleted: id }` and nothing else, so
    // the only way to know whose list changed is the caller's `agentId`. Drop
    // it and the row vanishes from the server while the tab keeps showing it
    // until a reload.
    const other = "agent-2";
    route(`/agents/${other}/eval-cases`, () => [evalCase({ owner_id: other })]);
    route("/eval-cases/case-1", () => ({ deleted: "case-1" }));

    const view = mountAll();
    const otherView = renderHook(() => useEvalCases(other), { wrapper });
    await waitFor(() => expect(otherView.result.current.data).toBeDefined());
    const mineBefore = callsTo(`/agents/${AGENT}/eval-cases`);
    const theirsBefore = callsTo(`/agents/${other}/eval-cases`);

    await act(async () => {
      await view.result.current.remove.mutateAsync({ id: "case-1", agentId: AGENT });
    });

    await waitFor(() => expect(callsTo(`/agents/${AGENT}/eval-cases`)).toBe(mineBefore + 1));
    // Scoped, not global: another agent's set is untouched.
    expect(callsTo(`/agents/${other}/eval-cases`)).toBe(theirsBefore);
  });
});

/* ==========================================================================
   4. `useCreateEvalCaseFromFinding` — the owner comes off the RESPONSE, and
      `reviews` is deliberately left alone.
   ========================================================================== */

describe("useCreateEvalCaseFromFinding", () => {
  const OWNER = "agent-7";

  function mountFindingPath() {
    const created: CreateEvalCaseFromFinding = {
      case: evalCase({ id: "case-new", owner_id: OWNER }),
      existing_cases: [],
    };
    route("/findings/f1/eval-case", () => created);
    route(`/agents/${OWNER}/eval-cases`, () => [created.case]);
    route(`/agents/${OWNER}/eval-dashboard`, () => dash({ owner_id: OWNER }));
    route(`/agents/${AGENT}/eval-cases`, () => [evalCase()]);
    route("/pulls/pr1/reviews", () => []);

    return renderHook(
      () => ({
        ownerCases: useEvalCases(OWNER),
        ownerDashboard: useEvalDashboard(OWNER),
        otherCases: useEvalCases(AGENT),
        reviews: usePrReviews("pr1"),
        seed: useCreateEvalCaseFromFinding(),
      }),
      { wrapper },
    );
  }

  it("invalidates the OWNING agent, read off the response — the card knows no agent id", async () => {
    // A finding card has a finding, not an agent. The owner arrives on the
    // created row, which is why the caller passes only a finding id.
    const view = mountFindingPath();
    await waitFor(() => expect(view.result.current.ownerCases.data).toBeDefined());
    const ownerBefore = callsTo(`/agents/${OWNER}/eval-cases`);
    const otherBefore = callsTo(`/agents/${AGENT}/eval-cases`);

    await act(async () => {
      await view.result.current.seed.mutateAsync("f1");
    });

    await waitFor(() => expect(callsTo(`/agents/${OWNER}/eval-cases`)).toBe(ownerBefore + 1));
    // A different agent's set is not touched — the invalidation is keyed by the
    // owner the server named, not fired at everything.
    expect(callsTo(`/agents/${AGENT}/eval-cases`)).toBe(otherBefore);
  });

  it("does NOT invalidate `reviews` — the payload would come back identical", async () => {
    // Creating a case writes a different table on a different route and changes
    // nothing `GET /pulls/:id/reviews` returns. Invalidating it would flash the
    // findings panel through its loading state to receive a byte-identical
    // body. This is subtle enough to look like an omission, so it is pinned.
    const view = mountFindingPath();
    await waitFor(() => expect(view.result.current.reviews.data).toBeDefined());
    const reviewsBefore = callsTo("/pulls/pr1/reviews");

    await act(async () => {
      await view.result.current.seed.mutateAsync("f1");
    });
    await waitFor(() => expect(callsTo(`/agents/${OWNER}/eval-cases`)).toBeGreaterThan(0));

    expect(callsTo("/pulls/pr1/reviews")).toBe(reviewsBefore);
  });
});
