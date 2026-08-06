// NOTE — `fireEvent`, not `userEvent`, and it is a constraint rather than a
// choice: `@testing-library/user-event` is not a dependency of this package and
// every existing test here uses `fireEvent`. Adding the package to satisfy the
// skill's preference would touch the lockfile for a two-click test.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentView } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../../messages/en/common.json";
import runs from "../../../../../../../../messages/en/runs.json";

/**
 * THE GUARD THAT ACTUALLY MATTERS.
 *
 * `IntentCard.test.tsx` renders the card with a hand-passed prop, and would stay
 * green forever even if nothing in the app ever passed one — that is exactly how
 * `AgentCard`'s skill-count badge shipped green and invisible. This asserts the
 * card renders from MOCKED API DATA through the view that owns the hooks, which
 * is the only place the wiring is visible.
 */

const INTENT_VIEW: PrIntentView = {
  intent: {
    pr_id: "pr1",
    summary: "Adds a per-IP rate limiter to the public API endpoints.",
    in_scope: ["per-IP rate limiting"],
    out_of_scope: ["auth rework"],
    confidence: "medium",
    sources: [{ kind: "pr_body", ref: "PR description", status: "used" }],
    missing_context: ["the external link https://wiki.internal/x was not fetched"],
    head_sha: "sha-one",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash-0731",
    derived_at: "2026-08-06T10:00:00Z",
    tokens_in: 2168,
    tokens_out: 214,
    cost_usd: 0.000322,
  },
};

const derive = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: () => ({ data: INTENT_VIEW, isLoading: false }),
  useDeriveIntent: () => ({ mutate: derive, isPending: false }),
}));

import { FindingsTab } from "./FindingsTab";

afterEach(() => {
  cleanup();
  derive.mockClear();
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview, common, runs }}>
        <FindingsTab
          prId="pr1"
          liveRunIds={[]}
          reviewRunning={false}
          lethalTrifecta={[]}
          runs={[]}
          prRuns={[]}
          prCommits={[]}
          cancelMutation={{ mutate: vi.fn(), isPending: false } as never}
          repoFullName="acme/payments-api"
          headSha="sha-one"
          onOpenTrace={vi.fn()}
          onDelete={vi.fn()}
          onRunDone={vi.fn()}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("FindingsTab — the intent card", () => {
  it("renders the card from the API response, above the review results", () => {
    renderTab();

    expect(screen.getByText(/per-IP rate limiter to the public API/i)).toBeInTheDocument();
    expect(screen.getByText(/wiki\.internal\/x was not fetched/i)).toBeInTheDocument();

    // "Before the review results" is a position, so assert the position: the
    // card's summary precedes the Review runs section in document order.
    const body = document.body.textContent ?? "";
    expect(body.indexOf("per-IP rate limiter")).toBeLessThan(body.indexOf("Review runs"));
  });

  it("wires the re-derive button to the mutation the view owns", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /re-derive/i }));
    expect(derive).toHaveBeenCalledTimes(1);
  });
});
