// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`
// (client/INSIGHTS.md, "Codebase Patterns"). Nothing in this file clicks
// anything, so neither is imported.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard } from "@devdigest/shared";
import eval_ from "../../../../messages/en/eval.json";
import { EvalMetricStrip } from "./EvalMetricStrip";

/**
 * THE ONE DEFECT SPEC-08 IS ORGANISED AGAINST: an unknown metric rendered as a
 * number. `0%` reads as a real, terrible score and `100%` as a perfect one, and
 * both are indistinguishable from a measurement — which is why every case below
 * asserts BOTH halves: the em dash is present AND the wrong number is absent.
 * Checking only for the dash would pass on a strip that renders "— 0%".
 *
 * `common` is not in the messages map because this component renders no
 * `RunCostBadge`; the two eval components that do carry it in theirs.
 */
afterEach(cleanup);

const DASH = eval_.dashboard.unknownValue;

function dashboard(o: Partial<EvalDashboard> = {}): EvalDashboard {
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
    latest_batch: null,
    delta: null,
    trend: [],
    recent_runs: [],
    alert: null,
    ...o,
  };
}

function renderStrip(props: React.ComponentProps<typeof EvalMetricStrip>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: eval_ }}>
      <EvalMetricStrip {...props} />
    </NextIntlClientProvider>,
  );
}

/** The tile a label belongs to — the label and its value share one parent. */
function tile(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

describe("EvalMetricStrip — the four tiles (AC-71)", () => {
  it("labels and fills all four metrics from the payload", () => {
    renderStrip({ dashboard: dashboard() });

    expect(within(tile("RECALL")).getByText("75%")).toBeInTheDocument();
    expect(within(tile("PRECISION")).getByText("50%")).toBeInTheDocument();
    expect(within(tile("CITATION ACCURACY")).getByText("100%")).toBeInTheDocument();
    // The fourth tile is a ratio out of the agent's real set, not a percentage:
    // "6/8" and "75%" are different claims and the design conflates them.
    expect(within(tile("CASES PASSED")).getByText("6/8")).toBeInTheDocument();
  });
});

describe("EvalMetricStrip — unknown is never a number", () => {
  it("AC-72 — with no batch at all, every tile shows the em dash and no 0%", () => {
    // `undefined` is the in-flight state and `null` the never-loaded one; both
    // mean "there is no number", and neither may invent one.
    renderStrip({ dashboard: null });

    expect(screen.getAllByText(DASH)).toHaveLength(4);
    // The half that carries the criterion. A `?? 0` anywhere in the formatter
    // chain leaves the dash count above at 0 and this line is what says so in
    // the criterion's own words.
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
  });

  it("AC-74 — an unknown recall shows the em dash, not 100%, while its siblings still render", () => {
    // The realistic shape: a set that is entirely `must_not_flag` has NOTHING
    // it expects to be found, so recall has no denominator (engine AC-10). The
    // tempting coercion is 100% — "it missed nothing" — and it is a lie about a
    // measurement that was never made.
    renderStrip({
      dashboard: dashboard({
        current: {
          recall: null,
          precision: 0.9,
          citation_accuracy: 0.8,
          traces_passed: 4,
          traces_total: 4,
          cost_usd: null,
          partial: false,
        },
      }),
    });

    expect(within(tile("RECALL")).getByText(DASH)).toBeInTheDocument();
    expect(within(tile("RECALL")).queryByText("100%")).not.toBeInTheDocument();
    expect(within(tile("RECALL")).queryByText("0%")).not.toBeInTheDocument();
    // Unknown is per-metric: one missing denominator must not blank the strip.
    expect(within(tile("PRECISION")).getByText("90%")).toBeInTheDocument();
    expect(within(tile("CASES PASSED")).getByText("4/4")).toBeInTheDocument();
  });

  it("a genuine zero is a measurement and renders as 0%", () => {
    // The mirror image, and the reason the two rules cannot be collapsed into
    // "never print 0%": an agent that found nothing it should have found scored
    // zero, and hiding that behind a dash is the opposite failure.
    renderStrip({
      dashboard: dashboard({
        current: {
          recall: 0,
          precision: 0,
          citation_accuracy: 0,
          traces_passed: 0,
          traces_total: 8,
          cost_usd: 0,
          partial: false,
        },
      }),
    });

    expect(within(tile("RECALL")).getByText("0%")).toBeInTheDocument();
    expect(within(tile("CASES PASSED")).getByText("0/8")).toBeInTheDocument();
    expect(screen.queryByText(DASH)).not.toBeInTheDocument();
  });
});

describe("EvalMetricStrip — delta badges", () => {
  it("AC-73 — no previous batch renders no delta badge at all", () => {
    renderStrip({ dashboard: dashboard({ delta: null }) });

    // The absence is on the BADGE, not the tile: the values are still shown.
    expect(screen.queryByText(/▲/)).not.toBeInTheDocument();
    expect(screen.queryByText(/▼/)).not.toBeInTheDocument();
    expect(screen.queryByText("▲ 0pt")).not.toBeInTheDocument();
    expect(within(tile("RECALL")).getByText("75%")).toBeInTheDocument();
  });

  it("a delta of exactly zero IS rendered — absence and 'moved by zero' differ", () => {
    renderStrip({
      dashboard: dashboard({ delta: { recall: 0, precision: 0.12, citation_accuracy: null } }),
    });

    expect(within(tile("RECALL")).getByText("▲ 0pt")).toBeInTheDocument();
    expect(within(tile("PRECISION")).getByText("▲ 12pt")).toBeInTheDocument();
    // …and one unknown field inside a present delta object still means no badge
    // on THAT tile. Three independent facts, three independent renders.
    expect(within(tile("CITATION ACCURACY")).queryByText(/▲|▼/)).not.toBeInTheDocument();
  });

  it("renders a negative delta with the down arrow and an absolute number", () => {
    renderStrip({
      dashboard: dashboard({ delta: { recall: -0.2, precision: null, citation_accuracy: null } }),
    });
    // `▼ -20pt` would be the sign written twice; the arrow carries it.
    expect(within(tile("RECALL")).getByText("▼ 20pt")).toBeInTheDocument();
  });
});

describe("EvalMetricStrip — the partial flag (AC-81)", () => {
  it("shows the partial badge beside the aggregates it qualifies", () => {
    renderStrip({
      dashboard: dashboard({ current: { ...dashboard().current, partial: true } }),
    });
    expect(screen.getByText(eval_.evalsTab.partial)).toBeInTheDocument();
  });

  it("says nothing when the batch covered the whole set", () => {
    // A permanently visible "partial" caption would be worse than none: it
    // stops meaning anything, and this strip has no way to dismiss it.
    renderStrip({ dashboard: dashboard() });
    expect(screen.queryByText(eval_.evalsTab.partial)).not.toBeInTheDocument();
  });
});
