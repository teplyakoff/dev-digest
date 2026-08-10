# L03 homework — evidence

Smart Diff: a PR's changed files grouped into Core logic / Wiring / Boilerplate
and ordered by risk, computed with no model call.

Recorded with `cd demo && npm run record:smart-diff`; `summary.json` is written
by that run and holds the exact PR, the hero finding and the per-scene claims the
frames show.

Plan: [`docs/plans/L03-smart-diff.md`](../../plans/L03-smart-diff.md).

**This recording triggers no review and spends nothing.** 86 seconds, twelve
frames, one unedited take against `teplyakoff/dev-digest#1` — a PR that already
carried findings from a review run months ago.

## Frames

| # | What it shows |
|---|---|
| 01 | Files changed in **Original order** — the order the API returns. This PR has 2 findings and **not one of them is on screen**: `DiffViewer` has no way to receive findings at all, so it is structural, not a flag. The recorder asserts zero `Open finding:` buttons here |
| 02 | One toggle → **Smart order**; the label becomes *Smart Diff · grouped by role* |
| 03 | Summary strip — `92 files · +7830 −55 · 2 findings · 7,885 changed lines` |
| 04 | **Large-PR banner**, from `split_suggestion.too_big` |
| 05 | **Core logic first**, with its swatch and description |
| 06 | **Boilerplate last** — *generated / mechanical, skim* |
| 07 | **`demo/package-lock.json` inside Boilerplate, collapsed** — asserted: the card has exactly one child element, so no body is rendered |
| 08 | `demo/record.ts` flagged **`large file`** before anyone opens it |
| 09 | The whole feature in one frame: summary strip, banner, Core logic, the file header's **`1 finding`** badge, and the severity rail with its `blocker` tag on line 74 |
| 10 | Close-up: the **rail in the gutter** and **`blocker` on line 74** itself |
| 11 | Clicking that tag lands on **the finding's card in Agent runs** — expanded, ring-highlighted, at `?tab=findings&view=smart&finding=…`, showing the rationale and *Suggested fix* |
| 12 | Browser **Back** → `?tab=diff&view=smart`, still in Smart order |

The hero finding is a real one, found by the General Reviewer on this repo:
*"runById map uses wrong key (run_id instead of id)"* on
`client/…/FindingsTab/FindingsTab.tsx:74`.

## What is deliberately NOT here

- **A review running.** The first take filmed one and spent ~10 of its 11 minutes
  on it. Running a review is L01's feature, not this one — Smart Diff is the
  grouping, the risk order and the click-through, all of which are already true
  of a PR reviewed at any point in the past. So this recorder triggers no review,
  and the take is 86 seconds instead of 11 minutes.
- **The moment badges arrive after a review**, therefore. That is S6's
  invalidator, and it belongs to a test rather than to a camera.
- **The deep-link scroll.** Frame 11 shows the card expanded and highlighted;
  whether the page scrolled to it is not claimed. jsdom implements neither layout
  nor `scrollIntoView`, and the browser pane used in development does not paint,
  so nothing available could observe it.

## Text evidence a browser recorder cannot film

- [`smart-diff-log.txt`](smart-diff-log.txt) — the API's own line,
  `SMART DIFF: computed from stored PR files + every stored review (no model call)`,
  with `reviews_joined: 5 · findings: 13 · unmatched: 0`, and **no**
  `REVIEW model:` or `INTENT CLASSIFIER model:` line beside it. Those two sites
  (`reviews/run-executor.ts`, `intent/service.ts`) are the only places a model
  call becomes visible in the log. `unmatched: 0` also answers the plan's open
  question: `pr_files.path` and a grounded finding's `file` agree on real data.
- [`verify-l03.txt`](verify-l03.txt) — `bash scripts/verify-l03.sh`, both lanes
  green, 33 server + 3 client tests, exit 0.

Neither could be filmed: the `SMART DIFF:` line goes to the API process's stdout
and no pane in the web UI renders it, and Playwright cannot point a camera at a
terminal.

## Two things the first take cost, worth keeping

**A PR can be unreviewable, and `pr_files` will not tell you.** The first target
was `dev-digest#3`, chosen because it carries a lock-file. All five agents failed
with `Input too long: 1829704 input tokens, limit is 1048576`. Its `git diff` is
3.6 MB ≈ 937k tokens — but from the database it looks ordinary: 477 KB of stored
patch against #5's 463 KB. `loadDiff` reads the clone, and GitHub truncates the
patch of a large file while `git` does not. **Estimating what a review will cost
from `pr_files` is wrong by an order of magnitude.** The run itself cost $0.00 —
`tokens_in`, `tokens_out` and `cost_usd` are all zero or null, because OpenRouter
rejected the request before processing it.

**A frame can pass its own visibility check and still be blank.** Scene 8's first
version asserted the badge and the tag were on screen, and shipped a still with
neither. The gate tested `box.y >= 0`; the PR page keeps its breadcrumb, title and
tabs in a sticky region ~350 px tall, so an element parked underneath reports a
positive `y` and is invisible. `onScreen()` now hit-tests with
`document.elementFromPoint` instead of trusting coordinates — which catches the
sticky header, the caption band, and any overlay added later.

## Reproducing

```bash
./scripts/dev.sh                    # stack up
cd demo && npm run record:smart-diff
bash scripts/verify-l03.sh          # the text half
```

The recorder's preflight refuses to launch the browser unless the target PR has
real patch text, all the group structure the scenes need, and at least one
finding anchored to a rendered line in a group that is open by default. A PR that
cannot carry the scenes fails before Chromium starts rather than halfway through.
