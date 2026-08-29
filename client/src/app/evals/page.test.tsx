import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The redirect is the only thing this route does, and it exists for links that
 * were minted before the dashboard moved: `docs/results/l06-homework/`
 * screenshots and the L06 demo both name `/evals`. Deleting the route would
 * turn every one of them into a 404, which is why the redirect is pinned rather
 * than left to good intentions.
 *
 * `redirect()` throws in a real render, so the page is called directly and the
 * mock records the argument instead.
 */
const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

import EvalsPage from "./page";

beforeEach(() => redirect.mockReset());

describe("/evals", () => {
  it("redirects to the canonical /eval", () => {
    EvalsPage();
    expect(redirect).toHaveBeenCalledWith("/eval");
  });
});
