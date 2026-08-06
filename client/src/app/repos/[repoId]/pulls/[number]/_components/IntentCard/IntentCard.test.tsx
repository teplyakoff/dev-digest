// NOTE — `fireEvent`, not `userEvent`, and it is a constraint rather than a
// choice: `@testing-library/user-event` is not a dependency of this package and
// every existing test here uses `fireEvent`. Adding the package to satisfy the
// skill's preference would touch the lockfile for a two-click test.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import { IntentCard } from "./IntentCard";

/**
 * The card in isolation: the three states a user can land on, and the one line
 * this whole feature turns on.
 *
 * `IntentCard.test.tsx` alone cannot prove the card ever appears with real data
 * — that gap is what `FindingsTab.test.tsx` covers, from mocked API data through
 * the view.
 */

const INTENT: PrIntentRecord = {
  pr_id: "pr1",
  summary: "Adds a per-IP rate limiter to the public API endpoints.",
  in_scope: ["per-IP rate limiting", "limiter config"],
  out_of_scope: ["auth rework"],
  confidence: "medium",
  sources: [
    { kind: "pr_body", ref: "PR description", status: "used" },
    { kind: "linked_issue", ref: "#301", status: "used" },
    {
      kind: "link",
      ref: "https://wiki.internal/x",
      status: "unavailable",
      note: "external links are not fetched",
    },
  ],
  missing_context: ["the external link https://wiki.internal/x was not fetched"],
  head_sha: "sha-one",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash-0731",
  derived_at: "2026-08-06T10:00:00Z",
  tokens_in: 2168,
  tokens_out: 214,
  cost_usd: 0.000322,
};

afterEach(cleanup);

function renderCard(props: Partial<React.ComponentProps<typeof IntentCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview }}>
      <IntentCard intent={INTENT} headSha="sha-one" onDerive={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("shows the summary, both scope lists, and what could NOT be read", () => {
    renderCard();

    expect(screen.getByText(/per-IP rate limiter to the public API/i)).toBeInTheDocument();
    expect(screen.getByText("per-IP rate limiting")).toBeInTheDocument();
    expect(screen.getByText("auth rework")).toBeInTheDocument();

    // The requirement this card exists to satisfy: an unreachable link is shown
    // as unreachable, never silently replaced by invention. If this assertion is
    // ever deleted, the feature's most load-bearing guarantee goes with it.
    expect(screen.getByText(/wiki\.internal\/x was not fetched/i)).toBeInTheDocument();

    // Provenance names the model that derived it, suffix included.
    expect(screen.getByText(/deepseek\/deepseek-v4-flash-0731/)).toBeInTheDocument();
  });

  it("offers to derive when nothing has been derived yet", () => {
    const onDerive = vi.fn();
    renderCard({ intent: null, onDerive });

    expect(screen.getByText(/has not been derived/i)).toBeInTheDocument();
    expect(screen.queryByText(/per-IP rate limiting/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /derive intent/i }));
    expect(onDerive).toHaveBeenCalledTimes(1);
  });

  it("flags a derivation made against an older commit, and re-derives on click", () => {
    const onDerive = vi.fn();
    renderCard({ headSha: "sha-two", onDerive });

    expect(screen.getByText(/older commit/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /re-derive/i }));
    expect(onDerive).toHaveBeenCalledTimes(1);
  });

  it("badges a low-confidence derivation so a guess does not read as an answer", () => {
    renderCard({ intent: { ...INTENT, confidence: "low" } });
    expect(screen.getByText(/low confidence/i)).toBeInTheDocument();
  });
});
