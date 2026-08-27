// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`
// (client/INSIGHTS.md, "Codebase Patterns").
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  EvalBatchCompare,
  EvalBatchRecord,
  EvalDashboard as Data,
  EvalTrendPoint,
} from "@devdigest/shared";
import eval_ from "../../../../messages/en/eval.json";
import common from "../../../../messages/en/common.json";

/**
 * `EvalDashboard` calls `useEvalCompare` itself — it owns the compare flow end
 * to end, because the selection that arms it lives in the runs table directly
 * below. So it needs either a `QueryClientProvider` or this mock; the mock is
 * what lets the compare hook's ARGUMENTS be asserted, which is the whole point
 * of the flow test below: the pair the table produced has to reach the query in
 * (older, newer) order or every delta on the next screen renders inverted.
 */
const compareCalls: (string | undefined)[][] = [];
const compareResult = vi.hoisted(() => ({
  current: { data: undefined, isLoading: false } as Record<string, unknown>,
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCompare: (a?: string, b?: string) => {
    compareCalls.push([a, b]);
    return compareResult.current;
  },
}));

import { EvalDashboard } from "./EvalDashboard";

beforeEach(() => {
  compareCalls.length = 0;
  compareResult.current = { data: undefined, isLoading: false };
});

afterEach(cleanup);

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

function point(ran_at: string, recall: number | null): EvalTrendPoint {
  return { ran_at, recall, precision: 0.5, citation_accuracy: 1, cost_usd: 0.001, pass_rate: 0.6 };
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
    trend: [point("2026-08-20T10:00:00Z", 0.75)],
    recent_runs: [],
    alert: null,
    ...o,
  };
}

/** The payload an agent that has never had a batch actually gets back. */
const NEVER_RAN: Partial<Data> = {
  current: {
    recall: null,
    precision: null,
    citation_accuracy: null,
    traces_passed: 0,
    traces_total: 0,
    cost_usd: null,
    partial: false,
  },
  latest_batch: null,
  delta: null,
  trend: [],
};

function renderDashboard(props: Partial<React.ComponentProps<typeof EvalDashboard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: eval_, common }}>
      <EvalDashboard dashboard={dash()} {...props} />
    </NextIntlClientProvider>,
  );
}

/** The polite live region, mounted from the first render (NFR-13). */
const liveRegion = () => document.querySelector('[aria-live="polite"]') as HTMLElement;

describe("EvalDashboard — no runs yet (AC-85)", () => {
  it("says there are no runs, and still shows the strip's four dashes", () => {
    renderDashboard({ dashboard: dash(NEVER_RAN), batches: [] });

    expect(screen.getByText(eval_.dashboard.noRuns)).toBeInTheDocument();
    // The strip stays put so the SHAPE of the page does not change when the
    // first batch lands — and it shows dashes, never zeroes.
    expect(screen.getAllByText(eval_.dashboard.unknownValue)).toHaveLength(4);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("does NOT claim 'no runs' while a batch list already has rows", () => {
    // The aggregate and the history come from two endpoints and can land out of
    // step. Gating on the aggregate alone puts "no runs yet" above a table with
    // rows in it.
    renderDashboard({ dashboard: dash(NEVER_RAN), batches: [batch()] });

    expect(screen.queryByText(eval_.dashboard.noRuns)).not.toBeInTheDocument();
    expect(screen.getByText(eval_.dashboard.recentRuns)).toBeInTheDocument();
  });
});

describe("EvalDashboard — the regression banner (AC-93, AC-94, NFR-13)", () => {
  it("AC-93 — renders the server's sentence verbatim", () => {
    const sentence = "Recall dropped 12 points against the previous batch.";
    renderDashboard({ dashboard: dash({ alert: sentence }) });

    expect(screen.getByText(sentence)).toBeInTheDocument();
    expect(screen.getByText(eval_.dashboard.regressionAlert)).toBeInTheDocument();
    // NFR-13 — it has to live INSIDE the region that announces, not merely
    // somewhere on the page.
    expect(within(liveRegion()).getByText(sentence)).toBeInTheDocument();
  });

  it("AC-94 — an empty warning renders no banner at all", () => {
    // An empty frame with a heading and no sentence is worse than nothing: it
    // announces a regression and then declines to name one.
    renderDashboard({ dashboard: dash({ alert: "   " }) });
    expect(screen.queryByText(eval_.dashboard.regressionAlert)).not.toBeInTheDocument();
  });

  it("NFR-13 — the live region is mounted and EMPTY before there is anything to say", () => {
    // A live region that appears together with its text announces nothing:
    // screen readers watch a region for changes, and a region that did not
    // exist a moment ago has no change to report.
    renderDashboard({ dashboard: dash({ alert: null }) });
    expect(liveRegion()).toBeInTheDocument();
    expect(liveRegion()).toBeEmptyDOMElement();
  });
});

describe("EvalDashboard — the trend chart", () => {
  it("AC-95 — a trend of exactly ONE point renders without dividing by zero", () => {
    // `(x - 0) / (n - 1)` is the natural way to lay out N points, and it is a
    // division by zero at N = 1 — which is every agent's first batch, i.e. the
    // most common state this chart is ever in.
    renderDashboard({ dashboard: dash({ trend: [point("2026-08-20T10:00:00Z", 0.75)] }) });

    const chart = screen.getByRole("img", { name: eval_.dashboard.metricTrend });
    expect(chart).toBeInTheDocument();
    // One point is a dot, not a line: three series, three circles, no polyline
    // with a NaN coordinate in it.
    expect(chart.querySelectorAll("circle")).toHaveLength(3);
    expect(chart.innerHTML).not.toContain("NaN");
  });

  it("breaks the line at an unknown point instead of drawing it down to zero", () => {
    renderDashboard({
      dashboard: dash({
        trend: [
          point("2026-08-18T10:00:00Z", 0.8),
          point("2026-08-19T10:00:00Z", null),
          point("2026-08-20T10:00:00Z", 0.75),
        ],
      }),
    });

    const chart = screen.getByRole("img", { name: eval_.dashboard.metricTrend });
    // Recall's line is cut into two one-point segments — drawn as dots — while
    // precision and citation stay whole. A `?? 0` would instead draw a cliff to
    // the floor and back, which reads as a catastrophic batch that never
    // happened.
    expect(chart.querySelectorAll("circle")).toHaveLength(2);
    expect(chart.innerHTML).not.toContain("NaN");
  });
});

describe("EvalDashboard — the compare flow, end to end", () => {
  it("passes the table's (older, newer) pair to the compare query and opens the modal", () => {
    // The link this pins: the runs table decides the ORDER and this component
    // turns it into query arguments. Swap them and the modal renders every
    // delta with its sign inverted — an improvement shown as a regression,
    // which looks like a result rather than a bug.
    const newer = batch({ id: "b-new", started_at: "2026-08-20T10:00:00.000Z" });
    const older = batch({ id: "b-old", started_at: "2026-08-19T10:00:00.000Z" });
    const loaded: EvalBatchCompare = {
      a: older,
      b: newer,
      deltas: { recall: 0.08, precision: null, citation_accuracy: null, cost_usd: null },
      comparable: true,
      prompt_diff_available: true,
    };

    renderDashboard({ batches: [newer, older] });

    // Nothing is asked of the compare endpoint until a pair exists.
    expect(compareCalls.every(([a, b]) => a === undefined && b === undefined)).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);

    compareResult.current = { data: loaded, isLoading: false };
    fireEvent.click(screen.getByRole("button", { name: eval_.dashboard.compare }));

    expect(compareCalls.at(-1)).toEqual(["b-old", "b-new"]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(eval_.dashboard.compareTitle)).toBeInTheDocument();
  });

  it("closing the comparison drops the pair, so the query goes idle again", () => {
    const newer = batch({ id: "b-new", started_at: "2026-08-20T10:00:00.000Z" });
    const older = batch({ id: "b-old", started_at: "2026-08-19T10:00:00.000Z" });
    renderDashboard({ batches: [newer, older] });

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: eval_.dashboard.compare }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Escape is the modal's own escape path; the vendored primitive has none.
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // A pair left behind keeps the comparison query alive — and polling — for a
    // modal nobody is looking at.
    expect(compareCalls.at(-1)).toEqual([undefined, undefined]);
  });
});
