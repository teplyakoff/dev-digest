import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

/** A fresh element every time: React bails out of `rerender` when handed the
 *  same reference, and the bail-out reads exactly like a component bug
 *  (client/INSIGHTS.md, 2026-08-03). */
const mixedPanel = (focusFindingId?: string) => (
  <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
    <FindingsPanel findings={MIXED} prId="pr1" focusFindingId={focusFindingId} />
  </NextIntlClientProvider>
);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How late the deep-linked row is made to appear. Real wall clock on purpose:
 *  the point of the fix is that no frame count can predict this number, and 600
 *  ms is both well past the ~330 ms the old 20-frame budget allowed and the same
 *  order as the 791 ms measured in the browser. The suite pays 0.6 s for it. */
const LATE_ROW_MS = 600;

/** Long enough for a scroll to surface if one were coming (one frame + slack). */
const FLUSH_MS = 50;

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

  it("un-filters and expands a deep-linked finding whose severity chip is off", () => {
    // The target is deliberately NOT the first card: `defaultExpanded={i === 0}`
    // would explain an expanded first card on its own, so only a finding further
    // down proves `expandNonce` fired — and its rationale is unique so the
    // expansion is observable.
    const findings = [
      finding({}),
      finding({ id: "f2", severity: "WARNING", title: "429 without Retry-After" }),
      finding({
        id: "f3",
        severity: "SUGGESTION",
        title: "Extract for readability",
        rationale: "The handler is 200 lines long.",
      }),
    ];
    // A fresh element every time: React bails out of `rerender` when handed the
    // same reference, and the bail-out reads exactly like a component bug
    // (client/INSIGHTS.md, 2026-08-03).
    const panel = (focusFindingId?: string) => (
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={findings} prId="pr1" focusFindingId={focusFindingId} />
      </NextIntlClientProvider>
    );

    const view = render(panel());
    fireEvent.click(screen.getByRole("button", { name: /Suggestion/ }));
    expect(screen.queryByText("Extract for readability")).not.toBeInTheDocument();

    // ?finding=f3 arrives from a Smart Diff click while the chip is still off.
    view.rerender(panel("f3"));

    // The panel drops its own filter rather than landing the reader on a list
    // that does not contain the finding they clicked…
    expect(screen.getByText("Extract for readability")).toBeInTheDocument();
    // …and the card is opened, which only the nonce can do at index 2.
    expect(screen.getByText("The handler is 200 lines long.")).toBeInTheDocument();
  });

  it("scrolls to a deep-linked row that only appears long after the first look", async () => {
    // The bug this pins, measured in the live app rather than guessed: the
    // deep-linked card first enters the DOM 791 ms after the click (~47 frames),
    // and the panel's 20-frame budget expired at ~330 ms — `scrollIntoView` was
    // never called once. So the wait is watched, not counted, and this test
    // makes the row appear WELL past any plausible frame budget.
    const view = render(mixedPanel());
    const card = view.container.querySelector('[data-finding-id="f3"]')!;
    const list = card.parentElement!;
    // jsdom implements no scrollIntoView, so the element carries the spy — no
    // prototype polyfill, and no other test inherits one.
    const scrollIntoView = vi.fn();
    Object.assign(card, { scrollIntoView });

    // The row is not in the panel's subtree when `?finding=f3` lands. Detaching
    // the node is the honest stand-in: `[data-finding-id]` inside `rootRef` is
    // the panel's only handle on the row, so "not yet rendered" and "not in this
    // subtree" are the same thing to it.
    card.remove();
    view.rerender(mixedPanel("f3"));
    expect(scrollIntoView).not.toHaveBeenCalled();

    // 600 ms of real time — twice the old ~330 ms budget, the same order as the
    // 791 ms measured in the browser. The panel must still be waiting.
    await sleep(LATE_ROW_MS);
    expect(scrollIntoView).not.toHaveBeenCalled();

    // The row lands. Nothing re-runs the effect here: only the observer on
    // `rootRef` can notice this.
    list.appendChild(card);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });

    // Handled now: toggling a chip while `?finding=` is still in the URL must
    // not scroll the reader back a second time.
    fireEvent.click(screen.getByRole("button", { name: /Warning/ }));
    await sleep(FLUSH_MS);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a miss — a later pass still scrolls to the row", async () => {
    // `handledRef` must be set only where the row was genuinely found. If a miss
    // latched it, the panel would go quiet for that finding forever, and
    // `el?.scrollIntoView?.()` would leave no symptom behind.
    const view = render(mixedPanel());
    const card = view.container.querySelector('[data-finding-id="f3"]')!;
    const list = card.parentElement!;
    const scrollIntoView = vi.fn();
    Object.assign(card, { scrollIntoView });

    card.remove();
    view.rerender(mixedPanel("f3"));
    expect(scrollIntoView).not.toHaveBeenCalled();

    // A chip toggle re-runs the effect, tearing down the observer the missed
    // pass armed. Only a panel that did NOT mark f3 handled arms a new one.
    fireEvent.click(screen.getByRole("button", { name: /Warning/ }));
    list.appendChild(card);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
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
