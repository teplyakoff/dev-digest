// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`
// (client/INSIGHTS.md, "Codebase Patterns").
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCaseRecord, EvalDashboard, EvalTrendPoint } from "@devdigest/shared";
// EIGHT levels up from `.../AgentEditor/_components/EvalsTab/`.
import eval_ from "../../../../../../../../messages/en/eval.json";
import common from "../../../../../../../../messages/en/common.json";

/**
 * THE GUARD THAT MATTERS HERE, and it is the reason this file exists on top of
 * `EvalMetricStrip.test.tsx` and `EvalCaseRow.test.tsx`.
 *
 * Both of those pass their props by hand, and a component test that does so
 * proves nothing about whether anything passes them — that is exactly how
 * `AgentCard`'s skill-count badge shipped green and invisible for a whole
 * lesson (client/INSIGHTS.md, 2026-08-05). The tab is where the four hooks meet
 * the two components, so it is the only place the wiring is observable.
 *
 * The hooks are stubbed rather than driven over a mocked `fetch` because what is
 * under test is the tab's BRANCHING — loading, empty, running, populated — and
 * each of those is a hook state, not a response body.
 */
const runMutate = vi.fn();
const deleteMutate = vi.fn();

const cases = vi.hoisted(() => ({
  current: { data: undefined, isLoading: false, isError: false } as Record<string, unknown>,
}));
const dashboard = vi.hoisted(() => ({ current: { data: undefined } as Record<string, unknown> }));
const runBatch = vi.hoisted(() => ({
  current: { isPending: false, isError: false } as Record<string, unknown>,
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => cases.current,
  useEvalDashboard: () => dashboard.current,
  useRunEvalBatch: () => ({ ...runBatch.current, mutate: runMutate }),
  useDeleteEvalCase: () => ({ mutate: deleteMutate }),
  // The editor modal this tab opens calls these two directly.
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams.current }));

import { EvalsTab } from "./EvalsTab";

const AGENT = { id: "agent-1", name: "Security Reviewer" } as Agent;

function evalCase(o: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
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

function point(ran_at: string, recall: number | null): EvalTrendPoint {
  return { ran_at, recall, precision: 0.5, citation_accuracy: 1, cost_usd: 0.001, pass_rate: 0.6 };
}

function dash(o: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: 2,
    current: {
      recall: 0.75,
      precision: 0.5,
      citation_accuracy: 1,
      traces_passed: 6,
      traces_total: 8,
      cost_usd: 0.0013,
      partial: false,
    },
    latest_batch: null,
    delta: null,
    trend: [],
    recent_runs: [],
    alert: null,
    ...o,
  };
}

beforeEach(() => {
  runMutate.mockReset();
  deleteMutate.mockReset();
  cases.current = { data: undefined, isLoading: false, isError: false };
  dashboard.current = { data: undefined };
  runBatch.current = { isPending: false, isError: false };
  searchParams.current = new URLSearchParams();
});

afterEach(cleanup);

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: eval_, common }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

const runAllButton = () =>
  screen.getByRole("button", { name: new RegExp(`${eval_.evalsTab.runAll}|Running`) });

describe("EvalsTab — the metric strip is fed from the dashboard query", () => {
  it("renders the four measured tiles from the hook's payload", () => {
    dashboard.current = { data: dash() };
    cases.current = { data: [evalCase()], isLoading: false, isError: false };
    renderTab();

    // The numbers travel: the strip's own test passes them by hand and cannot
    // see whether this tab ever hands them over.
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("6/8")).toBeInTheDocument();
  });

  it("AC-72 — an agent with no batch shows dashes in every tile, and no 0%", () => {
    dashboard.current = { data: undefined };
    cases.current = { data: [evalCase()], isLoading: false, isError: false };
    renderTab();

    expect(screen.getAllByText(eval_.dashboard.unknownValue)).toHaveLength(4);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});

describe("EvalsTab — the case list", () => {
  it("AC-75 — counts come from the agent's ACTUAL set and its actual runs", () => {
    // The design hardcodes "20-trace gold set · 17/20" beside a list of nine
    // cases. Both numbers here are read off the fetched payload, so a set that
    // grows moves the caption with it.
    cases.current = {
      data: [evalCase(), evalCase({ id: "case-2", name: "no-false-positive" })],
      isLoading: false,
      isError: false,
    };
    dashboard.current = {
      data: dash({
        trend: [
          point("2026-08-19T10:00:00Z", 0.6),
          point("2026-08-20T10:00:00Z", 0.7),
          point("2026-08-21T10:00:00Z", 0.8),
        ],
      }),
    };
    renderTab();

    expect(screen.getByText(/2 eval cases/)).toBeInTheDocument();
    expect(screen.getByText(/3 runs/)).toBeInTheDocument();
    expect(screen.getByText("hardcoded-secret")).toBeInTheDocument();
    expect(screen.getByText("no-false-positive")).toBeInTheDocument();
  });

  it("AC-77 — says it is loading rather than showing an empty set", () => {
    // The two states are opposite claims made from the same empty array: "this
    // agent has no cases" versus "we do not know yet".
    cases.current = { data: undefined, isLoading: true, isError: false };
    renderTab();

    expect(screen.getByText(eval_.evalsTab.loadingCases)).toBeInTheDocument();
    expect(screen.queryByText(eval_.evalsTab.emptyCases)).not.toBeInTheDocument();
  });

  it("AC-76 — an empty set says so AND offers the way out", () => {
    cases.current = { data: [], isLoading: false, isError: false };
    renderTab();

    expect(screen.getByText(eval_.evalsTab.emptyCases)).toBeInTheDocument();
    // An empty list with no call to action is where this screen dead-ends; the
    // CTA has to actually open the editor, which is the half a text assertion
    // would miss.
    const ctas = screen.getAllByRole("button", { name: eval_.evalsTab.newCase });
    fireEvent.click(ctas[ctas.length - 1]!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(eval_.caseEditor.newCase)).toBeInTheDocument();
  });

  it("surfaces the case query's own error instead of an empty set", () => {
    cases.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("eval-cases exploded"),
      refetch: vi.fn(),
    };
    renderTab();
    expect(screen.getByText("eval-cases exploded")).toBeInTheDocument();
  });
});

describe("EvalsTab — running the set (AC-80)", () => {
  it("runs the batch on click when nothing is in flight", () => {
    cases.current = { data: [evalCase()], isLoading: false, isError: false };
    dashboard.current = { data: dash() };
    renderTab();

    expect(runAllButton()).toBeEnabled();
    fireEvent.click(runAllButton());
    expect(runMutate).toHaveBeenCalledTimes(1);
  });

  it("keeps the action disabled from `latest_batch`, not from its own pending flag", () => {
    // The criterion's real case: a tab that never received the 202 — a reload
    // mid-batch, or a second browser tab. Reading `runBatch.isPending` alone
    // would leave the button live there, and the server's 409 would become
    // reachable through ordinary use rather than only a race.
    cases.current = { data: [evalCase()], isLoading: false, isError: false };
    dashboard.current = {
      data: dash({
        latest_batch: {
          id: "b1",
          agent_id: "agent-1",
          agent_version: 3,
          system_prompt_snapshot: null,
          provider: "openrouter",
          model: "deepseek/deepseek-v4",
          status: "running",
          cases_total: 2,
          cases_completed: 1,
          recall: null,
          precision: null,
          citation_accuracy: null,
          cost_usd: null,
          partial: false,
          started_at: "2026-08-21T10:00:00.000Z",
          finished_at: null,
        },
      }),
    };
    renderTab();

    expect(runAllButton()).toBeDisabled();
    expect(runAllButton()).toHaveAttribute("title", eval_.evalsTab.runAllDisabled);
    // `current` deliberately keeps pointing at the last FINISHED batch, so the
    // numbers do not collapse to dashes for the length of the run.
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("shows the server's own refusal verbatim — 409 and 422 are different facts", () => {
    cases.current = { data: [], isLoading: false, isError: false };
    runBatch.current = {
      isPending: false,
      isError: true,
      error: new Error("This agent has no eval cases to run."),
    };
    renderTab();

    expect(screen.getByRole("alert")).toHaveTextContent("This agent has no eval cases to run.");
  });
});

describe("EvalsTab — the deep link from the seeding toast", () => {
  /**
   * jsdom implements no `scrollIntoView`, and `EvalCaseRow` calls it directly.
   * The spy goes on `Element.prototype` BEFORE `render()`, because React 19
   * flushes passive effects inside RTL's synchronous render — a spy attached
   * afterwards is attached after the call it wants to see, and the test would
   * read "0 times" and blame the component (client/INSIGHTS.md, 2026-08-08).
   */
  const scrolled: Element[] = [];

  beforeEach(() => {
    scrolled.length = 0;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: function (this: Element) {
        scrolled.push(this);
      },
    });
  });

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it("highlights and scrolls to the case named by ?case=<id>", () => {
    // The success toast links to `/agents/<owner>?tab=evals&case=<id>`; without
    // this the reader lands on the tab and has to find the new case by eye.
    // The target is deliberately NOT the first row — a highlight on row zero
    // would be a false positive for "the deep link worked"
    // (client/INSIGHTS.md, 2026-08-08).
    searchParams.current = new URLSearchParams("case=case-2");
    cases.current = {
      data: [evalCase(), evalCase({ id: "case-2", name: "no-false-positive" })],
      isLoading: false,
      isError: false,
    };
    const { container } = renderTab();

    const target = container.querySelector('[data-case-id="case-2"]') as HTMLElement;
    const other = container.querySelector('[data-case-id="case-1"]') as HTMLElement;

    // jsdom models no layout, so a test can only assert the CALL, never the
    // movement — and only on the row the URL named.
    expect(scrolled).toEqual([target]);
    // The highlight is a specified inline style React just wrote, read off
    // `el.style` rather than `getComputedStyle`: this environment reports the
    // pre-transition value forever for any transitioned property, and the row
    // deliberately carries no transition for exactly that reason
    // (client/INSIGHTS.md, 2026-08-10).
    expect(target.style.border).not.toBe(other.style.border);
    expect(target.style.boxShadow).not.toBe(other.style.boxShadow);
    expect(other.style.boxShadow).toBe("none");
  });
});
