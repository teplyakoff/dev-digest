// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`
// (client/INSIGHTS.md, "Codebase Patterns").
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalBatchRecord, EvalDashboard as Data } from "@devdigest/shared";
import eval_ from "../../../../../messages/en/eval.json";
import common from "../../../../../messages/en/common.json";

/**
 * THE GAP THIS FILE COVERS. `EvalDashboard.test.tsx` hands the dashboard and
 * the batch list in as props, and would stay green forever even if nothing on
 * the `/evals` route ever passed them — the exact shape of the bug that shipped
 * `AgentCard`'s skill-count badge green and invisible (client/INSIGHTS.md,
 * 2026-08-05). This is the only place the three queries are seen reaching the
 * component that renders them.
 *
 * The shell is mocked, per that same entry: rendering it for real drags in the
 * repo switcher, the theme and the router for a test about eval data.
 */
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const runMutate = vi.fn();
const agents = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const dashboard = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const batches = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => agents.current }));
vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: () => dashboard.current,
  useEvalBatches: () => batches.current,
  useRunEvalBatch: () => ({ mutate: runMutate, isPending: false, error: null }),
  // Reached through the nested `EvalDashboard`'s compare flow.
  useEvalCompare: () => ({ data: undefined, isLoading: false }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

const AGENT = { id: "agent-1", name: "Security Reviewer", model: "deepseek/v4" } as Agent;

function batch(o: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    id: "b1",
    agent_id: "agent-1",
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

function dash(o: Partial<Data> = {}): Data {
  return {
    owner_kind: "agent",
    owner_id: "agent-1",
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

beforeEach(() => {
  runMutate.mockReset();
  agents.current = { data: [AGENT], isLoading: false, isError: false };
  dashboard.current = { data: dash(), isLoading: false, isError: false };
  batches.current = { data: [batch()], isLoading: false, isError: false };
});

afterEach(cleanup);

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: eval_, common }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

const runButton = () => screen.getByRole("button", { name: /Run eval|Running/ });

describe("EvalDashboardView — the queries reach the dashboard", () => {
  it("renders the picked agent's metrics and its batch rows", () => {
    renderView();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    // Twice, and both are wanted: once in the metric strip from
    // `useEvalDashboard`, once in the batch row from `useEvalBatches`. They are
    // two separate queries feeding two separate components, which is exactly
    // the wiring this file exists to see.
    expect(screen.getAllByText("75%")).toHaveLength(2);
    // The table exists at all only because `batches` was passed: the dashboard
    // payload carries no batch ids, so a view that forgot that prop shows a
    // full metric strip above a table that never appears.
    expect(screen.getByText(eval_.dashboard.recentRuns)).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("counts runs from the batch HISTORY, not from the finished-batch trend", () => {
    // `trend` holds finished batches only, so a run in flight would go
    // uncounted in the very sentence describing it.
    batches.current = {
      data: [batch(), batch({ id: "b2", status: "running" })],
      isLoading: false,
      isError: false,
    };
    dashboard.current = { data: dash({ trend: [] }), isLoading: false, isError: false };
    renderView();

    expect(screen.getByText(/2 runs/)).toBeInTheDocument();
  });
});

describe("EvalDashboardView — the run action", () => {
  it("runs the set when there is something to run", () => {
    renderView();
    expect(runButton()).toBeEnabled();
    fireEvent.click(runButton());
    expect(runMutate).toHaveBeenCalledTimes(1);
  });

  it("AC-80 — stays disabled while a batch is in flight, from `latest_batch`", () => {
    dashboard.current = {
      data: dash({ latest_batch: batch({ status: "running", finished_at: null }) }),
      isLoading: false,
      isError: false,
    };
    renderView();

    expect(runButton()).toBeDisabled();
    fireEvent.click(runButton());
    expect(runMutate).not.toHaveBeenCalled();
  });

  it("refuses to start a run for an agent with an empty set", () => {
    // The server answers 422 here. Sending the request anyway would turn a
    // knowable state into an error message.
    dashboard.current = { data: dash({ cases_total: 0 }), isLoading: false, isError: false };
    renderView();
    expect(runButton()).toBeDisabled();
  });
});

describe("EvalDashboardView — failures are not disguised as emptiness", () => {
  it("shows a failed batch-history fetch instead of an empty runs table", () => {
    // Silently rendering "no runs yet" over a failed fetch asserts something
    // the server never said.
    batches.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("eval-batches is down"),
    };
    renderView();
    expect(screen.getByRole("alert")).toHaveTextContent("eval-batches is down");
  });

  it("shows the dashboard query's own error with a retry", () => {
    dashboard.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("eval-dashboard is down"),
      refetch: vi.fn(),
    };
    renderView();
    expect(screen.getByText("eval-dashboard is down")).toBeInTheDocument();
  });

  it("says there are no agents rather than rendering an empty dashboard", () => {
    agents.current = { data: [], isLoading: false, isError: false };
    renderView();
    expect(screen.getByText(common.states.empty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run eval/ })).not.toBeInTheDocument();
  });
});
