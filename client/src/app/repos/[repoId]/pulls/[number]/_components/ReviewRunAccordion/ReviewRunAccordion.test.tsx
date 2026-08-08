/* Who owns the scroll when a run is targeted — the accordion header, or the
   finding's own card. Both paths land on the SAME `targetRunId` effect, and the
   only difference between them is whether the URL named a finding, so nothing
   but a test keeps them apart. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../../messages/en/common.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

/**
 * jsdom implements no `scrollIntoView`, so a test that wants to observe one has
 * to install it — and WHEN it is installed matters more than where.
 *
 * `FindingsPanel` scrolls a row that is already present SYNCHRONOUSLY inside its
 * effect (rAF never fires in a hidden tab, so the scroll cannot be deferred to a
 * frame), and React 19 flushes passive effects inside RTL's synchronous
 * `render()`. A per-element spy attached after `render()` returns is therefore
 * attached after the call it wants to see — the test would read
 * `called 0 times` and blame the component. That ordering is a test concern; it
 * must not push the product back onto a frame.
 *
 * So the spy goes on `Element.prototype` BEFORE render, and records which
 * element each call landed on. `afterEach` deletes it again, so no other test
 * file inherits a scrollable prototype.
 */
const scrollCalls: { el: Element; opts: unknown }[] = [];

/** Every scroll that landed on this element, in call order. */
const scrollsOn = (el: Element | null) => scrollCalls.filter((c) => c.el === el);

beforeEach(() => {
  scrollCalls.length = 0;
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: function (this: Element, opts?: unknown) {
      scrollCalls.push({ el: this, opts });
    },
  });
});

afterEach(() => {
  cleanup();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

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

const REVIEW = {
  id: "r1",
  run_id: "run1",
  agent_name: "Reviewer",
  verdict: "comment",
  summary: "Looks mostly fine.",
  score: 80,
  created_at: "2026-08-07T10:00:00.000Z",
  findings: [
    finding({}),
    finding({ id: "f3", severity: "SUGGESTION", title: "Extract for readability" }),
  ],
} as unknown as ReviewRecord;

function accordion(props: { targetRunId: string | null; focusFindingId: string | null }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ prReview, common }}>
      <ReviewRunAccordion
        review={REVIEW}
        prId="pr1"
        defaultOpen
        targetRunId={props.targetRunId}
        targetNonce={props.targetRunId ? 1 : 0}
        focusFindingId={props.focusFindingId}
      />
    </NextIntlClientProvider>
  );
}

/** Let any timer- or frame-driven work surface before asserting it did NOT
 *  happen — the card's own scroll is synchronous and needs none of this. */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 60)));

describe("ReviewRunAccordion — scroll ownership", () => {
  it("leaves the scroll to the finding's card when the URL named one of its findings", async () => {
    const view = render(accordion({ targetRunId: null, focusFindingId: "f3" }));
    const header = view.container.querySelector("#review-run-run1");
    const card = view.container.querySelector('[data-finding-id="f3"]');

    // Already scrolled by the time `render()` returns: the row was present on
    // the panel's first effect pass, so it did not wait for a frame — which is
    // exactly what makes a deep link work in a background tab.
    expect(scrollsOn(card)).toHaveLength(1);

    // `FindingsTab` resolves the owning run in its OWN effect, so `targetRunId`
    // arrives one commit after the panel below has already scrolled the card.
    view.rerender(accordion({ targetRunId: "run1", focusFindingId: "f3" }));
    await settle();

    expect(scrollsOn(card)).toHaveLength(1);
    // Scrolling the header here would land AFTER the card scroll and undo it —
    // which is the whole reason a deep-linked finding never came into view.
    expect(scrollsOn(header)).toHaveLength(0);
  });

  it("still scrolls its own header for the timeline's go-to-run click", async () => {
    const view = render(accordion({ targetRunId: null, focusFindingId: null }));
    const header = view.container.querySelector("#review-run-run1");
    await settle();

    view.rerender(accordion({ targetRunId: "run1", focusFindingId: null }));
    await settle();

    expect(scrollsOn(header).map((c) => c.opts)).toEqual([
      { behavior: "smooth", block: "start" },
    ]);
  });
});
