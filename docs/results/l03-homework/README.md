# L03 homework — evidence

Smart Diff: a PR's changed files grouped into Core logic / Wiring / Boilerplate
and ordered by risk, computed with no model call.

Recorded with `cd demo && DEMO_REPO=teplyakoff/dev-digest DEMO_PR=3 npm run record:smart-diff`;
`summary.json` is written by that run and holds the exact PR, run ids and
per-scene outcomes the frames show.

Plan: [`docs/plans/L03-smart-diff.md`](../../plans/L03-smart-diff.md).

## Read this before the frames: the evidence comes from two PRs

No single PR in this workspace can show all of it, and the reason is worth more
than the video.

| | `dev-digest#3` | `dev-digest#5` |
|---|---|---|
| lock-file | **yes** — `client/pnpm-lock.yaml` +827 −2 | no |
| findings today | 0 | **13**, anchored to rendered lines |
| review possible | **no** — see below | yes, already run |

Acceptance criterion 3 needs a lock-file; criterion 4 needs findings on real
diff lines. So frames **01-08 are `#3`** and frames **09-11 are `#5`**, and each
caption below says which.

**Why `#3` cannot be reviewed at all.** Every one of the five agents failed with

```
OpenRouter returned no choices for Review:
Input too long: 1829704 input tokens, limit is 1048576 for this model
```

Its `git diff` is **3.6 MB ≈ 937k tokens** before prompt overhead. Note this is
not visible from the stored PR files: `pr_files.patch` for `#3` totals 477 KB
against `#5`'s 463 KB — nearly identical — because GitHub truncates the patch of
a large file and `git diff` does not. `loadDiff` reads the clone, not the stored
patch, so **`pr_files` is the wrong place to estimate what a review will cost.**

The run cost **$0.00**: `tokens_in`, `tokens_out` and `cost_usd` are all zero or
null on the five failed rows, because the request was rejected before it was
processed. The eleven minutes were spent; the money was not.

## Frames

| # | What it shows | PR |
|---|---|---|
| 01 | Files changed in **Original order** — no findings on any line | #3 |
| 02 | Toggled to **Smart order**; the section label becomes *Smart Diff · grouped by role* | #3 |
| 03 | Summary strip: file count, `+/−`, findings, changed lines — all derived in render | #3 |
| 04 | **Large-PR banner**, from `split_suggestion.too_big` | #3 |
| 05 | **Core logic on top**, with its role swatch and description | #3 |
| 06 | The **Boilerplate** group and its description | #3 |
| 07 | **`client/pnpm-lock.yaml` inside Boilerplate, collapsed** — the recorder asserted the card has exactly one child element, so no body is rendered | #3 |
| 08 | A large file's **`large file`** chip | #3 |
| 09 | **Findings on real lines**: the per-file `5 findings` badge, the severity rail in the gutter, and the `blocker` tag — `CRITICAL` renders as the word *blocker* | #5 |
| 10 | Clicking that tag lands on **the finding's card in Agent runs**, expanded and ring-highlighted, at `?tab=findings&view=smart&finding=ca300577…` | #5 |
| 11 | Browser **Back** returns to `?tab=diff&view=smart` — still in Smart order | #5 |

`devdigest-smart-diff.mp4` is the `#3` take end to end.

## What is NOT here, and why

- **"Badges appear after Run Review, with no reload" is not filmed as one
  continuous shot.** It needs a PR that has no findings, gets reviewed, and then
  shows them. `#3` has no findings but cannot be reviewed; `#5` can be reviewed
  but already has them. Frames 09-11 prove the badges, the rail and the
  click-through are real; they do not prove the moment of arrival. The
  invalidator itself is wired at `PrDetailView.tsx` inside the existing
  `onRunDone` handler.
- **The recorder's own scene 8 frame was deleted rather than shipped.** It was
  captured after a review that produced nothing, so it showed Smart Diff with no
  badges — an empty frame in the badge scene's slot. Its sibling, "original order
  after the review", was dropped for the same reason: with 0 findings in the
  database, "no findings on screen" is arithmetic, not evidence.
- **The deep-link scroll is unverified.** jsdom implements neither layout nor
  `scrollIntoView`, and the browser pane used here does not paint, so nothing
  available could observe it. Frame 10 shows the card expanded and highlighted;
  whether the page scrolled to it is not claimed.

## Text evidence a browser recorder cannot film

- [`smart-diff-log.txt`](smart-diff-log.txt) — the API's own line,
  `SMART DIFF: computed from stored PR files + every stored review (no model call)`,
  with `reviews_joined: 5 · findings: 13 · unmatched: 0`, and **no**
  `REVIEW model:` or `INTENT CLASSIFIER model:` line beside it. Those two sites
  (`reviews/run-executor.ts`, `intent/service.ts`) are the only places a model
  call becomes visible in the log. `unmatched: 0` also answers the plan's open
  question: `pr_files.path` and a grounded finding's `file` agree on real data.
- [`verify-l03.txt`](verify-l03.txt) — `bash scripts/verify-l03.sh`, both lanes
  green, 33 server + 3 client tests, exit 0, with Docker irrelevant to either
  lane.

Neither could be filmed: the `SMART DIFF:` line goes to the API process's
stdout and no pane in the web UI renders it, and Playwright cannot point a
camera at a terminal.

## Reproducing

```bash
./scripts/dev.sh                                   # stack up
cd demo && DEMO_REPO=teplyakoff/dev-digest DEMO_PR=3 npm run record:smart-diff
bash scripts/verify-l03.sh                         # the text half
```

Frames 09-11 were captured separately against `#5` with a one-off Playwright
script that triggers no review; the main recorder could not produce them because
its preflight requires a lock-file in the boilerplate group, which `#5` has not.

**Do not run any package's test suite while a recording is in flight** —
`buildApp`'s orphan-run reaper marks live `running` rows `failed` in the dev
database, and it has already cost one billed run in this repo.
