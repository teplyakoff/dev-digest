// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`
// (client/INSIGHTS.md, "Codebase Patterns").
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchRecord } from "@devdigest/shared";
import eval_ from "../../../../messages/en/eval.json";
import common from "../../../../messages/en/common.json";
import { EvalRunsTable } from "./EvalRunsTable";

/**
 * `common` is not optional here: every row renders `RunCostBadge`, which calls
 * `useTranslations("common")` for its tooltip. A provider carrying only the
 * `eval` namespace throws at render, and the error names next-intl rather than
 * the badge (client/INSIGHTS.md, 2026-07-28 — the shared-namespace fan-out).
 */
afterEach(cleanup);

const DASH = eval_.dashboard.unknownValue;

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

function renderTable(batches: EvalBatchRecord[], onCompare = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ eval: eval_, common }}>
      <EvalRunsTable batches={batches} onCompare={onCompare} />
    </NextIntlClientProvider>,
  );
  return { ...view, onCompare };
}

/** Every row checkbox shares one accessible name, so they are read positionally. */
const checkboxes = () => screen.getAllByRole("checkbox");
const compareButton = () => screen.getByRole("button", { name: eval_.dashboard.compare });

describe("EvalRunsTable — selection and the compare gate", () => {
  it("renders one selectable row per batch, with Compare disabled until two are picked", () => {
    renderTable([batch(), batch({ id: "b2", started_at: "2026-08-19T10:00:00.000Z" })]);

    expect(checkboxes()).toHaveLength(2);
    // AC-87 is a gate on EXACTLY two, so all three counts are checked in one
    // flow: a `>= 2` implementation passes the "two" case on its own.
    expect(compareButton()).toBeDisabled();

    fireEvent.click(checkboxes()[0]!);
    expect(compareButton()).toBeDisabled();

    fireEvent.click(checkboxes()[1]!);
    expect(compareButton()).toBeEnabled();

    fireEvent.click(checkboxes()[0]!);
    expect(compareButton()).toBeDisabled();
  });

  it("AC-88 — two runs from different agents leave Compare disabled, and say why", () => {
    renderTable([
      batch({ id: "b1", agent_id: "agent-1" }),
      batch({ id: "b2", agent_id: "agent-2", started_at: "2026-08-19T10:00:00.000Z" }),
    ]);

    fireEvent.click(checkboxes()[0]!);
    fireEvent.click(checkboxes()[1]!);

    expect(compareButton()).toBeDisabled();
    // The hint is the difference between a disabled button and a broken one.
    expect(screen.getByText(eval_.dashboard.compareDifferentAgents)).toBeInTheDocument();
  });

  it("renders nothing at all for an empty batch list", () => {
    // The empty state belongs to the dashboard above, which knows whether the
    // agent has never run or the fetch simply has not landed. A table that drew
    // its own headers over zero rows would assert the first.
    const { container } = renderTable([]);
    expect(container).toBeEmptyDOMElement();
  });
});

/* ==========================================================================
   THE PAIR ORDER — the failure that looks like a result rather than an error.

   `onCompare` is always `(older, newer)` because the compare endpoint reports
   `b − a`. Hand it the pair backwards and every delta renders with its sign
   inverted: a prompt that improved recall by 8 points is displayed as an
   8-point regression. Nothing throws, nothing logs, and the screen looks
   exactly as convincing as a correct one.
   ========================================================================== */
describe("EvalRunsTable — the pair is always (older, newer)", () => {
  it("orders by started_at when the two timestamps differ", () => {
    const newer = batch({ id: "b-new", started_at: "2026-08-20T10:00:00.000Z" });
    const older = batch({ id: "b-old", started_at: "2026-08-19T10:00:00.000Z" });
    // Newest first — the order `GET /agents/:id/eval-batches` returns.
    const { onCompare } = renderTable([newer, older]);

    fireEvent.click(checkboxes()[0]!);
    fireEvent.click(checkboxes()[1]!);
    fireEvent.click(compareButton());

    expect(onCompare).toHaveBeenCalledWith(older, newer);
  });

  it("breaks an EXACT started_at tie with the list's own order, not the selection's", () => {
    // `eval_run_batches.started_at` defaults to transaction time, so two batches
    // genuinely can share one to the millisecond and Postgres guarantees no
    // order between them. The server's `id DESC` tiebreaker arrives as THIS
    // ARRAY'S ORDER and nothing else — a comparison of the two equal timestamps
    // has no information in it.
    //
    // This is the case the test above cannot catch: with distinct timestamps,
    // `<`, `<=` and "first selected is older" all produce the same answer. Here
    // they do not, and the wrong one silently inverts every delta.
    const at = "2026-08-20T10:00:00.000Z";
    const newer = batch({ id: "b-second", started_at: at });
    const older = batch({ id: "b-first", started_at: at });
    const { onCompare } = renderTable([newer, older]);

    fireEvent.click(checkboxes()[0]!);
    fireEvent.click(checkboxes()[1]!);
    fireEvent.click(compareButton());

    // The row LOWER in the table is the older one, because the list is newest
    // first. An implementation using `<=` on the tie returns (newer, older).
    expect(onCompare).toHaveBeenCalledWith(older, newer);
  });

  it("is insensitive to the order the rows were ticked in", () => {
    // Selection order is a user gesture, not data. Reading the pair off the
    // click sequence would make the same two runs compare differently depending
    // on which box was hit first.
    const at = "2026-08-20T10:00:00.000Z";
    const newer = batch({ id: "b-second", started_at: at });
    const older = batch({ id: "b-first", started_at: at });
    const { onCompare } = renderTable([newer, older]);

    fireEvent.click(checkboxes()[1]!);
    fireEvent.click(checkboxes()[0]!);
    fireEvent.click(compareButton());

    expect(onCompare).toHaveBeenCalledWith(older, newer);
  });
});

describe("EvalRunsTable — a row with unknown metrics keeps its row", () => {
  it("renders em dashes for the metrics and never 0%", () => {
    // A batch that errored on every case has no denominators. Dropping the row
    // would hide the run; printing `0%` would report a catastrophic score for a
    // measurement that never happened.
    renderTable([
      batch({ id: "b1", recall: null, precision: null, citation_accuracy: null, cost_usd: null }),
    ]);

    const row = screen.getAllByRole("row")[1] as HTMLElement;
    // Three metric dashes plus RunCostBadge's own for the unknown cost.
    expect(within(row).getAllByText(DASH)).toHaveLength(4);
    expect(within(row).queryByText("0%")).not.toBeInTheDocument();
    expect(within(row).queryByText("$0.00")).not.toBeInTheDocument();
  });
});

/* ==========================================================================
   NFR-12 (accessibility) — "select two runs and compare, with no mouse".

   WHAT THIS FILE CAN AND CANNOT PROVE, stated once so nobody reads the block
   below as more than it is.

   jsdom has no layout, no focus ring and — the part that matters here — **no
   sequential focus navigation**: `Tab` moves nothing, and `fireEvent.keyDown`
   carries no default action, so pressing Space on a focused checkbox does not
   toggle it the way a browser would. Neither does this package have
   `@testing-library/user-event` (client/INSIGHTS.md, 2026-08-06), whose
   `user.tab()` would at least model a tab ORDER.

   So the two tests below pin the three things that are genuinely observable
   and that the component actually decides:

     1. the controls are NATIVE elements (`<input type="checkbox">`, `<button>`)
        rather than the design's `<div>`s — which is what makes Tab reach them
        and Space/Enter activate them in a real browser;
     2. they are in the natural tab order (`tabIndex === 0`) and accept focus;
     3. the selection and the comparison can be driven end to end by activating
        those focused controls — no `onMouseDown`, no hover, no coordinates.

   What remains UNPROVEN here: that Tab actually visits them, in that order,
   and that the browser's own Space/Enter default action fires. That is a real
   browser's job — `e2e/specs/*.flow.json` — and it is recorded as such in the
   test report rather than implied by a green run.
   ========================================================================== */
describe("EvalRunsTable — NFR-12, the compare flow without a mouse", () => {
  const twoBatches = () => [
    batch({ id: "b-new", started_at: "2026-08-20T10:00:00.000Z" }),
    batch({ id: "b-old", started_at: "2026-08-19T10:00:00.000Z" }),
  ];

  it("exposes native, focusable controls in the natural tab order", () => {
    renderTable(twoBatches());

    // The design (`screen_skillslab_evaldashboard.jsx:461-477`) draws the row
    // control as a tinted `<div>`. That renders identically and is unreachable
    // by Tab, so the ELEMENT is the requirement, not an implementation detail:
    // `getAllByRole("checkbox")` alone would still pass for a `<div
    // role="checkbox">`, which has neither a tab stop nor a Space default.
    for (const box of checkboxes()) {
      expect(box.tagName).toBe("INPUT");
      expect(box).toHaveAttribute("type", "checkbox");
      expect(box).not.toBeDisabled();
      // 0 = the natural tab order. A `<div>` with no tabindex reports -1 here,
      // and so does anything someone opts out with `tabIndex={-1}`.
      expect(box.tabIndex).toBe(0);
      box.focus();
      expect(box).toHaveFocus();
    }

    // The action is only focusable once it is enabled — a disabled button is
    // skipped by Tab — so arm it first, then check the same three things.
    fireEvent.click(checkboxes()[0]!);
    fireEvent.click(checkboxes()[1]!);

    const button = compareButton();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toBeEnabled();
    expect(button.tabIndex).toBe(0);
    button.focus();
    expect(button).toHaveFocus();
  });

  it("selects two runs and compares them by activating focused controls only", () => {
    const [newer, older] = twoBatches();
    const { onCompare } = renderTable([newer!, older!]);

    // `fireEvent.click` on the element that HAS focus is exactly the event a
    // browser synthesises when Space is pressed on a focused checkbox and when
    // Enter is pressed on a focused button; jsdom will not produce it from
    // `keyDown` because it runs no default actions. Reading `activeElement`
    // rather than the handle is the part that makes this a keyboard flow: an
    // implementation that only responds to a pointer landing on the row would
    // not be reached this way.
    const first = checkboxes()[0]!;
    first.focus();
    fireEvent.click(document.activeElement!);
    expect(first).toBeChecked();

    // One selected is not enough (AC-87), so the action is still skipped by Tab.
    expect(compareButton()).toBeDisabled();
    fireEvent.click(compareButton());
    expect(onCompare).not.toHaveBeenCalled();

    const second = checkboxes()[1]!;
    second.focus();
    fireEvent.click(document.activeElement!);
    expect(second).toBeChecked();

    const button = compareButton();
    expect(button).toBeEnabled();
    button.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Enter", code: "Enter" });
    fireEvent.click(document.activeElement!);

    // The pair still arrives as (older, newer): reaching the control by
    // keyboard must not change WHAT it does.
    expect(onCompare).toHaveBeenCalledTimes(1);
    expect(onCompare).toHaveBeenCalledWith(older, newer);
  });
});
