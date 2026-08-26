import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff, SmartDiffFile, SmartDiffFinding } from "@devdigest/shared";
// EIGHT levels up from a route-local `_components/<Name>/` folder — the
// specifier is copied from RunTraceDrawer.test.tsx rather than counted
// (client/INSIGHTS.md, "Codebase Patterns").
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

/* No `vi.mock` anywhere in this file, deliberately. `SmartDiffViewer` takes
   `data` as a prop and never fetches, so a fixture is all it needs — if this
   file ever needs to mock `@/lib/hooks/reviews`, the component has started
   fetching and violates frontend-architecture §10.

   `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
   dependency of this package (client/INSIGHTS.md, 2026-08-06). */

afterEach(cleanup);

const CORE_PATH = "server/src/modules/reviews/service.ts";
const WIRING_PATH = "server/src/modules/index.ts";
const LOCK_PATH = "pnpm-lock.yaml";

/** Hunk starts at new-side line 10, so the two added lines are 11 and 12. */
const CORE_PATCH = [
  "@@ -10,3 +10,5 @@ export class ReviewsService {",
  "   async run() {",
  "+const MAX_RETRIES = 99;",
  "+await sleep(0);",
  "   }",
].join("\n");

/** Hunk starts at new-side line 1, so the added line is 2. */
const LOCK_PATCH = ["@@ -1,2 +1,3 @@", " lockfileVersion: '9.0'", "+sha512-deadbeef"].join("\n");

/* `SmartDiff` carries no patch text, so the bodies come from the PR detail the
   page already holds. The wiring file is deliberately absent: a path with no
   matching PR file renders "no diff text", which is the seeded-data state. */
const PR_FILES: PrFile[] = [
  { path: CORE_PATH, additions: 2, deletions: 0, patch: CORE_PATCH },
  { path: LOCK_PATH, additions: 1, deletions: 0, patch: LOCK_PATCH },
];

/**
 * `finding_lines` is DERIVED from `findings` here, exactly as the contract
 * demands (`brief.ts`) — a fixture that set the two independently would be
 * pinning a payload the producer may never emit.
 */
function file(path: string, o: Partial<Omit<SmartDiffFile, "path">> = {}): SmartDiffFile {
  const findings = o.findings ?? [];
  return {
    path,
    pseudocode_summary: null,
    additions: o.additions ?? 2,
    deletions: o.deletions ?? 1,
    finding_lines: [...new Set(findings.map((f) => f.line))].sort((a, b) => a - b),
    findings,
    is_large: o.is_large ?? false,
  };
}

const CORE_FINDINGS: SmartDiffFinding[] = [
  { id: "f-core-1", line: 11, severity: "CRITICAL", title: "Unbounded retry loop" },
  { id: "f-core-2", line: 12, severity: "WARNING", title: "Sleep with zero delay" },
];

const LOCK_FINDING: SmartDiffFinding = {
  id: "f-lock-1",
  line: 2,
  severity: "SUGGESTION",
  title: "Lockfile churn",
};

/**
 * Groups are passed through in the order the caller wrote them — the viewer no
 * longer re-sorts, so the fixture's order IS the expected render order.
 *
 * The `core → wiring → boilerplate` guarantee moved to where it is produced:
 * `smart-diff/service.ts` emits groups in `ROLE_ORDER` and omits the empty ones,
 * pinned by `server/test/smart-diff-service.test.ts`. This file pins the
 * property that is still the client's — that it renders the payload faithfully.
 */
function smartDiff(groups: SmartDiff["groups"]): SmartDiff {
  return {
    groups,
    split_suggestion: { too_big: false, total_lines: 12, proposed_splits: [] },
  };
}

function renderViewer(
  data: SmartDiff,
  onOpenFinding: (id: string) => void = vi.fn(),
  selectedPath: string | null = null,
) {
  return render(
    // Both namespaces: the viewer's own strings are `prReview.smartDiff`, but
    // the shared FileCard/CodeLine read `shell.diffViewer` — a shared component
    // must not depend on a route namespace. One namespace renders raw keys.
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <SmartDiffViewer
        data={data}
        files={PR_FILES}
        selectedPath={selectedPath}
        onOpenFinding={onOpenFinding}
      />
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  // Test-matrix assertion 30. The fixture is in the order the service really
  // sends (`ROLE_ORDER`, empty groups omitted), because that is the payload this
  // viewer will ever be handed; the "no re-sort" property is pinned separately
  // below, where a non-canonical order can actually detect one.
  it("renders each group's files under its own header, keeps a lock-file's body out of the document, and opens a finding from a core line", () => {
    const onOpenFinding = vi.fn();
    renderViewer(
      smartDiff([
        {
          role: "core",
          files: [file(CORE_PATH, { additions: 2, deletions: 0, findings: CORE_FINDINGS })],
        },
        { role: "wiring", files: [file(WIRING_PATH)] },
        { role: "boilerplate", files: [file(LOCK_PATH, { additions: 1, deletions: 0 })] },
      ]),
      onOpenFinding,
    );

    // Group labels and file paths in document order — one assertion pinning both
    // the render order AND which group each file landed in.
    expect(
      screen
        .getAllByText(
          /^(Core logic|Wiring|Boilerplate|server\/src\/modules\/reviews\/service\.ts|server\/src\/modules\/index\.ts|pnpm-lock\.yaml)$/,
        )
        .map((el) => el.textContent),
    ).toEqual([
      "Core logic",
      CORE_PATH,
      "Wiring",
      WIRING_PATH,
      "Boilerplate",
      LOCK_PATH,
    ]);

    // Core starts expanded: its diff body is on screen…
    expect(screen.getByText("const MAX_RETRIES = 99;")).toBeInTheDocument();
    // …and Boilerplate does not, even though its one-line bump is small enough
    // for FileCard's own AUTO_EXPAND_MAX_LINES rule to have opened it.
    expect(screen.queryByText("sha512-deadbeef")).not.toBeInTheDocument();

    // The core file advertises its finding count.
    expect(screen.getByRole("button", { name: /2 findings in this file/ })).toBeInTheDocument();

    // A severity tag on a core diff line hands its finding id back to the page,
    // which is what turns into `?tab=findings&finding=<id>`.
    fireEvent.click(screen.getByRole("button", { name: "Open finding: Unbounded retry loop" }));
    expect(onOpenFinding).toHaveBeenCalledTimes(1);
    expect(onOpenFinding).toHaveBeenCalledWith("f-core-1");
  });

  /* Replaces the assertion this file used to make — that the viewer re-sorted a
     boilerplate-first fixture into `ROLE_ORDER`. That sort was a second source
     of truth for "business logic first": the service already emits groups in
     `ROLE_ORDER` and omits the empty ones, and the guarantee is pinned where it
     is produced, in `server/test/smart-diff-service.test.ts`. What is still the
     client's to get wrong is faithfulness — so the fixture is handed over in an
     order the deleted sort would have "corrected", and must come out unchanged.
     Reintroduce the client sort and this test goes red. */
  it("renders groups in payload order rather than re-sorting them", () => {
    renderViewer(
      smartDiff([
        { role: "boilerplate", files: [file(LOCK_PATH, { additions: 1, deletions: 0 })] },
        { role: "core", files: [file(CORE_PATH, { additions: 2, deletions: 0 })] },
      ]),
    );

    expect(
      screen.getAllByText(/^(Core logic|Boilerplate)$/).map((el) => el.textContent),
    ).toEqual(["Boilerplate", "Core logic"]);
  });

  // Test-matrix assertion 31, the AT RISK one. Two rules pull the other way —
  // FileCard's AUTO_EXPAND_MAX_LINES (this file is 1 line) and the design's
  // `useState(finding_lines.length > 0)` (this file has a finding). The role
  // policy carried by `smart.defaultOpen` has to beat both.
  it("keeps a boilerplate file collapsed even when it has findings", () => {
    renderViewer(
      smartDiff([
        {
          role: "boilerplate",
          files: [file(LOCK_PATH, { additions: 1, deletions: 0, findings: [LOCK_FINDING] })],
        },
        { role: "core", files: [file(CORE_PATH, { additions: 2, deletions: 0 })] },
      ]),
    );

    // The card knows about the finding — the badge is rendered from it, in the
    // singular: `findingsBadge` is an ICU plural, so one finding is "1 finding".
    expect(screen.getByRole("button", { name: /\b1 finding in this file\b/ })).toBeInTheDocument();
    // …and the body is still shut, so neither the diff text nor the finding's
    // own tag is reachable.
    expect(screen.queryByText("sha512-deadbeef")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open finding: Lockfile churn" }),
    ).not.toBeInTheDocument();

    // Clicking the file header opens it. This is what separates "withheld" from
    // "never rendered": if the body were simply missing, it could not appear.
    // It used to be the BADGE that opened the card; the badge now navigates
    // instead (see the next test), and the header always did this job too.
    fireEvent.click(screen.getByText(LOCK_PATH));
    expect(screen.getByText("sha512-deadbeef")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open finding: Lockfile churn" }),
    ).toBeInTheDocument();
  });

  /* THE MENTOR-FEEDBACK GUARD (L04), at the level that matters: the previous
     test proves a boilerplate file's body — and with it every per-line severity
     tag — is NOT on screen. So for a collapsed file the header badge is the only
     finding affordance the reader has, and until now it led nowhere. This is
     also the assertion `FileCard.test.tsx` structurally cannot make: that test
     hands `smart` over by hand, which proves nothing about whether the viewer
     passes `onOpenFinding` down (client/INSIGHTS.md, 2026-08-05). */
  it("routes a collapsed file's badge to the Agent-runs tab without opening the file", () => {
    const onOpenFinding = vi.fn();
    renderViewer(
      smartDiff([
        {
          role: "boilerplate",
          files: [file(LOCK_PATH, { additions: 1, deletions: 0, findings: [LOCK_FINDING] })],
        },
      ]),
      onOpenFinding,
    );

    fireEvent.click(screen.getByRole("button", { name: /\b1 finding in this file\b/ }));
    expect(onOpenFinding.mock.calls).toEqual([[LOCK_FINDING.id]]);
    // The click navigated AWAY; it must not also have expanded the card behind
    // the reader, or Back returns them to a file they never opened.
    expect(screen.queryByText("sha512-deadbeef")).not.toBeInTheDocument();
  });
  /* AC-43 — the landing half of the review-focus click-through.

     THE TARGET IS NOT THE FIRST CARD, and that is the whole design of this
     fixture: a card at index 0 is a false positive for "the deep link worked"
     (client/INSIGHTS.md, 2026-08-08), and a boilerplate card is doubly good
     here because its role policy keeps it SHUT by default — so if it is open,
     something opened it deliberately.

     It asserts EXPANSION, never scrolling: neither jsdom nor the available
     browser pane can observe a scroll, and three rounds of "fixes" have already
     been spent on measurements that environment cannot make (INSIGHTS,
     2026-08-08). AC-43 is written as expansion for that reason. */
  it("expands the selected file's card even when its role would keep it collapsed", () => {
    const { container } = renderViewer(
      smartDiff([
        { role: "core", files: [file(CORE_PATH, { additions: 2, deletions: 0 })] },
        {
          role: "boilerplate",
          files: [file(LOCK_PATH, { additions: 1, deletions: 0 })],
        },
      ]),
      vi.fn(),
      LOCK_PATH,
    );

    // The lock file is the SECOND card, and it is open: its body is on screen.
    const cards = Array.from(container.querySelectorAll("[data-file-path]"));
    expect(cards.map((el) => el.getAttribute("data-file-path"))).toEqual([CORE_PATH, LOCK_PATH]);
    expect(screen.getByText("sha512-deadbeef")).toBeInTheDocument();

    // The role policy still holds for everything else — selecting one file does
    // not turn the collapse rules off, it adds one card to the open set.
    expect(screen.getByText("const MAX_RETRIES = 99;")).toBeInTheDocument();
  });

  /* AC-44. A `?file=` that names a path this PR does not touch — a brief built
     before a force-push, a hand-edited URL — opens the tab with nothing
     selected. Not an error state, not an empty viewer: the diff, as it would
     have looked without the parameter. */
  it("selects nothing when the named file is not part of the PR", () => {
    renderViewer(
      smartDiff([
        { role: "core", files: [file(CORE_PATH, { additions: 2, deletions: 0 })] },
        { role: "boilerplate", files: [file(LOCK_PATH, { additions: 1, deletions: 0 })] },
      ]),
      vi.fn(),
      "src/does/not/exist.ts",
    );

    // Both cards are exactly where the role policy left them: core open…
    expect(screen.getByText("const MAX_RETRIES = 99;")).toBeInTheDocument();
    // …boilerplate shut, and no error copy anywhere.
    expect(screen.queryByText("sha512-deadbeef")).not.toBeInTheDocument();
    expect(screen.getByText(LOCK_PATH)).toBeInTheDocument();
  });

  /* Bringing the selected card into view.

     This is NOT the measurement trap of INSIGHTS 2026-08-08: nothing here asks
     jsdom where an element sits or how tall it is. It asserts that the component
     asked the right node to scroll — a call, not a layout — which is the only
     part of "the reviewer sees the file move" this component owns. */
  describe("scrolling to the selected file", () => {
    let calls: Element[];

    beforeEach(() => {
      calls = [];
      // jsdom implements no scrollIntoView, so there is nothing to restore; the
      // component calls it optionally for exactly this reason.
      Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
        calls.push(this);
      };
    });

    it("scrolls the selected file's card into view", () => {
      const { container } = renderViewer(
        smartDiff([
          { role: "core", files: [file(CORE_PATH, { additions: 2, deletions: 0 })] },
          { role: "boilerplate", files: [file(LOCK_PATH, { additions: 1, deletions: 0 })] },
        ]),
        vi.fn(),
        LOCK_PATH,
      );

      // Exactly one scroll, and it landed on the SELECTED card — not the first
      // card, which is the failure a looser assertion would sail past.
      expect(calls).toHaveLength(1);
      expect(calls[0]?.getAttribute("data-file-path")).toBe(LOCK_PATH);
      expect(container.querySelectorAll("[data-file-path]")).toHaveLength(2);
    });

    it("scrolls nowhere when the URL names no file, or names one the PR lacks", () => {
      const diff = smartDiff([
        { role: "core", files: [file(CORE_PATH, { additions: 2, deletions: 0 })] },
      ]);

      renderViewer(diff, vi.fn(), null);
      expect(calls).toHaveLength(0);

      renderViewer(diff, vi.fn(), "src/does/not/exist.ts");
      expect(calls).toHaveLength(0);
    });
  });
});
