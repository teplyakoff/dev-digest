// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`
// (client/INSIGHTS.md, "Codebase Patterns").
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchCompare, EvalBatchRecord } from "@devdigest/shared";
import eval_ from "../../../../messages/en/eval.json";
import common from "../../../../messages/en/common.json";
import { RunCompare } from "./RunCompare";

/**
 * `common` carries two strings this modal needs: `actions.close` for the footer
 * and `runCost.tooltip` for the two `RunCostBadge`s in the cost card. A
 * provider holding only `eval` throws at render.
 *
 * The four delta tests below are FOUR TESTS, not one with four assertions. That
 * separation is the whole content of the 2026-08-27 spec amendment: AC-89 asked
 * for four deltas in a single criterion, and a run where only the cost delta
 * stopped rendering had nowhere to fail — the verdict "three of four" did not
 * exist. One criterion, one test, one place to go red.
 */
afterEach(cleanup);

const DASH = eval_.dashboard.unknownValue;

function batch(o: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    id: "b1",
    agent_id: "agent-1",
    agent_version: 3,
    system_prompt_snapshot: "You are a careful reviewer.",
    provider: "openrouter",
    model: "deepseek/deepseek-v4",
    status: "complete",
    cases_total: 8,
    cases_completed: 8,
    recall: 0.6,
    precision: 0.5,
    citation_accuracy: 0.9,
    cost_usd: 0.0012,
    partial: false,
    started_at: "2026-08-19T10:00:00.000Z",
    finished_at: "2026-08-19T10:04:00.000Z",
    ...o,
  };
}

function compare(o: Partial<EvalBatchCompare> = {}): EvalBatchCompare {
  return {
    a: batch({ id: "b-old" }),
    b: batch({
      id: "b-new",
      system_prompt_snapshot: "You are a careful and terse reviewer.",
      recall: 0.68,
      precision: 0.55,
      citation_accuracy: 0.95,
      cost_usd: 0.0019,
      started_at: "2026-08-20T10:00:00.000Z",
    }),
    deltas: { recall: 0.08, precision: 0.05, citation_accuracy: 0.05, cost_usd: 0.0007 },
    comparable: true,
    prompt_diff_available: true,
    ...o,
  };
}

function renderCompare(props: Partial<React.ComponentProps<typeof RunCompare>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ eval: eval_, common }}>
      <RunCompare compare={compare()} onClose={onClose} {...props} />
    </NextIntlClientProvider>,
  );
  return { ...view, onClose };
}

/** The delta card a label belongs to — label and values share one parent. */
function card(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

/**
 * The FOOTER's Close, found by its visible text.
 *
 * `getByRole("button", { name: "Close" })` is ambiguous here and that is not a
 * flaw in the component: the vendored `Modal` renders a ✕ `IconBtn` whose
 * `aria-label` is also "Close", so the dialog legitimately offers two controls
 * with one accessible name. Text is what tells them apart — the ✕ has none.
 */
const footerClose = () => screen.getByText(common.actions.close);

describe("RunCompare — the four deltas, one criterion each", () => {
  it("AC-107 — shows the recall delta", () => {
    renderCompare();
    const recall = card(eval_.dashboard.deltaRecall);
    expect(within(recall).getByText("60%")).toBeInTheDocument();
    expect(within(recall).getByText("68%")).toBeInTheDocument();
    expect(within(recall).getByText("▲ 8pt")).toBeInTheDocument();
  });

  it("AC-108 — shows the precision delta", () => {
    renderCompare();
    const precision = card(eval_.dashboard.deltaPrecision);
    expect(within(precision).getByText("50%")).toBeInTheDocument();
    expect(within(precision).getByText("55%")).toBeInTheDocument();
    expect(within(precision).getByText("▲ 5pt")).toBeInTheDocument();
  });

  it("AC-109 — shows the citation-accuracy delta", () => {
    renderCompare();
    const citation = card(eval_.dashboard.deltaCitation);
    expect(within(citation).getByText("90%")).toBeInTheDocument();
    expect(within(citation).getByText("95%")).toBeInTheDocument();
    expect(within(citation).getByText("▲ 5pt")).toBeInTheDocument();
  });

  it("AC-110 — shows the cost delta at sub-cent precision", () => {
    renderCompare();
    const cost = card(eval_.dashboard.deltaCost);
    // A real run costs ~$0.0013, so two decimals would render every cost move
    // as "$0.00" and the card would claim the prompt change was free.
    expect(within(cost).getByText("▲ $0.0007")).toBeInTheDocument();
    expect(within(cost).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("a delta of exactly zero is shown explicitly, arrow and all", () => {
    renderCompare({
      compare: compare({
        deltas: { recall: 0, precision: 0.05, citation_accuracy: 0.05, cost_usd: 0.0007 },
      }),
    });
    // A known zero is a result: the prompt change moved nothing. Hiding it would
    // make it indistinguishable from "there was no previous batch".
    expect(within(card(eval_.dashboard.deltaRecall)).getByText("▲ 0pt")).toBeInTheDocument();
  });

  it("an unknown delta hides the BADGE, not the card", () => {
    renderCompare({
      compare: compare({
        a: batch({ id: "b-old", recall: null }),
        deltas: { recall: null, precision: 0.05, citation_accuracy: 0.05, cost_usd: 0.0007 },
      }),
    });

    const recall = card(eval_.dashboard.deltaRecall);
    // The card keeps its label and both values — one of them an em dash — so
    // the reader can see WHY there is no delta rather than finding a gap.
    expect(within(recall).getByText(DASH)).toBeInTheDocument();
    expect(within(recall).getByText("68%")).toBeInTheDocument();
    expect(within(recall).queryByText(/▲|▼/)).not.toBeInTheDocument();
    // The other three are unaffected: the four criteria are independent.
    expect(within(card(eval_.dashboard.deltaPrecision)).getByText("▲ 5pt")).toBeInTheDocument();
  });
});

describe("RunCompare — the prompt diff has three states and no blank one", () => {
  it("AC-90 — identical snapshots say so instead of drawing an empty diff", () => {
    const snapshot = "You are a careful reviewer.";
    renderCompare({
      compare: compare({
        a: batch({ id: "b-old", system_prompt_snapshot: snapshot }),
        b: batch({ id: "b-new", system_prompt_snapshot: snapshot }),
      }),
    });

    expect(screen.getByText(eval_.dashboard.promptsIdentical)).toBeInTheDocument();
    // A word-level diff of two identical strings is correct and useless: a wall
    // of unchanged text that reads as "the diff is broken".
    expect(screen.queryByText(eval_.dashboard.legendOld)).not.toBeInTheDocument();
  });

  it("AC-91 — a missing snapshot is reported, not silently skipped", () => {
    renderCompare({
      compare: compare({
        a: batch({ id: "b-old", system_prompt_snapshot: null }),
        prompt_diff_available: false,
      }),
    });

    expect(screen.getByText(eval_.dashboard.noPromptSnapshot)).toBeInTheDocument();
    expect(screen.queryByText(eval_.dashboard.promptsIdentical)).not.toBeInTheDocument();
  });

  it("renders the changed words when there is something to diff", () => {
    renderCompare();
    // "and terse" is only in the new prompt, so it has to survive the diff into
    // the DOM as text — the whole panel renders tokens, never markup.
    expect(screen.getByText("terse")).toBeInTheDocument();
    expect(screen.getByText(eval_.dashboard.legendNew)).toBeInTheDocument();
  });
});

describe("RunCompare — comparability and what the footer refuses to offer", () => {
  it("AC-92 — flags two runs from different providers or models as not comparable", () => {
    renderCompare({ compare: compare({ comparable: false }) });
    expect(screen.getByText(eval_.dashboard.incomparable)).toBeInTheDocument();
    expect(screen.getByText(eval_.dashboard.incomparableHint)).toBeInTheDocument();
  });

  it("stays quiet about comparability when the server said the runs are comparable", () => {
    renderCompare();
    expect(screen.queryByText(eval_.dashboard.incomparable)).not.toBeInTheDocument();
  });

  it("AC-96 — carries no action that promotes an agent version", () => {
    renderCompare();
    // The design makes "Promote v7" the modal's PRIMARY footer button, so this
    // absence is a decision that a faithful port would quietly undo.
    expect(screen.queryByRole("button", { name: /promote/i })).not.toBeInTheDocument();
    // What the footer does have — otherwise "no promote button" would also pass
    // on a modal with no footer at all.
    expect(footerClose().tagName).toBe("BUTTON");
  });

  it("closes on the Close button and on Escape", () => {
    // The vendored `Modal` provides no escape path of its own and is frozen, so
    // the keyboard route is this component's own effect and nothing else pins it.
    const { onClose } = renderCompare();

    fireEvent.click(footerClose());
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("opens immediately with a loading line rather than an empty dialog", () => {
    // The modal mounts the moment the pair is picked, before the compare query
    // resolves. An empty dialog in that window reads as a failed comparison.
    renderCompare({ compare: null, isLoading: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(eval_.dashboard.loading)).toBeInTheDocument();
  });
});
