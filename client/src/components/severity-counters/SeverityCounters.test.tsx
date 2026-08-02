import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "../../../messages/en/common.json";
import { SeverityCounters } from "./SeverityCounters";
import {
  countBySeverity,
  hasAnyCount,
  sortBySeverity,
  formatLineRef,
  stripMd,
  type SlimFinding,
} from "./helpers";

afterEach(cleanup);

function slim(overrides: Partial<SlimFinding> = {}): SlimFinding {
  return {
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    confidence: 0.95,
    rationale: "A **live** `sk_live_` key is committed in source.",
    ...overrides,
  };
}

function renderCounters(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("helpers", () => {
  it("countBySeverity zero-seeds and ignores unknown severities", () => {
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    expect(
      countBySeverity([{ severity: "CRITICAL" }, { severity: "INFO" }, { severity: "CRITICAL" }]),
    ).toEqual({ CRITICAL: 2, WARNING: 0, SUGGESTION: 0 });
  });

  it("hasAnyCount separates clean-review zeros from real counts", () => {
    expect(hasAnyCount({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 })).toBe(false);
    expect(hasAnyCount({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 })).toBe(true);
  });

  it("sortBySeverity orders CRITICAL → WARNING → SUGGESTION", () => {
    const sorted = sortBySeverity([
      { severity: "SUGGESTION" },
      { severity: "CRITICAL" },
      { severity: "WARNING" },
    ]);
    expect(sorted.map((f) => f.severity)).toEqual(["CRITICAL", "WARNING", "SUGGESTION"]);
  });

  it("formatLineRef collapses a same-line range", () => {
    expect(formatLineRef({ file: "src/a.ts", start_line: 11, end_line: 11 })).toBe("src/a.ts:11");
    expect(formatLineRef({ file: "src/a.ts", start_line: 3, end_line: 9 })).toBe("src/a.ts:3-9");
  });

  it("stripMd drops bold/backtick markers and tolerates null", () => {
    expect(stripMd("A **live** `key`")).toBe("A live key");
    expect(stripMd(null)).toBe("");
  });
});

describe("SeverityCounters", () => {
  it("renders one chip per non-zero severity with its count", () => {
    renderCounters(
      <SeverityCounters
        findings={[slim(), slim({ severity: "WARNING", category: "bug" }), slim()]}
      />,
    );
    expect(screen.getByLabelText("2 Critical")).toBeTruthy();
    expect(screen.getByLabelText("1 Warning")).toBeTruthy();
    expect(screen.queryByLabelText(/Suggestion/)).toBeNull();
  });

  it("renders an em-dash for unreviewed (null), NOT an empty chip row", () => {
    renderCounters(<SeverityCounters findings={null} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("renders an em-dash for a clean review (all-zero counts)", () => {
    renderCounters(
      <SeverityCounters findings={[]} counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} />,
    );
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("prefers server counts over deriving from findings", () => {
    renderCounters(
      <SeverityCounters findings={[slim()]} counts={{ CRITICAL: 3, WARNING: 0, SUGGESTION: 1 }} />,
    );
    expect(screen.getByLabelText("3 Critical")).toBeTruthy();
    expect(screen.getByLabelText("1 Suggestion")).toBeTruthy();
  });

  it("hover mounts the popup with finding details; leave unmounts it", () => {
    const { container } = renderCounters(
      <SeverityCounters
        findings={[slim(), slim({ severity: "SUGGESTION", category: "style", start_line: 3, end_line: 9 })]}
      />,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(container.querySelector("[style*='fit-content']")!);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(screen.getByText("2 findings")).toBeTruthy();
    expect(screen.getAllByText("Hardcoded Stripe secret key").length).toBeGreaterThan(0);
    expect(screen.getByText("src/config.ts:11")).toBeTruthy();
    expect(screen.getByText("src/config.ts:3-9")).toBeTruthy();
    // markdown markers are stripped in the rationale
    expect(screen.getAllByText(/A live sk_live_ key/).length).toBeGreaterThan(0);

    fireEvent.mouseLeave(container.querySelector("[style*='fit-content']")!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders the suffix after the chips", () => {
    renderCounters(<SeverityCounters findings={[slim()]} suffix={<span>· 2 blockers</span>} />);
    expect(screen.getByText("· 2 blockers")).toBeTruthy();
  });
});
