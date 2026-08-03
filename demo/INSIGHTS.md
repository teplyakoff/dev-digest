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

- A recorder that **writes** must delete what it will create at the START, not
  clean up at the end. `record-skills.ts` authors `migration-safety` and imports
  `error-handling-guard`; `skills` has a unique `(workspace_id, name)` index, so
  the second run 409s on create unless those names are deleted first.
  End-of-run cleanup does not survive a crash — one failed take then poisons
  every later one. What *does* belong in `finally` is restoring state the
  recorder only borrowed: the agent's ordered `skill_ids`, snapshotted before
  the first scene. (2026-08-03)

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

- **Corrects the entry above: those runs were not wedged, just very slow — and
  `waitForRuns`' cancel does not actually stop them.** `duration_ms` on the two
  culprits was 945 s and 674 s (8–99 s is normal), and the cancel only marks the
  row; when the provider finally answers, the server overwrites it back to `done`.
  Consequence for this package: a recording abandoned on timeout still spends the
  money for the runs it started, and `summary.json` from the *successful* retry
  will not mention them. Reconcile against `GET /pulls/:id/runs` if the OpenRouter
  bill looks higher than the summaries explain. Bumping `DEMO_RUN_TIMEOUT` past
  ~15 min is the way to ride one out rather than paying for a discarded run.
  (2026-07-28)

- Recording against a **clean PR renders every findings-related badge empty** —
  the first take of the cost feature reviewed `dev-digest#1` and got three
  0-finding, score-100 runs, so severity chips would have shown nothing but
  "—". The retake seeded a deliberately reviewable PR (`dev-digest#2`, a
  39-line `scripts/notify-review-done.ts` with a hardcoded token, unchecked
  `fetch` and a dead import) and pointed `DEMO_REPO`/`DEMO_PR` at it; the run
  came back 2 CRITICAL · 1 WARNING · 2 SUGGESTION. When a new UI element
  depends on findings, budget a fixture PR whose review will actually produce
  them — and keep the "this is a demo" disclaimer in the PR description, where
  the reviewing model never sees it. (2026-07-31)

- `page.mouse.wheel()` scrolls **whatever sits under the cursor**, and the
  cursor starts at (0,0) over the app sidebar — so wheeling after
  `scrollIntoViewIfNeeded` on the PR page moved nothing and two stills shipped
  mis-framed before the cause was found. Inner panes (the PR content pane, the
  trace drawer body) only move via `locator.scrollIntoViewIfNeeded()` on an
  element **inside** them; and because that method only guarantees visibility
  at the viewport edge, framing a region means targeting an element *below* it
  — the committed verdict-banner still targets the `Critical` filter chip, not
  the "PR SCORE" label the recorder's step 6 uses. (2026-07-31)

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

- **`record:skills` is free because it reuses a run someone already paid for.**
  Every scene except the trace runs against data the recorder creates through the
  API, but `trace.config.skills` is only ever written by a real review. Rather
  than triggering one, `findRunWithSkills()` walks `/repos` →
  `/pulls/:id/runs` → `/runs/:id/trace` for the first non-empty `config.skills`,
  and exits non-zero when there is none instead of filming an empty drawer.
  Consequence: after a fresh `pnpm db:seed` the skills recording is incomplete
  until someone links a skill to an agent and runs `npm run record` once.
  (2026-08-03)

- A demo recorder is not a test, but it **may assert the one claim its footage
  exists to make**. `record-skills.ts` reads the import modal's text and throws
  unless every non-body entry of the fixture archive (`run.sh`, `package.json`,
  `scripts/install.js`, `README.md`) is named as ignored. Filming is not
  verifying: a regression that dropped an entry would still have produced a
  plausible-looking video, and that list *is* the product claim. Keep it narrow —
  one load-bearing invariant per recorder, not a test suite smuggled in here.
  (2026-08-03)

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

- **GitHub will not play a repo-hosted video, in any markup.** Verified against
  the `POST /markdown` rendering API: `<video src=…>` is dropped by the sanitizer
  (renders as an empty `<p>`), `![](x.mp4)` becomes an `<img>` pointing at an mp4
  (a broken image), and a bare URL stays a link. The blob page for an mp4 shows
  only its size and "View raw" — no player. The sole mechanism is dragging the
  file into the description box, which uploads it to GitHub's attachment host and
  is special-cased into a player. For something that embeds inline, use a GIF —
  recipe in `README.md`. Do not build a "clickable poster that opens the player";
  there is no player to open. (2026-07-28)

- **How to get a real player into a PR description anyway.** Drop the mp4 into a
  throwaway PR *comment*, take the `https://github.com/user-attachments/assets/<uuid>`
  URL it produces, put that URL **on its own line** in the description, then
  delete the comment. GitHub expands a bare attachment URL into a `<video controls>`
  anywhere it renders markdown, not only in the comment that uploaded it — and the
  asset outlives its comment. Verified on PR #1: after deleting the comment the
  description's player still reported `duration 131`, `1280x720`, `readyState 4`,
  no error, served from `private-user-images.githubusercontent.com`. Uploading is
  the only step that needs the web UI; `gh api -X DELETE /repos/{o}/{r}/issues/comments/{id}`
  handles the cleanup. (2026-07-28)

- **Ignore the "use a GIF" advice two entries up — the upload-then-delete route
  above replaces it.** A GIF does embed from the repo, so the claim is not wrong,
  it is just the worse answer now that a real player is reachable: fitting a
  2:11 recording into a GIF meant a 4× speed-up that made the step captions
  unreadable, and the result was 2.4 MB against the 1.4 MB mp4 it was standing in
  for. The GIF built for PR #1 was deleted once the player worked. Reach for one
  only where no upload UI exists at all. (2026-07-28)

- **Playwright's bundled ffmpeg cannot produce mp4** — `ffmpeg-mac -encoders`
  lists exactly two: `png` and `libvpx`. It also rejects `-preset`, so an H.264
  command line fails with `Unrecognized option 'preset'` rather than anything
  that names the real cause. Playwright itself only records VP8/WebM. `record.ts`
  therefore converts through a **system** `ffmpeg` when one is on `PATH` and
  keeps the webm when there is none. Worth it: from the same source, H.264 at
  `-crf 28 -preset slow` produced 1.4 MB against 2.7 MB for a VP8 re-encode, and
  took 2.6 s against 77 s. (2026-07-28)

- `locator.setInputFiles()` accepts an **in-memory file** —
  `{ name, mimeType, buffer }` — so a fixture upload needs neither a file on disk
  nor a binary committed to git. `lib/zip.ts` builds the skills import archive
  with `deflateRawSync` at record time and hands the Buffer straight to the
  `input[type=file]`. That matters beyond convenience in this scene: its whole
  point is that a reader can compare the archive's real entries against the
  "ignored" list the preview renders, which an opaque committed `.zip` would
  defeat. (2026-08-03)

## Recurring Errors & Fixes

_(no entries yet)_

## Session Notes

- **2026-07-28** — Built this package to produce video proof of the L01 work.
  Recorded `teplyakoff/dev-digest` #1 with all three seeded agents: 3 runs,
  $0.0129 total, and the Run Cost Badge visible on all three surfaces (PR list
  COST column, run accordion header + verdict banner, run trace COST stat tile).
  Two of four attempts were lost to a wedged provider call — see the entry in
  "What Doesn't Work" and `server/INSIGHTS.md`.

- **2026-07-31** — L01 rework retake against the seeded bad PR (`dev-digest#2`):
  3 runs, $0.004121 total, severity chips visible on the list, the timeline and
  the verdict banner; captions now narrate the severity split (computed from
  `GET /pulls/:id/reviews` at record time). Steps 6 and 8 gained live
  interactions — chip-toggle filtering and the FINDINGS hover popup — so the
  video shows the feature working, not just existing. Three stills the recorder
  cannot frame (banner+chips, drawer findings, drawer log) were reshot with a
  one-off Playwright script at the same 1280×720@2x settings.

- **2026-08-03** — Added `record-skills.ts`, a second recorder covering the L02
  Skills feature in 16 captioned scenes: the `/skills` grid and preview drawer,
  authoring and versioning, the import preview's ignored-entries list, the agent
  Skills tab, and the run trace's skills block. It calls no model, so unlike
  `record` it costs nothing. Curated stills and the mp4 promoted to
  `docs/results/l02/`. The trace scenes reused the only existing run that had
  loaded a skill — API Contract Reviewer on `dev-digest#2`, `api-contract-guard
  v1`, 308 tokens — because nothing in this package can produce one; the L02
  control experiment still has no recorded evidence.

## Open Questions

- The recording currently runs every enabled agent, which is what makes it
  representative but also what makes it slow (~2.5 min) and the most exposed to a
  single hung run. Unclear whether a single-agent variant is worth a flag.
