/**
 * PRRow — the list row. Guards the COST cell: it shows the last completed run's
 * spend, and an unreviewed PR must read "—" rather than a fabricated "$0.00".
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
    renderRow(pr({ cost_usd: null, score: null }));
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
    // Both the score ring and the cost cell fall back to an em-dash.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("never rounds a sub-cent run down to $0.00", () => {
    renderRow(pr({ cost_usd: 0.0013 }));
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });
});
