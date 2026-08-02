/**
 * PRRow — the list row. Guards the COST cell (the last completed run's spend;
 * unreviewed reads "—", never "$0.00") and the FINDINGS cell (latest review's
 * severity split; unreviewed reads "—", a clean review also reads "—").
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import prReview from "../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../messages/en/common.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import { PRRow } from "./PRRow";

afterEach(cleanup);

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add token-bucket rate limiter",
    author: "octocat",
    branch: "feat/limiter",
    base: "main",
    head_sha: "abc1234",
    additions: 120,
    deletions: 22,
    files_count: 4,
    status: "reviewed",
    opened_at: "2026-06-11T18:00:00.000Z",
    updated_at: "2026-06-11T18:44:34.000Z",
    score: 72,
    cost_usd: 0.012,
    findings_by_severity: { CRITICAL: 1, WARNING: 2, SUGGESTION: 0 },
    latest_findings: [
      {
        severity: "CRITICAL",
        category: "security",
        title: "Hardcoded Stripe secret key",
        file: "src/config.ts",
        start_line: 11,
        end_line: 11,
        confidence: 0.95,
        rationale: "A live key is committed in source.",
      },
      {
        severity: "WARNING",
        category: "bug",
        title: "429 without Retry-After",
        file: "src/middleware/limit.ts",
        start_line: 30,
        end_line: 34,
        confidence: 0.8,
        rationale: "Clients cannot back off correctly.",
      },
      {
        severity: "WARNING",
        category: "perf",
        title: "Bucket lookup is O(n)",
        file: "src/middleware/limit.ts",
        start_line: 12,
        end_line: 12,
        confidence: 0.7,
        rationale: "Linear scan per request.",
      },
    ],
    ...o,
  };
}

function renderRow(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, common }}>
      <PRRow pr={meta} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — cost cell", () => {
  it("shows the latest run's cost at three significant digits", () => {
    renderRow(pr({ cost_usd: 0.012 }));
    expect(screen.getByText("$0.012")).toBeInTheDocument();
  });

  it("shows an em-dash for a PR that has never been run", () => {
    renderRow(
      pr({ cost_usd: null, score: null, findings_by_severity: null, latest_findings: null }),
    );
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
    // Score ring, findings cell and cost cell all fall back to an em-dash.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("never rounds a sub-cent run down to $0.00", () => {
    renderRow(pr({ cost_usd: 0.0013 }));
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });
});

describe("PRRow — findings cell", () => {
  it("renders a chip per non-zero severity from the server counts", () => {
    renderRow(pr());
    expect(screen.getByLabelText("1 Critical")).toBeInTheDocument();
    expect(screen.getByLabelText("2 Warning")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Suggestion/)).not.toBeInTheDocument();
  });

  it("shows an em-dash for a clean review (real zeros), not a zero chip", () => {
    renderRow(
      pr({
        findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
        latest_findings: [],
      }),
    );
    // score ring still renders (score 72) — the dash belongs to findings+cost cells
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText(/Critical|Warning|Suggestion/)).not.toBeInTheDocument();
  });

  it("hovering the cell opens the findings popup with details", () => {
    renderRow(pr());
    fireEvent.mouseEnter(screen.getByLabelText("1 Critical").parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("3 findings")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("src/middleware/limit.ts:30-34")).toBeInTheDocument();
  });
});
