import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// fireEvent, not user-event: this package does not depend on @testing-library/
// user-event and every existing test here uses fireEvent. Match the neighbours.
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const repos = vi.hoisted(() => ({
  current: {
    data: undefined as { id: string; full_name: string }[] | undefined,
    isLoading: true,
    isError: false,
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("@/lib/hooks", () => ({ useRepos: () => repos.current }));

// The shell and the page container pull in nav, breadcrumbs and keyboard
// shortcuts — none of which this view is about.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-shell", () => ({
  PageContainer: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import { HomeRedirectView } from "./HomeRedirectView";

describe("HomeRedirectView", () => {
  beforeEach(() => {
    nav.push.mockClear();
    nav.replace.mockClear();
    repos.current = { data: undefined, isLoading: true, isError: false };
  });

  afterEach(cleanup);

  it("does not navigate while the repo list is still loading", () => {
    render(<HomeRedirectView />);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("No repositories yet")).not.toBeInTheDocument();
  });

  // The whole point of the route: land on / and end up in the first repo's PR
  // list. `replace`, not `push`, so Back does not bounce the user right back.
  it("replaces the route with the first repo's PR list once repos arrive", () => {
    repos.current = {
      data: [
        { id: "r1", full_name: "acme/api" },
        { id: "r2", full_name: "acme/web" },
      ],
      isLoading: false,
      isError: false,
    };
    render(<HomeRedirectView />);
    expect(nav.replace).toHaveBeenCalledWith("/repos/r1/pulls");
  });

  it("offers onboarding instead of redirecting when there are no repos", () => {
    repos.current = { data: [], isLoading: false, isError: false };
    render(<HomeRedirectView />);

    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.getByText("No repositories yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add repository/i }));
    expect(nav.push).toHaveBeenCalledWith("/onboarding");
  });

  // A failed repo list must not strand the user on a blank root route — the
  // empty state doubles as the error state here.
  it("falls back to the same empty state when the repo list fails", () => {
    repos.current = { data: undefined, isLoading: false, isError: true };
    render(<HomeRedirectView />);
    expect(screen.getByText("No repositories yet")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
