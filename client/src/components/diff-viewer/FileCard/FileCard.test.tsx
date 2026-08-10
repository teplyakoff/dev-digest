import { describe, it, expect, afterEach, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiffFinding } from "@/lib/types";
// FOUR levels up, not eight: this file lives in `src/components/<name>/<Name>/`,
// so the eight-`../` rule in client/INSIGHTS.md — which is about route-local
// `src/app/**/_components/<Name>/` tests — does not apply here.
// FileCard/ → diff-viewer/ → components/ → src/ → client/.
import shell from "../../../../messages/en/shell.json";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { FileCard } from "./FileCard";

/* Why this file exists: `smart?: SmartFileView` is an OPT-IN capability, and the
   claim it was added under is that a `<FileCard file={f} />` with no `smart`
   prop renders exactly as it did before Smart Diff. Nothing pinned that — this
   folder had no tests at all — so the whole of the Files tab's ORIGINAL mode was
   protected by an argument rather than by a test.

   `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
   dependency of this package (client/INSIGHTS.md, 2026-08-06), and adding it is
   a change of its own.

   The intl provider is mandatory, not ceremony: `FileCard` AND `CodeLine` both
   call `useTranslations("shell")`, so without it every label renders as a raw
   key and the "no Smart Diff affordance is on screen" assertions below would
   pass for the wrong reason. The strings the SHARED card uses live under
   `shell.diffViewer`, never in the route's `prReview` namespace. */

afterEach(cleanup);

/** The `smart` capability, derived from the component rather than imported from
    `../findings` — the test pins FileCard's own public surface, and stays valid
    if the helper module's exports are renamed. */
type SmartProp = NonNullable<ComponentProps<typeof FileCard>["smart"]>;

const FILE_PATH = "server/src/modules/reviews/service.ts";

/** U+2212 MINUS SIGN, not a hyphen — see the deletions span in `FileCard.tsx`.
    Asserting with "-1" silently never matches. */
const MINUS = "−";

/* A real patch string is required: `parsePatch(null)` returns no lines and the
   card renders the "no diff text" placeholder instead of a body. Seeded PR files
   carry `patch: null`, so this fixture is deliberately unlike seed data.
   The hunk starts at new-side line 10, so the added lines are 11 and 12 — line
   11 is what the anchored finding below hangs on. */
const PATCH = [
  "@@ -10,3 +10,5 @@ export class ReviewsService {",
  "   async run() {",
  "+const MAX_RETRIES = 99;",
  "+await sleep(0);",
  "-const OLD_RETRIES = 1;",
  "   }",
].join("\n");

const ADDED_LINE = "const MAX_RETRIES = 99;";
const DELETED_LINE = "const OLD_RETRIES = 1;";

/** `additions`/`deletions` are the header stat AND the input to the size rule;
    they are independent of the patch text, which only drives the body. */
function baseFile(o: Partial<PrFile> = {}): PrFile {
  return { path: FILE_PATH, additions: 2, deletions: 1, patch: PATCH, ...o };
}

const ANCHORED: SmartDiffFinding = {
  id: "f-anchored",
  line: 11,
  severity: "CRITICAL",
  title: "Unbounded retry loop",
};

/** No rendered line carries new-side number 999, so this one lands in the
    unanchored footer instead of on a code line. */
const UNANCHORED: SmartDiffFinding = {
  id: "f-unanchored",
  line: 999,
  severity: "SUGGESTION",
  title: "Lockfile churn",
};

/** When `smart` is undefined the element is built WITHOUT the prop, rather than
    with `smart={undefined}` — the claim under test is about a call site that
    never mentions Smart Diff. */
function renderCard(file: PrFile, smart?: SmartProp) {
  render(
    <NextIntlClientProvider locale="en" messages={{ shell }}>
      {smart ? <FileCard file={file} smart={smart} /> : <FileCard file={file} />}
    </NextIntlClientProvider>,
  );
}

describe("FileCard without the `smart` prop", () => {
  it("renders its path, its +/− counts and its diff body, and none of the Smart Diff affordances", () => {
    renderCard(baseFile());

    // The header, unchanged.
    expect(screen.getByText(FILE_PATH)).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText(`${MINUS}1`)).toBeInTheDocument();

    // The body: an added line and a deleted line, both on screen.
    expect(screen.getByText(ADDED_LINE)).toBeInTheDocument();
    expect(screen.getByText(DELETED_LINE)).toBeInTheDocument();

    // Each of the four Smart Diff affordances, named individually so a failure
    // says which one leaked: the findings badge, the large-file chip, a
    // per-line severity tag, and the unanchored-findings footer.
    expect(screen.queryByRole("button", { name: /findings/i })).not.toBeInTheDocument();
    expect(screen.queryByText("large file")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open finding:/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/not on a shown line/)).not.toBeInTheDocument();

    // …and then the broad net the four named checks cannot provide: original
    // mode offers the reader NO control at all. Every Smart Diff affordance
    // that is interactive is a `<button>`, so a fifth one added later — or a
    // dropped `smart &&` guard on an existing one — fails here even though no
    // assertion above mentions it. A genuinely new original-mode control is
    // meant to fail this too: it would contradict "renders as it does today".
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("takes its open/closed default from the size rule, not from anything Smart Diff introduced", () => {
    // Exactly at the threshold → expanded, so the body is on screen.
    renderCard(baseFile({ additions: AUTO_EXPAND_MAX_LINES, deletions: 0 }));
    expect(screen.getByText(ADDED_LINE)).toBeInTheDocument();
    cleanup();

    // One line over → collapsed. This is the half that a `smart?.defaultOpen ??`
    // fallback rewritten to a constant `true` would break.
    renderCard(baseFile({ additions: AUTO_EXPAND_MAX_LINES, deletions: 1 }));
    expect(screen.queryByText(ADDED_LINE)).not.toBeInTheDocument();

    // Clicking the header still opens it — which is what separates "withheld"
    // by the size rule from "the body was never renderable in the first place".
    fireEvent.click(screen.getByText(FILE_PATH));
    expect(screen.getByText(ADDED_LINE)).toBeInTheDocument();
  });
});

describe("FileCard with the `smart` prop", () => {
  /* The contrast case. Without it, every `queryBy…` above could be passing
     because the query is simply wrong — a mistyped accessible name never
     matches anything, in either mode. */
  it("shows the badge, the large-file chip, the line tag and the unanchored footer for the same file", () => {
    const onOpenFinding = vi.fn();
    renderCard(baseFile(), {
      findings: [ANCHORED, UNANCHORED],
      isLarge: true,
      defaultOpen: true,
      onOpenFinding,
    });

    // Real English, not raw keys: these also prove the intl wiring above.
    expect(screen.getByRole("button", { name: /2 findings in this file/ })).toBeInTheDocument();
    expect(screen.getByText("large file")).toBeInTheDocument();
    expect(screen.getByText(/1 finding\(s\) not on a shown line/)).toBeInTheDocument();

    // Both routes back to the page carry the finding's own id: the severity tag
    // on line 11, and the chip for the finding no line could host.
    fireEvent.click(screen.getByRole("button", { name: `Open finding: ${ANCHORED.title}` }));
    fireEvent.click(screen.getByRole("button", { name: `Open finding: ${UNANCHORED.title}` }));
    expect(onOpenFinding.mock.calls).toEqual([[ANCHORED.id], [UNANCHORED.id]]);
  });

  /* THE MENTOR-FEEDBACK GUARD (L04). The header badge is the most prominent
     finding affordance in Smart Diff, and it was the only one that went
     nowhere: it called `setOpen(true)` and the reader never left the Files tab.
     Both halves below have to be asserted together — a badge that navigates but
     picks the wrong finding lands the reader on a SUGGESTION while a blocker
     sits in the same file, and both versions look identical from the outside. */
  it("routes the header badge to the file's MOST SEVERE finding", () => {
    const onOpenFinding = vi.fn();
    // UNANCHORED (SUGGESTION) is listed FIRST, so "take the first one" and
    // "take the most severe one" disagree — which is the whole point of the
    // fixture order. ANCHORED is the CRITICAL.
    renderCard(baseFile(), {
      findings: [UNANCHORED, ANCHORED],
      isLarge: false,
      defaultOpen: true,
      onOpenFinding,
    });

    fireEvent.click(screen.getByRole("button", { name: /2 findings in this file/ }));
    expect(onOpenFinding.mock.calls).toEqual([[ANCHORED.id]]);
  });

  it("does not toggle the card open or shut when the badge is clicked", () => {
    // The badge sits INSIDE the header, whose own click handler toggles the
    // card. Without `stopPropagation` the click navigates away AND flips the
    // card, so pressing Back returns the reader to a file in the opposite state
    // from the one they left — a bug with no symptom until someone goes back.
    const onOpenFinding = vi.fn();
    renderCard(baseFile(), {
      findings: [ANCHORED],
      isLarge: false,
      defaultOpen: true,
      onOpenFinding,
    });

    expect(screen.getByText(ADDED_LINE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 finding in this file/ }));
    expect(screen.getByText(ADDED_LINE)).toBeInTheDocument();
  });
});
