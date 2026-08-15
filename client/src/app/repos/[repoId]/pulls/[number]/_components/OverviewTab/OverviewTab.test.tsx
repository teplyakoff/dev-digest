// NOTE — `fireEvent`, not `userEvent`, and it is a constraint rather than a
// choice: `@testing-library/user-event` is not a dependency of this package and
// every existing test here uses `fireEvent`. Adding the package to satisfy the
// skill's preference would touch the lockfile for a one-click test.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentView } from "@devdigest/shared";
// EIGHT levels up from a route-local `_components/<Name>/` folder — the
// specifier is copied from a sibling rather than counted (client/INSIGHTS.md,
// "Codebase Patterns").
import prReview from "../../../../../../../../messages/en/prReview.json";
import common from "../../../../../../../../messages/en/common.json";
import blast from "../../../../../../../../messages/en/blast.json";

/**
 * THE GUARD THAT ACTUALLY MATTERS.
 *
 * `IntentCard.test.tsx` renders the card with a hand-passed prop, and would stay
 * green forever even if nothing in the app ever passed one — that is exactly how
 * `AgentCard`'s skill-count badge shipped green and invisible (client/INSIGHTS.md,
 * 2026-08-05). This asserts the card renders from MOCKED API DATA through the
 * view that owns the hooks, which is the only place the wiring is visible.
 *
 * Ported here from `FindingsTab.test.tsx` in L04, when the card moved to the tab
 * the spec always put it on. The move is the reason the test names the TAB and
 * not just the card: which tab owns the hooks is the thing that regressed.
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

const recalculate = vi.fn();

const BLAST_VIEW = {
  status: "full" as const,
  reason: null,
  changed_files: ["src/middleware/ratelimit.ts"],
  symbols: [
    {
      name: "rateLimit",
      file: "src/middleware/ratelimit.ts",
      kind: "function",
      callers: [{ file: "src/api/public/index.ts", symbol: "publicRouter", line: 23, rank: 0.9 }],
      callers_total: 1,
    },
  ],
  endpoints: [
    {
      route: "GET /api/public/items",
      file: "src/api/public/index.ts",
      depth: 1,
      via: "src/middleware/ratelimit.ts",
    },
  ],
  crons: [],
  indexed_sha: "abc1234def",
  counts: { symbols: 1, callers: 1, endpoints: 1 },
};

/** Mutable per-test query state. `vi.hoisted` because the `vi.mock` factory
 *  below is hoisted above every other statement in this file. */
const query = vi.hoisted(() => ({ loading: false }));

// No `QueryClientProvider` on purpose: with both hooks mocked, this tab renders
// nothing that touches React Query. If a real hook ever leaks through, the
// missing provider throws loudly instead of the test passing for a wrong reason.
//
// `data` follows `loading` rather than being set independently: React Query hands
// out `undefined` until the first response lands, and a fixture that served rows
// *and* claimed to be loading would test a state the real hook cannot produce.
vi.mock("@/lib/hooks/intent", () => ({
  usePullIntent: () => ({
    data: query.loading ? undefined : INTENT_VIEW,
    isLoading: query.loading,
  }),
  useRecalculateIntent: () => ({ mutate: recalculate, isPending: false }),
}));

// The Blast card is the tab's second half and fetches through React Query too.
// Mocked for the same reason as the intent hooks rather than wrapping this file
// in a provider: the missing provider IS the guard above, and keeping it means a
// real hook leaking in still throws instead of quietly passing.
// `BlastRadiusCard.test.tsx` is where the card's own states are covered.
vi.mock("@/lib/hooks/blast", () => ({
  usePrBlast: () => ({ data: BLAST_VIEW, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  recalculate.mockClear();
  query.loading = false;
});

const PR_BODY = "Rate limiting was requested after the incident on the 3rd.";

function renderTab(headSha = "sha-one") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, common, blast }}>
      <OverviewTab prId="pr1" prBody={PR_BODY} headSha={headSha} repoId="repo1" repoFullName="acme/api" />
    </NextIntlClientProvider>,
  );
}

describe("OverviewTab — the intent card", () => {
  it("renders the card from the API response, above the PR description", () => {
    renderTab();

    expect(screen.getByText(/per-IP rate limiter to the public API/i)).toBeInTheDocument();
    expect(screen.getByText(/wiki\.internal\/x was not fetched/i)).toBeInTheDocument();
    // The description is still here — the card was added to this tab, not
    // swapped in for what the tab already showed.
    expect(screen.getByText(PR_BODY)).toBeInTheDocument();

    // "Before everything else" is a position, so assert the position.
    const body = document.body.textContent ?? "";
    expect(body.indexOf("per-IP rate limiter")).toBeLessThan(body.indexOf(PR_BODY));
  });

  it("wires the re-derive button to the mutation the view owns", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /re-derive/i }));
    expect(recalculate).toHaveBeenCalledTimes(1);
  });

  // A PR with no description is the case that made this tab look broken before
  // L03 — Overview rendered `pr.body` and nothing else. The card is now what
  // the reviewer lands on, so it must not depend on the body being there.
  it("still shows the card on a PR opened with no description", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview, common, blast }}>
        <OverviewTab prId="pr1" prBody={null} headSha="sha-one" repoId="repo1" repoFullName="acme/api" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/per-IP rate limiter to the public API/i)).toBeInTheDocument();
  });

  /* THE REGRESSION GUARD FROM /pr-self-review (L04).
     `intent == null` was true for `undefined` too, so while the query was in
     flight the card rendered its NEVER-DERIVED state — on the DEFAULT tab, so on
     every PR page load, including PRs that already had an intent. The flash was
     not the problem; the live "Derive intent" button inside it was, because a
     click landing in that window spends a real classifier call. So the assertion
     that carries this test is the BUTTON COUNT, not the skeleton. */
  it("offers no action at all while the intent query is in flight", () => {
    query.loading = true;
    const { container } = renderTab();

    // The card is mounted — this is a loading state, not an absent card.
    expect(screen.getAllByText("Intent").length).toBeGreaterThan(0);
    // Neither the never-derived copy…
    expect(screen.queryByText(/has not been derived/i)).not.toBeInTheDocument();
    // …nor anything clickable. Naming "Derive intent" alone would let a future
    // rename slip a live button back in; zero buttons cannot.
    //
    // SCOPED TO THE INTENT CARD, and it did not used to be. This assertion ran
    // over the whole tab back when the tab was only this card; L04 put Blast
    // Radius beside it in the design's two-card brief, and that card has its own
    // controls that have nothing to do with whether a classifier call is one
    // click away. Counting them here would make an unrelated component able to
    // fail this test — and, worse, able to pass it by rendering nothing.
    const intentCard = container.querySelector("div")!.children[0] as HTMLElement;
    expect(within(intentCard).queryAllByRole("button")).toHaveLength(0);
  });

  // The other side of the same split: once the query settles, the card must come
  // back with its action. A loading branch that never exits looks identical to a
  // working one in the test above.
  it("restores the Re-derive action once the query settles", () => {
    renderTab(); // query.loading is false — reset in afterEach
    expect(screen.getByRole("button", { name: /re-derive/i })).toBeInTheDocument();
    // The never-derived path is pinned in `IntentCard.test.tsx`, which can hand
    // `intent={null}` directly; this view's fixture always has one.
  });

  // The head the card was derived against vs. the PR's head now. A mismatch is
  // the only signal a reviewer gets that they are reading intent for an older
  // revision of the diff in front of them.
  it("marks the intent stale when the PR head has moved past it", () => {
    // The literal string, not /stale/i: the badge reads "Derived against an
    // older commit" and never contains the word.
    const STALE = "Derived against an older commit";

    renderTab("sha-two");
    expect(screen.getByText(STALE)).toBeInTheDocument();
    cleanup();

    renderTab("sha-one");
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  });
});
