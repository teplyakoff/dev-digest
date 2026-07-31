import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const FINDINGS: FindingRecord[] = [finding({})];

const MIXED: FindingRecord[] = [
  finding({}),
  finding({ id: "f2", severity: "WARNING", category: "bug", title: "429 without Retry-After" }),
  finding({ id: "f3", severity: "SUGGESTION", category: "style", title: "Extract for readability" }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — severity filter chips", () => {
  it("renders one chip per severity with the review's counts", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    for (const label of ["Critical", "Warning", "Suggestion"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("clicking a chip hides that severity; clicking again restores it", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    const criticalChip = screen.getByRole("button", { name: /Critical/ });

    fireEvent.click(criticalChip);
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.getByText("429 without Retry-After")).toBeInTheDocument();
    expect(screen.getByText("Extract for readability")).toBeInTheDocument();

    fireEvent.click(criticalChip);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("chip counts stay put while filtering (they describe the review, not the view)", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: /Critical/ }));
    // the chip still reports 1 hidden critical
    expect(screen.getByRole("button", { name: /Critical 1/ })).toBeInTheDocument();
  });

  it("all chips off shows the existing no-match empty state", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    for (const label of ["Critical", "Warning", "Suggestion"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    }
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("severity chips compose with the hide-low-confidence toggle", () => {
    const withLowConf = [
      ...MIXED,
      finding({ id: "f4", severity: "WARNING", title: "Shaky guess", confidence: 0.4 }),
    ];
    renderWithIntl(<FindingsPanel findings={withLowConf} prId="pr1" />);
    // hide low confidence first
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Shaky guess")).not.toBeInTheDocument();
    // then filter out criticals — the confident warning remains
    fireEvent.click(screen.getByRole("button", { name: /Critical/ }));
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.getByText("429 without Retry-After")).toBeInTheDocument();
  });
});
