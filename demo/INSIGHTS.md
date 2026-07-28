# demo — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

- Playwright records video **per browser context**, and the file only exists once
  the context is closed — `await page.video()?.path()` before `ctx.close()`
  resolves to a path that is not on disk yet. `record.ts` closes the page, closes
  the context, and only then renames the file to
  `devdigest-review-loop-<stamp>.webm`. (2026-07-28)

- Poll the **API**, not the DOM, to know when a review has finished:
  `GET /pulls/:id/runs` filtered to the run ids returned by the `POST
  /pulls/:id/review` response. It reports `failed` with the reason, whereas a DOM
  wait can only time out. Capture the ids with `page.waitForResponse(r =>
  r.url().includes("/review") && r.request().method() === "POST")` so a stale run
  from a previous attempt is never mistaken for this one. (2026-07-28)

## What Doesn't Work

- Recording against a **seeded** PR produces a meaningless video: seeded file
  rows carry `patch: null`, so the agents have no diff to ground findings
  against. Point `DEMO_REPO`/`DEMO_PR` at a genuinely imported repo with a clone.
  (2026-07-28)

- The recording can fail through no fault of this package: a review run
  sometimes wedges on the provider call and never settles, and because agents run
  sequentially every agent behind it stays `running` too. `waitForRuns` cancels
  the stuck runs before it throws — without that the *next* recording starts
  against a wedged stack. If a run dies mid-recording, just re-run `npm run
  record`; it succeeded on the retry both times this happened. (2026-07-28)

## Codebase Patterns

- This package is deliberately **not** part of `../e2e`. `e2e` is deterministic,
  key-free and free — its flows target read-only seeded data and never call a
  model, which is what keeps `npm test` CI-safe. This recorder triggers a real
  `POST /pulls/:id/review`, so it spends real money and takes as long as the
  models take. Don't move demo flows into `e2e/specs/`, and don't teach `e2e` to
  trigger runs. (2026-07-28)

- Captions are injected DOM nodes pinned over the app, so a **client-side route
  change wipes them**. Every step calls `caption()` again rather than assuming
  the banner survived the last navigation. (2026-07-28)

## Tool & Library Notes

- `npm run setup` (`playwright install chromium`) fetches ~95 MB into
  `~/Library/Caches/ms-playwright`: the full `chromium-*` build, the
  `chromium_headless_shell-*` build and an `ffmpeg-*` build. Playwright encodes
  video with **its own bundled ffmpeg**, so recording works on a machine with no
  system `ffmpeg` — which is the reason a video is possible here at all.
  (2026-07-28)

- An aborted run leaves Playwright's raw `page@<guid>.webm` behind, because the
  rename to a human-readable name only happens on success. `record.ts` sweeps
  `page@*.webm` out of the output dir at startup. (2026-07-28)

## Recurring Errors & Fixes

_(no entries yet)_

## Session Notes

- **2026-07-28** — Built this package to produce video proof of the L01 work.
  Recorded `teplyakoff/dev-digest` #1 with all three seeded agents: 3 runs,
  $0.0129 total, and the Run Cost Badge visible on all three surfaces (PR list
  COST column, run accordion header + verdict banner, run trace COST stat tile).
  Two of four attempts were lost to a wedged provider call — see the entry in
  "What Doesn't Work" and `server/INSIGHTS.md`.

## Open Questions

- The recording currently runs every enabled agent, which is what makes it
  representative but also what makes it slow (~2.5 min) and the most exposed to a
  single hung run. Unclear whether a single-agent variant is worth a flag.
