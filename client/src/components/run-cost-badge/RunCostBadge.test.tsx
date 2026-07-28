import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "../../../messages/en/common.json";
import { RunCostBadge } from "./RunCostBadge";
import { formatCost, formatTokenFlow } from "./helpers";

afterEach(cleanup);

function renderBadge(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("formatCost", () => {
  it("renders an em-dash for unknown cost, NOT $0.00", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });

  it("keeps a genuine zero distinct from unknown", () => {
    expect(formatCost(0)).toBe("$0");
  });

  it("never rounds a real cost down to zero", () => {
    // The typical OpenRouter review run — 2 decimals would show "$0.00".
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.00009)).toBe("$0.0001");
  });

  it("shows at least three significant digits below a dollar", () => {
    expect(formatCost(0.012)).toBe("$0.012");
    expect(formatCost(0.06)).toBe("$0.060");
  });

  it("drops to two decimals at a dollar and above", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(12.345)).toBe("$12.35");
  });
});

describe("formatTokenFlow", () => {
  it("renders prompt→completion in thousands", () => {
    expect(formatTokenFlow(8200, 1300)).toBe("8.2K→1.3K");
  });
});

describe("RunCostBadge", () => {
  it("renders the compact variant without tokens", () => {
    renderBadge(<RunCostBadge usd={0.012} />);
    expect(screen.getByText("$0.012")).toBeInTheDocument();
    expect(screen.queryByText(/K→/)).not.toBeInTheDocument();
  });

  it("appends the token flow when both counts are given", () => {
    renderBadge(<RunCostBadge usd={0.014} tokensIn={8200} tokensOut={1300} size="lg" />);
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(screen.getByText("8.2K→1.3K")).toBeInTheDocument();
  });

  it("omits the token flow when only one count is known", () => {
    renderBadge(<RunCostBadge usd={0.014} tokensIn={8200} />);
    expect(screen.queryByText(/K→/)).not.toBeInTheDocument();
  });

  it("shows an em-dash for a run with no cost data", () => {
    renderBadge(<RunCostBadge usd={null} tokensIn={8200} tokensOut={1300} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
