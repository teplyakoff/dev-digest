import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";
import { s } from "./styles";

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

  /* A STRUCTURAL GUARD FOR A HAZARD THIS ENVIRONMENT CANNOT OBSERVE.
     `s.card` once set the `borderColor` SHORTHAND next to the `borderLeftColor`
     longhand — the pair React warns about on every rerender ("…can lead to
     styling bugs"), and the warning was in this suite's own output. jsdom does
     not model the collision and no misrender was ever observed from it, so a
     rendered-colour assertion would pass either way and prove nothing. What CAN
     be asserted is the shape of the style object: the four sides are named
     individually and the shorthand never comes back. */
  it("never mixes the borderColor shorthand into the card's style", () => {
    for (const focused of [true, false]) {
      const style = s.card(focused, "var(--crit)", false);
      expect(style).not.toHaveProperty("borderColor");
      expect(style).not.toHaveProperty("border");
      // …and the focus signal is still actually carried, on the three sides the
      // severity rail does not own.
      const expected = focused ? "var(--crit)" : "var(--border)";
      expect(style.borderTopColor).toBe(expected);
      expect(style.borderRightColor).toBe(expected);
      expect(style.borderBottomColor).toBe(expected);
      // The left rail is the severity colour whether focused or not.
      expect(style.borderLeftColor).toBe("var(--crit)");
    }
  });
});

/* ==========================================================================
   SPEC-08 — the one-click "turn into eval case" action (AC-62…AC-64, AC-68).

   Everything here arrives as a prop: the card stays presentational and
   `FindingsPanel` owns the mutation. The tooltip is the interesting part —
   there are THREE of them and each names the case the click would actually
   create, so a card that offered "must find" on a dismissal would be promising
   the opposite of what the server derives from the same two timestamps.
   ========================================================================== */

const ACCEPTED: FindingRecord = { ...FINDING, accepted_at: "2026-08-20T10:00:00.000Z" };
const DISMISSED: FindingRecord = { ...FINDING, dismissed_at: "2026-08-20T10:00:00.000Z" };

/** The action, found by its visible label. */
const evalAction = () =>
  screen.getByRole("button", { name: messages.finding.createEvalCase });

describe("FindingCard — the eval-case action", () => {
  it("AC-62 — offers the action on an ACCEPTED finding, tooltipped 'must find'", () => {
    const onCreateEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard f={ACCEPTED} defaultExpanded onCreateEvalCase={onCreateEvalCase} />,
    );

    expect(evalAction()).toBeEnabled();
    expect(evalAction()).toHaveAttribute("title", messages.finding.createEvalCaseMustFind);

    fireEvent.click(evalAction());
    expect(onCreateEvalCase).toHaveBeenCalledTimes(1);
  });

  it("AC-62 — offers the action on a DISMISSED finding, tooltipped 'must NOT comment'", () => {
    // The direction is read off the decision, never defaulted: a case seeded
    // from a dismissal asserts the opposite of one seeded from an acceptance,
    // and the tooltip is where the reader finds out which they are about to
    // create.
    renderWithIntl(<FindingCard f={DISMISSED} defaultExpanded onCreateEvalCase={vi.fn()} />);

    expect(evalAction()).toBeEnabled();
    expect(evalAction()).toHaveAttribute("title", messages.finding.createEvalCaseMustNotFlag);
  });

  it("AC-63 / AC-64 — an undecided finding gets the action DISABLED, and told why", () => {
    // There is no status column: "decided" is derived from two timestamps, and
    // a finding with neither is open. Seeding from it would pin an expectation
    // nobody agreed to, so it is disabled rather than defaulted to `must_find`.
    const onCreateEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded onCreateEvalCase={onCreateEvalCase} />,
    );

    expect(evalAction()).toBeDisabled();
    // AC-64 — a disabled control with no explanation reads as a broken one.
    expect(evalAction()).toHaveAttribute("title", messages.finding.createEvalCaseDisabled);

    fireEvent.click(evalAction());
    expect(onCreateEvalCase).not.toHaveBeenCalled();
  });

  it("disables the action while THIS finding's case is in flight", () => {
    // The disabled state is what prevents a second click; there is no
    // deduplication on the request side.
    renderWithIntl(
      <FindingCard f={ACCEPTED} defaultExpanded creatingEvalCase onCreateEvalCase={vi.fn()} />,
    );
    expect(evalAction()).toBeDisabled();
  });

  it("AC-68 — links to the case just created and to one that already existed", () => {
    renderWithIntl(
      <FindingCard
        f={ACCEPTED}
        defaultExpanded
        evalCaseHref="/agents/agent-7?tab=evals&case=case-new"
        existingEvalCaseHref="/agents/agent-7?tab=evals&case=case-old"
      />,
    );

    // The card keeps its own copy of both links, because the toast that first
    // carried them dismisses itself after four seconds and the reader who
    // looked away loses them.
    expect(screen.getByRole("link", { name: messages.finding.editEvalCase })).toHaveAttribute(
      "href",
      "/agents/agent-7?tab=evals&case=case-new",
    );
    expect(screen.getByRole("link", { name: messages.finding.viewEvalCase })).toHaveAttribute(
      "href",
      "/agents/agent-7?tab=evals&case=case-old",
    );
  });

  it("shows no case links before anything has been created", () => {
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded />);
    expect(
      screen.queryByRole("link", { name: messages.finding.editEvalCase }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: messages.finding.viewEvalCase }),
    ).not.toBeInTheDocument();
  });
});
