import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { PrDetail } from "@devdigest/shared";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const state = vi.hoisted(() => ({
  search: "",
  pullsLoading: false,
  detailLoading: false,
  detailError: false,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1", number: "42" }),
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => nav,
}));

const PR = {
  id: "pr-1",
  number: 42,
  title: "Add the thing",
  author: "octocat",
  branch: "feat/thing",
  base: "main",
  head_sha: "abc123",
  additions: 10,
  deletions: 2,
  files_count: 1,
  status: "open",
  opened_at: null,
  updated_at: null,
  body: "why the thing",
  files: [],
  commits: [],
} as PrDetail;

vi.mock("@/lib/hooks", () => ({
  usePulls: () => ({
    data: [{ id: "pr-1", number: 42 }],
    isLoading: state.pullsLoading,
  }),
  usePullDetail: () => ({
    data: state.detailError ? undefined : PR,
    isLoading: state.detailLoading,
    isError: state.detailError,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [], refetch: vi.fn() }),
  usePrActiveRuns: () => ({ data: [] }),
  usePrRuns: () => ({ data: [] }),
  useDeleteRun: () => ({ mutate: vi.fn() }),
  useCancelRun: () => ({ mutate: vi.fn() }),
  useInvalidatePrRuns: () => ({ active: vi.fn(), history: vi.fn() }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/api" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));

// The tab bodies are their own components with their own tests. Stubbing them
// keeps this test about what PrDetailView actually owns: which tab is showing,
// and what a tab change does to the URL.
vi.mock("../PrDetailHeader", () => ({
  PrDetailHeader: ({ onSetTab }: { onSetTab: (t: string) => void }) => (
    <button onClick={() => onSetTab("findings")}>go to findings</button>
  ),
}));
vi.mock("../OverviewTab", () => ({ OverviewTab: () => <div>overview tab</div> }));
vi.mock("../FindingsTab", () => ({ FindingsTab: () => <div>findings tab</div> }));
vi.mock("../DiffTab", () => ({ DiffTab: () => <div>diff tab</div> }));
vi.mock("../RunTraceDrawer", () => ({
  default: ({ runId }: { runId: string }) => <div>trace drawer {runId}</div>,
}));

import { PrDetailView } from "./PrDetailView";

describe("PrDetailView", () => {
  beforeEach(() => {
    nav.replace.mockClear();
    state.search = "";
    state.pullsLoading = false;
    state.detailLoading = false;
    state.detailError = false;
  });

  afterEach(cleanup);

  it("shows overview by default, because the route carries no tab", () => {
    render(<PrDetailView />);
    expect(screen.getByText("overview tab")).toBeInTheDocument();
    expect(screen.queryByText("findings tab")).not.toBeInTheDocument();
  });

  // Tab state lives in the query string, so a tab change is a URL change — that
  // is what makes a tab deep-linkable and survivable across a reload.
  it("writes the tab into the query string instead of local state", () => {
    render(<PrDetailView />);
    fireEvent.click(screen.getByRole("button", { name: /go to findings/i }));
    expect(nav.replace).toHaveBeenCalledWith("/repos/r1/pulls/42?tab=findings");
  });

  it("renders the tab named by the URL", () => {
    state.search = "tab=findings";
    render(<PrDetailView />);
    expect(screen.getByText("findings tab")).toBeInTheDocument();
  });

  // `?trace=<runId>` opens the drawer directly — the deep link INSIGHTS.md
  // recommends over hunting for the per-row icon in the timeline.
  it("opens the trace drawer straight from the URL", () => {
    state.search = "tab=findings&trace=run-9";
    render(<PrDetailView />);
    expect(screen.getByText(/trace drawer run-9/)).toBeInTheDocument();
  });

  it("shows a skeleton, not a broken page, while the PR is loading", () => {
    state.pullsLoading = true;
    render(<PrDetailView />);
    expect(screen.queryByText("overview tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /go to findings/i })).not.toBeInTheDocument();
  });

  it("shows the error state when the PR cannot be loaded", () => {
    state.detailError = true;
    render(<PrDetailView />);
    expect(screen.getByText("Couldn't load this pull request")).toBeInTheDocument();
  });
});
