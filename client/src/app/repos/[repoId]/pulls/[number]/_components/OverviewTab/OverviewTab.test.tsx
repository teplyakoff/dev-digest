// NOTE — `fireEvent`, not `userEvent`, and it is a constraint rather than a
// choice: `@testing-library/user-event` is not a dependency of this package and
// every existing test here uses `fireEvent`. Adding the package to satisfy the
// skill's preference would touch the lockfile for a one-click test.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefView, PrIntentView } from "@devdigest/shared";
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

const BRIEF_VIEW: PrBriefView = {
  brief: {
    pr_id: "pr1",
    what: "Adds a per-IP rate limiter in front of the public API routes.",
    why: "The public API was knocked over by a scraper on the 3rd.",
    risk_level: "high",
    risks: [
      {
        kind: "availability",
        title: "Limiter shares one in-process counter",
        explanation: "Two API instances would each allow the full quota.",
        severity: "high",
        file_refs: ["src/middleware/ratelimit.ts"],
      },
    ],
    review_focus: [
      { path: "src/middleware/ratelimit.ts", reason: "the whole limiter lives here" },
      { path: "src/api/public/index.ts", reason: "where it is mounted" },
    ],
    risks_grounded: true,
    dropped_blocks: ["context-docs:ARCHITECTURE.md"],
    unavailable_inputs: [],
    head_sha: "sha-one",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash-0731",
    derived_at: "2026-08-20T09:15:00Z",
    tokens_in: 6120,
    tokens_out: 480,
    cost_usd: 0.0021,
    attempts: 1,
  },
  stale: false,
  reused: true,
  model_calls: 0,
};

/** The server's answer for a PR whose brief was never built: a 200 carrying a
 *  null, not a 404 (server AC-67). It is what makes the empty state and the
 *  error state distinguishable at all. */
const EMPTY_BRIEF_VIEW: PrBriefView = { brief: null, stale: false, reused: false, model_calls: 0 };

const rebuild = vi.fn();
const openFile = vi.fn();

/** Mutable per-test query state. `vi.hoisted` because the `vi.mock` factory
 *  below is hoisted above every other statement in this file. */
const query = vi.hoisted(() => ({
  loading: false,
  /** The BRIEF query's own states — separate from the intent's, because the two
   *  fail independently and the tab has to show that. */
  briefError: false,
  briefEmpty: false,
  rebuilding: false,
}));

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

// The brief's two hooks, mocked for the same reason as the intent's: this file
// is about whether THE TAB feeds the card, so the transport underneath is
// replaced and the card is rendered for real.
vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: () => ({
    data: query.briefError ? undefined : query.briefEmpty ? EMPTY_BRIEF_VIEW : BRIEF_VIEW,
    isLoading: false,
    isError: query.briefError,
    refetch: vi.fn(),
  }),
  useRebuildBrief: () => ({ mutate: rebuild, isPending: query.rebuilding }),
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
  rebuild.mockClear();
  openFile.mockClear();
  query.loading = false;
  query.briefError = false;
  query.briefEmpty = false;
  query.rebuilding = false;
});

const PR_BODY = "Rate limiting was requested after the incident on the 3rd.";

function renderTab(headSha = "sha-one") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, common, blast }}>
      <OverviewTab
        prId="pr1"
        prBody={PR_BODY}
        headSha={headSha}
        repoId="repo1"
        repoFullName="acme/api"
        onOpenFile={openFile}
      />
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
        <OverviewTab
          prId="pr1"
          prBody={null}
          headSha="sha-one"
          repoId="repo1"
          repoFullName="acme/api"
          onOpenFile={openFile}
        />
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
    //
    // RE-PINNED, not widened, when the brief card landed above the pair (AC-36):
    // the tab's top-level children are now [brief card, intent/blast grid,
    // description], so the intent card is the GRID's first child. The old
    // locator — "the first div's first child" — silently started pointing at the
    // brief card's header, whose rebuild button has nothing to do with whether a
    // classifier call is one click away.
    const pair = container.children[1] as HTMLElement;
    const intentCard = pair.children[0] as HTMLElement;
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

/* THE BRIEF CARD, AT THE LEVEL WHERE THE WIRING IS VISIBLE.

   `PrBriefCard.test.tsx` hands the card its props by hand, so it can never fail
   because nothing passes them — the exact shape that let `AgentCard`'s
   skill-count badge ship green and invisible for a whole lesson
   (client/INSIGHTS.md, 2026-08-05). These tests render the card through the tab
   that owns `usePrBrief` / `useRebuildBrief`, from MOCKED API DATA. */
describe("OverviewTab — the PR brief card", () => {
  // AC-36. Position is the requirement, so position is what is asserted: the
  // brief's text comes before the intent card's, which is the first thing in
  // the pair below it.
  it("renders the brief card from the API response, above the intent/blast pair", () => {
    renderTab();

    expect(screen.getByText(/per-IP rate limiter in front of the public API/i)).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();
    // The dropped-block line proves the WHOLE response is reaching the card, not
    // just the two obvious fields.
    expect(screen.getByText(/context-docs:ARCHITECTURE\.md/)).toBeInTheDocument();

    const body = document.body.textContent ?? "";
    expect(body.indexOf("per-IP rate limiter in front of")).toBeLessThan(
      body.indexOf("per-IP rate limiter to the public API"),
    );
  });

  // AC-42, THE MIDDLE LINK. The card's own test proves it calls its callback;
  // `PrDetailView.test.tsx` proves what the URL becomes. This is the link
  // between them — that the tab hands its `onOpenFile` down to the card at all.
  // Without it, both ends can be green while the click goes nowhere.
  it("passes a review-focus activation up to the page as a file path", () => {
    renderTab();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open src/api/public/index.ts in the changes tab",
      }),
    );
    expect(openFile.mock.calls).toEqual([["src/api/public/index.ts"]]);
  });

  it("wires the rebuild button to the mutation the view owns", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild brief" }));
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  // AC-52. A rebuild is a PAID call, so a second click while the first is in
  // flight buys a second model call for the same answer. `disabled` is asserted
  // on the element rather than "the click did nothing", because a button that
  // silently swallows clicks looks broken.
  it("holds the rebuild button unavailable while a rebuild is in flight", () => {
    query.rebuilding = true;
    renderTab();

    const button = screen.getByRole("button", { name: "Rebuild brief" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(rebuild).not.toHaveBeenCalled();
  });

  // AC-54. "The request failed" and "no brief has ever been built" are opposite
  // situations, and the second one offers a button that spends money — so a
  // failure must not render as the empty state.
  it("shows a failed brief request as a state distinct from the empty one", () => {
    query.briefError = true;
    renderTab();

    expect(screen.getByText(/Couldn't load the brief/i)).toBeInTheDocument();
    expect(screen.queryByText(/No brief has been built/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Build brief" })).not.toBeInTheDocument();
  });

  it("shows the call to build when the server says there is no brief yet", () => {
    query.briefEmpty = true;
    renderTab();

    expect(screen.getByText(/No brief has been built/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build brief" })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load the brief/i)).not.toBeInTheDocument();
  });

  /* AC-55. A rebuild that fails must leave the brief the reviewer was reading on
     screen. The mechanism is that the mutation writes the cache in `onSuccess`
     and nowhere else, so a failure changes no query data — and the guard that
     matters here is that the TAB does not compensate by folding the mutation's
     error into the card's `error` prop, which would blank a perfectly good
     brief every time a rebuild failed. */
  it("keeps the previous brief on screen when a rebuild fails", () => {
    renderTab();
    // The rebuild rejects: `mutate` is called with an `onError` callback, and
    // this fires it the way React Query would.
    fireEvent.click(screen.getByRole("button", { name: "Rebuild brief" }));
    const [firstCall] = rebuild.mock.calls;
    const options = firstCall?.[1] as { onError?: (e: unknown) => void } | undefined;
    options?.onError?.(new Error("provider refused the request"));

    expect(screen.getByText(/per-IP rate limiter in front of the public API/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load the brief/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No brief has been built/i)).not.toBeInTheDocument();
  });
  /* NFR-7, and the reason it is asserted HERE rather than on either card: the
     two regeneration controls only stand next to each other on this tab. This
     page has already shipped two controls with one accessible name once — the
     Smart Diff findings badge and a line's severity tag both read "Open
     finding: …" (client/INSIGHTS.md, 2026-08-10) — and a screen-reader user
     given two identically named buttons cannot tell a $0 action from a paid
     one. */
  it("gives the two regeneration buttons on this tab different accessible names", () => {
    renderTab();

    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim())
      .filter((n): n is string => Boolean(n));

    expect(names).toContain("Rebuild brief");
    expect(names).toContain("Re-derive");
    expect(new Set(names).size).toBe(names.length);
  });
});
