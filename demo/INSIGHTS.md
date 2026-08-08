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

- **A run that settles is not a run whose trace exists.** `saveRunTrace` is the
  last thing `runOneAgent` does, so `GET /runs/:id/trace` right after
  `waitForRuns` returns can 404 — and it does so hardest on a run that settled
  *early*, because something else marked it terminal while the provider call was
  still out. The first take of `record-intent.ts` died exactly there: the run was
  `failed` at 18:38:57 and had a perfectly good trace at 18:39:36. Never pick the
  trace run by `status` and hope; FETCH each candidate's trace and check its
  contents, falling back down a preference list. (2026-08-06)

- **Running the server test suite kills the review you are recording.**
  `buildApp` awaits the orphan-run reaper on every construction, and
  `server/test/routes-smoke.test.ts` builds the app against the ambient
  `DATABASE_URL` — so `pnpm exec vitest run` in another terminal marks every
  `running` agent_run in the *dev* database `failed`, with a null duration and no
  error text. It cost a live billed run mid-recording on 2026-08-06 (the provider
  answered 3 min later, the run persisted 3 findings, and the row still reads
  `failed`). Reproduced deterministically: one `running` row plus
  `vitest run test/routes-smoke.test.ts` flips it. **Do not run any package's
  tests while a recording is in flight**, and if a take dies with a run that
  "failed" for no stated reason, check what else was running before blaming the
  provider. (2026-08-06)

- **`waitFor` passing does not mean the line is on screen.** `LiveLogStream` is a
  fixed-height pane (`LOG_HEIGHT = 420`) that does **not** follow its own tail,
  so a log line can be in the DOM, satisfy `getByText(...).waitFor()`, and sit
  far below the visible viewport. Take two of `record-intent.ts` shipped three
  stills captioned `INTENT CLASSIFIER…` and `REVIEW model…` over a pane still
  showing `Loading PR diff…`. Extends the `page.mouse.wheel()` entry above: the
  fix is the same `locator.scrollIntoViewIfNeeded()` on an element inside the
  pane, but the trap is different — there was no visible symptom to notice,
  because the wait *succeeded*. Wrap it: wait, scroll, settle, shoot.
  (2026-08-06)

- **Extends the two entries above with a third way a still lies: `box.y >= 0` is
  not "visible".** `record-smart-diff.ts` had an `onScreen()` gate that checked
  the bounding box was inside the viewport and above the caption band, and it
  shipped a frame captioned "the badge, the rail and `blocker` on line 74"
  containing none of the three. The PR page keeps its breadcrumb, title and tab
  bar in a **sticky region ~350 px tall**, so an element scrolled underneath
  reports a positive `y`, passes any arithmetic check, and is completely hidden.
  Two consequences: ask the DOM instead of the geometry —
  `document.elementFromPoint(centre)` and require the hit to be the element or
  inside it, which also catches the caption band and any overlay added later; and
  **never `scrollIntoView({block: "start"})` on this app**, because "start" parks
  the element exactly where the sticky header is. `"center"` clears both.
  (2026-08-08)

- **A recorder for feature X must film X, not the machinery that produces X's
  inputs.** The first `record-smart-diff.ts` triggered a review and spent ~10 of
  its 11 minutes filming five agents run — which is L01's feature. Smart Diff is
  the grouping, the risk order and the click-through, and every one of those is
  already true of a PR reviewed at any point in the past. Retargeting to a PR
  that ALREADY carries findings made the take **86 seconds and free**, and it is
  strictly better evidence: the first take filmed a PR with no findings, so the
  feature's headline interaction — click a finding on a diff line, land on its
  card — was never on screen at all. Before writing a scene list, ask which
  scenes are the feature and which are its preconditions; the preconditions can
  usually be found rather than created. (2026-08-08)

- **A wrong rationale in a comment outlives the bug it explains.** After the
  sticky-header fix above, the mis-framed still was misdiagnosed a second time —
  as the badge and the tag being further apart than the viewport is tall — and
  scene 8 was split into two frames with that reason written into the code. It
  was false: the hunk starts at line 71, directly under the file header, and once
  the occlusion was fixed one frame carried both. Nothing would have caught it,
  because the split *worked*. When a fix follows a diagnosis, re-check the
  diagnosis against the fixed behaviour before the reasoning goes into a comment
  — a reader can verify code against the app, but a stated cause is taken on
  trust. (2026-08-08)

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

- **Some states a recorder cannot manufacture, and pretending otherwise is worse
  than skipping the scene.** A stale intent needs a PR whose head moved *after*
  its intent was derived — only a push does that, and there is no DELETE route
  for an intent because nothing in the product deletes one. `record-intent.ts`
  therefore films the on-demand `Re-derive` half when no stale PR is available
  and says so in its own output, and `docs/results/l03/README.md` names the one
  frame kept from an earlier take and why. Naming the borrowed frame is the whole
  point: the L02 evidence's own postmortem is about a mislabelled still.
  (2026-08-06)

## Tool & Library Notes

- **A vendored `DropdownItem` renders its hint inside the same `<button>`**, so
  an agent's accessible name is `"General Reviewer deepseek/deepseek-v4-flash"`,
  not `"General Reviewer"` — `getByRole("button", {name, exact: true})` silently
  matches nothing. Match by prefix. Separately, the run-trace drawer passes its
  `Tabs` as bare strings (`["trace", "log"]`), so the tab labels are literally
  `trace` and `log`; there is no "Live log" text to click. Both were found by a
  free locator probe run before the paid take, which is the cheap habit here: the
  product's own strings are not what the design calls them. (2026-08-06)

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

- `OpenRouter returned no choices for Review: Input too long: N input tokens,
  limit is 1048576 for this model` on every agent of a run → the target PR's diff
  is past the model's context, and **`pr_files` will not warn you**. `loadDiff`
  reads a fresh `git diff` from the CLONE, while `pr_files.patch` is GitHub's
  copy, and GitHub truncates the patch of a large file. `dev-digest#3` stores
  477 KB of patch — ordinary next to #5's 463 KB — and produces a 3.6 MB diff
  ≈ 937k tokens. Check the real thing before choosing a recording target:
  `git -C server/clones/<repo> diff --no-color <base>...<head> | wc -c`. Costs
  nothing to be wrong here — the request is rejected before processing, so
  `tokens_in`, `tokens_out` and `cost_usd` all come back zero or null — but it
  costs the whole take. (2026-08-08)

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

- **2026-08-06** — Added `record-intent.ts` for the L03 Intent Layer: 16 scenes,
  5 min 20 s, one unedited take against `dev-digest#4`. Three takes were needed
  and the first two are the two "What Doesn't Work" entries above (a trace that
  did not exist yet; a log pane that never scrolled). Budget lesson: the three
  takes cost roughly $0.012 all in, and **the failed takes still bill** — the
  classifier and review calls they started are paid for whether or not a video
  came out. Run the free locator probe first; it caught three broken selectors
  before any money was spent. The take that shipped fired the OpenRouter schema
  repair round for the first time seen in this repo — `2 attempts`, 8 378 output
  tokens, **$0.002714** against the ~$0.0003 the plan budgeted — which is a real
  demonstration of why `attempts` is logged, and is written up in
  `docs/results/l03/README.md` rather than hidden.

- **2026-08-08** — L03 homework, the Smart Diff take. Three attempts, and only
  the third is worth keeping. Take 1 targeted `dev-digest#3` for its lock-file,
  triggered a review, and lost all five agents to `Input too long` — $0.00, but
  eleven minutes and no findings to film. Take 2 dropped the review entirely and
  retargeted to `#1`, which carries a lock-file *and* two findings already
  anchored to lines: 86 seconds, free, and it films the click-through the first
  take could not. Take 3 existed only because take 2's most important still was
  blank — see the sticky-header entry under *What Doesn't Work*. The lesson that
  generalises past this package: the user caught the scope error, not the tests
  and not the recorder's own assertions, because every assertion passed. A
  recorder can only check the claims it was told to make.

## Open Questions

- The recording currently runs every enabled agent, which is what makes it
  representative but also what makes it slow (~2.5 min) and the most exposed to a
  single hung run. Unclear whether a single-agent variant is worth a flag.
