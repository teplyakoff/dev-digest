import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("expands an already-mounted card when expandNonce is bumped, and never collapses it", () => {
    // `defaultExpanded` feeds `React.useState`, so it is INITIAL state only and
    // a later prop change does nothing — `expandNonce` is the escape hatch a
    // deep link from the Files tab depends on. A fresh element each time, or
    // React bails out of the rerender (client/INSIGHTS.md, 2026-08-03).
    const card = (expandNonce?: number) => (
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={FINDING} expandNonce={expandNonce} onAction={() => {}} />
      </NextIntlClientProvider>
    );

    const view = render(card());
    // Collapsed: the suggestion and the actions live in the body.
    expect(screen.queryByText("Move the key to an environment variable.")).not.toBeInTheDocument();

    view.rerender(card(1));
    expect(screen.getByText("Move the key to an environment variable.")).toBeInTheDocument();

    // Expand-only by design: a second bump must not close a card the reader is
    // reading. This is what a `setExpanded(e => !e)` implementation gets wrong.
    view.rerender(card(2));
    expect(screen.getByText("Move the key to an environment variable.")).toBeInTheDocument();
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});
