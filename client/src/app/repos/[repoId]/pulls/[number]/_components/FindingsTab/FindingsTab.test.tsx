// NOTE — `fireEvent`, not `userEvent`, and it is a constraint rather than a
// choice: `@testing-library/user-event` is not a dependency of this package and
// every existing test here uses `fireEvent`.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import prReview from "../../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../../messages/en/common.json";
import runs from "../../../../../../../../messages/en/runs.json";
import { FindingsTab } from "./FindingsTab";

/**
 * This file used to be entirely about the intent card, which sat at the top of
 * this tab. In L04 the card moved to Overview, where the spec always put it, and
 * those assertions moved with it to `OverviewTab.test.tsx`.
 *
 * What is left here is the guard the move needs: the card is GONE from this tab,
 * and this tab no longer reaches for its data. Both halves matter — a component
 * rendered on two tabs looks correct on each one in isolation, and two live
 * `usePullIntent` subscriptions is the version of that mistake with no visible
 * symptom at all.
 *
 * `@/lib/hooks/intent` is deliberately NOT mocked. If this tab starts calling
 * those hooks again, the real module runs and the missing route data makes it
 * loud rather than silently double-fetching.
 */

afterEach(cleanup);

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

describe("FindingsTab", () => {
  it("opens on the review results, with no intent card of its own", () => {
    renderTab();

    // The tab's own content is there…
    expect(screen.getByText("Review runs")).toBeInTheDocument();
    // …and the intent card is not. Named by the two things only that card
    // renders — its "Intent" heading and its re-derive control — so a failure
    // says which half came back.
    expect(screen.queryByText("Intent")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /re-derive/i })).not.toBeInTheDocument();
  });
});
