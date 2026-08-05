import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// fireEvent, not user-event: this package does not depend on @testing-library/
// user-event and every existing test here uses fireEvent. Match the neighbours.
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RootErrorView } from "./RootErrorView";
import common from "../../../../messages/en/common.json";

const pathname = vi.hoisted(() => ({ current: "/repos/r1/pulls" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

// The shell pulls in nav, breadcrumbs and keyboard shortcuts — none of which
// this component is about.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function renderView(reset = vi.fn(), error = new Error("Cannot read properties of undefined")) {
  // A FRESH element each time, deliberately: re-rendering the same element
  // reference lets React bail out before the component body runs, and the
  // navigation the test is trying to simulate never happens.
  const ui = () => (
    <NextIntlClientProvider locale="en" messages={{ common }}>
      <RootErrorView error={error} reset={reset} />
    </NextIntlClientProvider>
  );
  const view = render(ui());
  // `usePathname` reads the hoisted ref above, so mutating it and re-rendering
  // is exactly what a navigation looks like to this component.
  return { reset, rerender: () => view.rerender(ui()) };
}

describe("RootErrorView", () => {
  beforeEach(() => {
    pathname.current = "/repos/r1/pulls";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(cleanup);

  it("shows the error message so a render failure is diagnosable, not just blank", () => {
    renderView();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Cannot read properties of undefined")).toBeInTheDocument();
  });

  it("retry calls reset, so the user can re-attempt without a full reload", () => {
    const { reset } = renderView();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("does not reset while the route is unchanged", () => {
    const { reset } = renderView();
    expect(reset).not.toHaveBeenCalled();
  });

  // The branch this covers is the reason the component holds a ref at all:
  // without it React keeps the fallback mounted after a navigation, and every
  // route the user tries next looks broken too.
  it("resets once the user navigates away, so the fallback does not stick", () => {
    const { reset, rerender } = renderView();
    pathname.current = "/agents";
    rerender();
    expect(reset).toHaveBeenCalledOnce();
  });
});
