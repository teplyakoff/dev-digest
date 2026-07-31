/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../../messages/en/common.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.0013,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function finding(o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    review_id: "rev-1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A live key is committed in source.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], findingsByRunId?: Map<string, FindingRecord[]>) {
  // `common` rides along for SeverityCounters' popup header — the documented
  // shared-component namespace fan-out.
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, common }}>
      <RunHistory runs={runs} findingsByRunId={findingsByRunId} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — severity chips", () => {
  it("a settled run with a joined review shows chips instead of the count text", () => {
    renderRuns(
      [run({ status: "done", findings_count: 2, blockers: 1, score: 62 })],
      new Map([
        ["run-1", [finding(), finding({ id: "f2", severity: "SUGGESTION", category: "style" })]],
      ]),
    );
    expect(screen.getByLabelText("1 Critical")).toBeInTheDocument();
    expect(screen.getByLabelText("1 Suggestion")).toBeInTheDocument();
    expect(screen.queryByText("2 finding(s)")).not.toBeInTheDocument();
    // blockers ride along as the chips' suffix
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();
  });

  it("hovering the chips opens the findings popup", () => {
    renderRuns(
      [run({ status: "done", findings_count: 1, blockers: 0 })],
      new Map([["run-1", [finding()]]]),
    );
    fireEvent.mouseEnter(screen.getByLabelText("1 Critical").parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
  });

  it("a settled run WITHOUT a joinable review keeps the legacy count text", () => {
    renderRuns(
      [run({ status: "done", findings_count: 3, blockers: 0 })],
      new Map(), // review deleted / summary kind — nothing to join
    );
    expect(screen.getByText("3 finding(s)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Critical|Warning|Suggestion/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — spend", () => {
  it("a settled run shows its tokens and cost", () => {
    renderRuns([run({ status: "done", tokens_in: 9000, tokens_out: 119, cost_usd: 0.0013 })]);
    expect(screen.getByText(/9,119 tok · \$0\.0013/)).toBeInTheDocument();
  });

  it("a settled run with no cost data shows an em-dash, not $0.00", () => {
    renderRuns([run({ status: "done", cost_usd: null })]);
    expect(screen.getByText(/tok · —/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00\b/)).not.toBeInTheDocument();
  });

  it("an unsettled run shows no spend line at all", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.queryByText(/tok ·/)).not.toBeInTheDocument();
  });
});
