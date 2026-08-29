# client — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

_(no entries yet)_

## What Doesn't Work

- Giving a **shared** component its own next-intl namespace breaks every existing
  test that renders it. `NextIntlClientProvider` in a test only carries the
  namespaces the test handed it, so when `RunCostBadge` started calling
  `useTranslations("common")`, `VerdictBanner.test.tsx` had to grow
  `messages={{ prReview, common }}`. Budget for that fan-out before adding a
  namespace to something rendered from several feature folders — or take the
  string as a prop instead. (2026-07-28)

- An absolutely-positioned popup inside the PR-list card is **clipped by
  `tableCard`'s `overflow: hidden`** (`app/repos/[repoId]/pulls/styles.ts`). The
  FINDINGS hover popover forced it to `visible`, which in turn means the header
  row must round its own top corners (`borderRadius: "10px 10px 0 0"`) or they
  poke past the card radius. Two more rules that came with it: a hover popover
  rendered as a child of its `mouseenter`/`mouseleave` wrapper needs no
  click-outside handling (moving into the popup keeps it open), and a popup
  inside a clickable row needs `stopPropagation` on its cell or hovering users
  navigate away when they click inside it (`PRRow.tsx`). (2026-07-31)

- **Importing anything from `@devdigest/shared` for a VALUE (not a type) used to
  break the build outright.** Every existing import was type-only —
  `src/lib/types.ts` re-exports with `export type { … }`, which is erased at
  build time — so webpack had never once resolved
  `src/vendor/shared/index.ts`. The moment it had to, ~12 errors appeared at
  once: `Module not found: Can't resolve './contracts/findings.js'`, one per
  `export *` line. Cause: the vendored files are copied verbatim from the
  server's ESM-with-extensions source, so they import `./contracts/findings.js`
  while the file on disk is `.ts`. `tsc` (moduleResolution `Bundler`) and Vitest
  both resolve that; webpack does not, by default. **So type-check and `pnpm
  test` stay green while `pnpm build` fails** — always run `pnpm build` after
  touching an import from that path. Fixed by `config.resolve.extensionAlias` in
  `next.config.mjs`; do not remove it. (2026-08-03)

- **Importing one Zod schema from `@devdigest/shared` costs ~15 kB First Load JS
  on EVERY route.** Measured: `/repos/[repoId]/pulls` went 200 → 217 kB. The
  barrel is `export *` over every contract, so one schema drags all of them plus
  `zod` — which nothing else in this package bundles — into the shared chunk.
  Importing the contract module directly
  (`@devdigest/shared/contracts/platform`) recovered only 2 kB, because the bulk
  is `zod` itself. Budget for that before adding runtime validation; a dev-only
  check is not worth it (see the note on `validateInDev` in `src/lib/api.ts`).
  (2026-08-03)

- On **pnpm 11**, every `pnpm <script>` in this package fails before running
  anything, with `ERR_PNPM_IGNORED_BUILDS`. pnpm 11 flipped `strictDepBuilds` to
  true, so the automatic pre-run dependency check refuses to pass while any
  dependency's build script is undecided. The fix is `pnpm-workspace.yaml` with
  an `allowBuilds:` map (`esbuild` and `sharp`, both `false` — each ships a
  prebuilt binary via optionalDependencies). A `pnpm` field in `package.json`,
  `strict-dep-builds` in `.npmrc`, and the `npm_config_*` env vars are all
  ignored in pnpm 11 — only `pnpm-workspace.yaml` is read. (2026-07-27)

- **`rerender()` with the SAME element reference does nothing.** React bails out
  before the component body runs, so a test that mutates a mocked hook's value
  and re-renders observes no change — and the failure reads exactly like a
  component bug. `RootErrorView.test.tsx` mocks `usePathname` off a `vi.hoisted`
  ref; the "resets once the user navigates away" case set `pathname.current` and
  called `view.rerender(ui)` with the element it had already rendered, and failed
  with `expected "spy" to be called once, but got 0 times`. Half an hour went
  into the component before the test was suspected. Build the element in a
  function and pass a fresh one each time: `view.rerender(ui())`. (2026-08-03)

- **Synthetic `DragEvent`s fired in one tick cannot exercise `SkillsTab`'s
  drag-reorder, and the failure is indistinguishable from a broken feature.**
  `onDrop` closes over `dragIndex` from the render it was attached in, so a
  `dragstart` → `dragover` → `drop` sequence dispatched synchronously still sees
  `dragIndex === null` and returns early: the order never changes, and the
  obvious conclusion — "reorder is broken" — is wrong. Put a real gap between
  `dragstart` and `drop` (a `setTimeout` of a few hundred ms) so React
  re-renders in between, then **re-query the row elements**, since the list
  re-orders under you. Measured on
  `app/agents/[id]/_components/AgentEditor/_components/SkillsTab`: identical
  events one tick apart changed nothing; 400 ms apart wrote the new
  `agent_skills.order`. Note this is a hazard for hand-driven browser
  verification only — Playwright's `dragTo()` and a real mouse both leave frames
  in between. (2026-08-03)

- **`pnpm build` while `pnpm dev` is running kills the dev server**, because both
  write `client/.next`. The production build overwrites the dev chunks, the
  running server keeps serving from the manifests it has, and every route goes
  blank with a bare "1 Issue" badge and an empty console — no error naming the
  cause. Recovering needs `rm -rf client/.next` **and** a restart, and because
  `scripts/dev.sh` runs the client in the foreground with a `trap cleanup EXIT`
  that kills the API, killing the Next process takes the whole stack down with
  it. This collides head-on with the 2026-08-03 note above that `pnpm build` is
  the only thing that catches the webpack `.js`→`.ts` trap: run the build when
  the dev server is stopped, or expect to restart the stack afterwards.
  (2026-08-03)

- A **flex row whose children are `align-items: stretch` takes its height from
  the tallest child**, which silently defeated `rows` on the skill body editor:
  the line gutter renders one `div` per line, so a 30-line body made the frame
  620 px, the textarea stretched to match, `scrollHeight === clientHeight`, and
  the gutter's scroll-sync handler became dead code that never fired. It looks
  fine on a short body and degrades with length, so the screenshot that "proves"
  it works proves nothing. `SkillBodyEditor` pins the frame height from `rows`
  (`rows * lineHeight + 2 * padding`) and gives the textarea `height: 100%`;
  `SkillBodyEditor.test.tsx` asserts a 200-line body renders the same height as
  a 1-line one. (2026-08-03)

- **A component test that passes the prop by hand proves nothing about whether
  anything passes it, and both halves look correct in isolation.**
  `AgentCard.test.tsx` had asserted the skill-count badge since L02 by rendering
  `<AgentCard skillCount={3} />` — green, and the badge had never once appeared
  in the app, because `AgentsListView` never passed it. Neither file is wrong on
  its own; the gap is between them, and no amount of component-level coverage
  can see it. Whenever a component takes an optional display prop, the guard
  that matters is a test on the VIEW that renders it from mocked API data
  (`AgentsListView.test.tsx` mocks `useAgents` and asserts the badge text). Mock
  the shell — `vi.mock("…/components/app-shell")` — or you inherit the repo
  switcher, theme and router. (2026-08-05)

- **Corrects the symptom in the 2026-08-03 `pnpm build` entry above: the routes
  do NOT go blank. The page renders perfectly and loses only its CSS** — which
  is a much worse failure, because it names the wrong culprit. What you actually
  see is the full app in serif type: correct markup, correct data, every card and
  list in place, links underlined and blue, no dark theme. It reads as "my styles
  broke", so the next twenty minutes go into `styles.ts`, the design tokens, or
  whichever component was touched last — none of which is the cause. The cause is
  that a production build overwrote `client/.next` under a running dev server.
  Two tells that cost seconds instead: the **"1 Issue"** badge bottom-left, and
  in the network log **exactly one 404 on
  `_next/static/css/app/layout.css?v=<timestamp>`** while every other request is
  200. Recovery is unchanged — `rm -rf client/.next` **and** a full restart; the
  running server cannot recover on its own, and reloading the page does nothing.
  (2026-08-06)

- **The `pnpm build` hazard is not "someone forgets" — it is baked into every
  verification checklist in this repo, and prose will not save you.**
  `docs/plans/L03-intent-layer.md` carries the warning twice, in S7 and in the
  end-to-end block ("Stop `pnpm dev` first"), and the stack was still poisoned
  during that very sweep — because the sweep is run as one `typecheck && lint &&
  test && build` chain against a stack that was deliberately left up for manual
  checking. Any checklist ending in `pnpm build` is a loaded gun pointed at a dev
  server that a previous step told you to start. **There is no scratch-directory
  escape hatch on this version** — `next build --distDir .next-verify` fails with
  `error: unknown option '--distDir'` (checked 2026-08-06; `distDir` is a
  `next.config.mjs` key, not a CLI flag, and the config here does not set it). So
  today the only options are: stop the stack, build, restart it; or skip the
  build and lose the one check that catches the webpack `.js`→`.ts` vendor trap.
  Do not rely on remembering — the reminder is already written down twice and was
  still ignored. Making this safe would mean `distDir: process.env.NEXT_DIST_DIR
  ?? '.next'` in `next.config.mjs` so a verification build can be redirected by
  env var; that is untried, and `next.config.mjs` is in the reviewed
  `package-config` group, so it belongs in its own change. (2026-08-06)

- **Deleting an export while `pnpm dev` is running leaves a phantom compile error
  that OUTLIVES the fix, and no gate can see it.** Removing
  `FOCUS_SCROLL_MAX_FRAMES` from `FindingsPanel/constants.ts` and `orderedGroups`
  from `SmartDiffViewer/helpers.ts` took a few seconds, during which the watcher
  compiled a state where the export was gone but the import was not. Next kept
  `Attempted import error: 'orderedGroups' is not exported from './helpers'` in
  its issue counter **after the code was valid again**, so the browser showed an
  error while `pnpm typecheck`, `pnpm lint` and 177 tests were all green — they
  read the final state on disk and know nothing about the watcher's history. The
  tell is that the reported symbol no longer exists in the source at all: `grep
  -rn '<symbol>' client/src` returns nothing. Fix is a dev-server restart, plus
  Cmd+Shift+R in any tab still holding the old page. Do not go looking for the
  bug in the code — there isn't one. (2026-08-08)

- **Neither jsdom nor a non-painting browser pane can observe scrolling, and the
  way each fails invites the opposite conclusion.** jsdom implements no layout
  and no `scrollIntoView`, so every test here asserts *a call*, never a movement.
  Worse, a browser pane with `document.visibilityState === "hidden"` runs no
  `requestAnimationFrame` **and** no `behavior: "smooth"` animation — while a
  manual `el.scrollIntoView({block:"center"})` with no `behavior` works fine,
  which makes "the scroll mechanics are fine, so the app's code path is broken"
  look proven when nothing of the sort was shown. Three consecutive fix rounds on
  `FindingsPanel`'s deep-link scroll were driven off measurements that
  environment could not make. Before concluding anything about scrolling, check
  `document.visibilityState` and whether a bare `requestAnimationFrame` fires at
  all; if it does not, you cannot test this here — it needs a headed browser or
  an `e2e/specs/*.flow.json`. (2026-08-08)

- **A card at index 0 is a false positive for "the deep link worked".**
  `FindingsPanel` renders `defaultExpanded={i === 0}` and `focusIdx` starts at
  `0`, so the first card is expanded and ring-highlighted whether or not the
  focus effect ever ran. Verifying `?finding=<id>` against the first finding in
  the list therefore proves nothing, and it read as a working chain for a while
  here. Always deep-link to a card that is **not** first — the tell is that the
  target's expanded text is longer than its neighbours' while `getComputedStyle`
  on the first card reports `boxShadow: none`. (2026-08-08)

- **`getComputedStyle` in this browser pane returns the PRE-TRANSITION value,
  forever, for any property with a CSS `transition` — and it reads as a
  confirmed bug in the component.** The pane runs with
  `document.visibilityState === "hidden"`, so transitions are queued and never
  advance. `FindingCard` carries `transition: … border-color .12s, box-shadow
  .12s`, so deep-linking `?finding=<id>` measured the focus ring on the WRONG
  card: `getComputedStyle(target).borderTopColor` was `rgb(42,42,42)` while
  `target.style.borderColor` — the specified value React had just written — said
  `var(--warn)`. An hour went into "the focus ring never moves", a fix was
  written for it, and nothing was broken. The disambiguation is two lines:
  `el.style.cssText` (what React set) versus `getComputedStyle(el)` (what this
  pane will admit to), and if they disagree, set `el.style.transition = "none"`
  and re-read — the values snap to correct immediately, which is the proof.
  **Rule: never conclude anything from `getComputedStyle` on a transitioned
  property here.** Companion to the 2026-08-08 scroll entry above: same hidden
  pane, same shape of wrong conclusion. (2026-08-10)

- **A `file:line` deep link pinned to `pr.head_sha` is right in the demo and
  wrong where it matters.** The Blast tab's caller line numbers are computed by
  the server's indexer against `indexed_sha`, which is the repo's default branch
  — NOT the PR head, which is branched from an older commit. A link built on
  `head_sha` lands on whatever text now occupies that line number. The two agree
  exactly when the caller's file is untouched between the two commits, which is
  the common case and is why this ships: it verifies perfectly by hand on the
  demo PR and breaks on a file that moved. Build the URL from the sha the
  numbers came from — `BlastResponse.indexed_sha`, with `head_sha` only as a
  fallback for the degraded path that has no links anyway. (2026-08-13)

- **`scrollIntoView` on a long, lazily-rendered list scrolls to where the target
  WAS.** `?file=<path>` on a 92-file PR looked broken on a freshly opened link and
  fine when clicked from Overview. Cause: the file cards mount before their diff
  bodies, so the effect ran while the target sat ~13 px down, and by the time the
  cards above had rendered it was 22 406 px down — `main` (the scroller, not the
  window) had `scrollTop: 13.5`. Two things fix it together: a `MutationObserver`
  on the list that re-scrolls while the layout settles and disconnects after
  ~2 s, and `scroll-margin-top` on the card for the sticky chrome (214 px here =
  the PR header's 175 + the group header's 31, both `top: 0` in the same
  scroller, measured in the running app). Do not compare against `window.scrollY`
  when debugging this — it stays 0 the whole time. (2026-08-25)


- **A `router.replace` fallback route looks broken in dev for up to 20 seconds,
  and the app's own root route is the control experiment.** `/eval` renders,
  resolves the first agent, calls `router.replace('/eval/<id>')` — and the URL
  stays `/eval` with the pre-data render on screen while Next compiles the target
  route and the `?_rsc=` fetch for it sits pending. The transition commits only
  when that payload lands. Nothing in the browser says "compiling": the tell is
  the dev server log printing `✓ Compiled /eval/[agentId]` followed by
  `GET /eval/<id> 200` while `window.location.pathname` still reports the old
  path. Before debugging your own effect, load `/` — `HomeRedirectView` does the
  identical thing, so if the root route also fails to redirect, the delay is
  dev-mode route compilation (or the wedged tab in the entry below), not your
  code. (2026-08-29)

- **A browser-pane tab can stop hydrating and never recover — and neither
  restarting the dev server nor `rm -rf client/.next` fixes it, because neither
  is the cause.** The page renders perfectly (that is the server HTML), the
  sidebar is lit, styles are intact — and nothing is interactive, because the
  client never boots. The one reliable tell is the network log for that document
  load: only `_next/static/*` chunks, and **not a single request to
  `localhost:3001`**, on a page whose whole job is fetching from it. Do not chase
  it through the server: open a new tab (`tabs_create`) and load the same URL —
  it works instantly. Distinct from the `pnpm build`-over-`.next` failure above,
  which loses CSS and keeps the app working; this one keeps the CSS and loses the
  app. (2026-08-29)

## Codebase Patterns

- **A route-local test's path to `messages/` is EIGHT levels up, and getting it
  wrong fails at import time with no hint of the right depth.** From
  `src/app/repos/[repoId]/pulls/[number]/_components/<Name>/`, the correct import
  is `"../../../../../../../../messages/en/<ns>.json"`. Seven `../` (the
  intuitive count, stopping at `src/`) produces
  `Failed to resolve import … Does the file exist?` and nothing suggests the
  fix. Copy the specifier from a sibling — `RunTraceDrawer.test.tsx` has it
  right — rather than counting. (2026-08-06)

- **`@testing-library/user-event` is NOT a dependency of this package; every test
  here uses `fireEvent`.** `package.json` carries only `@testing-library/react`
  and `jest-dom`. The `react-testing-library` skill says "always `userEvent`,
  never `fireEvent`", so following it literally produces
  `Failed to resolve import "@testing-library/user-event"`. Either add the
  package deliberately as its own change, or use `fireEvent` and say why in the
  test — do not add it as a side effect of writing one test. (2026-08-06)

- **A denormalized count is invalidated by the OTHER feature's mutation, and the
  hook that owns it usually lives in a different file.** `GET /agents` carries
  `skills_count` and `GET /skills` carries `used_by`, but the mutation that
  changes both — `useSetAgentSkills` — is in `lib/hooks/skills.ts`, so it has to
  invalidate `["agents"]` as well as its own keys. Same for `useDeleteSkill`:
  deleting a skill unlinks it everywhere, so every agent's count moves. The
  symptom of getting this wrong is not an error — it is a stale number that
  looks right until you reload, which is exactly the kind of thing a demo
  surfaces and a test does not. When you add a denormalized field to a list
  endpoint, grep for every mutation that can change it and invalidate from
  there. (2026-08-05)

- The Zod contracts under `src/vendor/shared/**` are **hand-copied from
  `server/src/vendor/shared/**`, and there is no re-vendor script.** A field
  added on the server but not mirrored here fails silently: this package
  type-checks against its own stale copy, so the API sends the field and the
  component reads `undefined`. If a value the server "definitely returns" is
  missing, diff the two folders before debugging anything else. (2026-07-28)

- A component used by **more than one route level** belongs in
  `src/components/<kebab-name>/`, not in a `_components/` folder (which is
  route-local) and never in `src/vendor/ui` (vendored, do-not-touch). It still
  ships the full set — `Component.tsx`, `helpers.ts`, `styles.ts`, `index.ts`,
  `Component.test.tsx`. `run-cost-badge/` is the current example: the PR list and
  three places on the PR detail page all render it. (2026-07-28)

- **Supersedes the `index.ts` part of the 2026-07-28 "full set" note above.** The
  new `.claude/skills/frontend-architecture` skill forbids adding barrel files, so
  a promoted component ships `Component.tsx` + `Component.test.tsx` and then only
  the `helpers.ts` / `styles.ts` / `constants.ts` it actually has content for —
  no new `index.ts`, and import the component file directly
  (`@/components/run-cost-badge/RunCostBadge`). Existing `index.ts` files stay;
  removing them is a separate migration, not a side effect. Note also that the
  "ships a test" rule is aspirational, not descriptive: only `run-cost-badge/` and
  `severity-counters/` of the eight folders in `src/components/` have a
  `*.test.tsx`, so the other six are debt, not a precedent to copy. (2026-08-02)

- Anything derived from an agent run — cost, tokens, duration, the timeline —
  is **empty on freshly seeded data**, because `pnpm db:seed` inserts a review
  but no `agent_runs` row. Expect the "—" state locally until you actually run a
  review; browser e2e flows can only assert that empty state. (2026-07-28)

- **On the PR detail page the tab labels do not match the tab keys, and almost
  everything lives under one tab.** `?tab=overview` renders `OverviewTab`, which
  is *only* `pr.body` — it looks broken on a PR opened without a description, and
  that is not a bug. The tab labelled **"Agent runs"** is `?tab=findings`: it
  holds `RunHistory` (the timeline) and, below it, one `ReviewRunAccordion` per
  review — and the accordion is where `VerdictBanner` and `RunCostBadge` render.
  Only the newest accordion is `defaultOpen`, so the banner is below the fold and
  needs a scroll. Anything looking for the verdict or the cost badge must go to
  `?tab=findings` and scroll, not to Overview. (2026-07-28)

- **The run trace drawer is URL-driven**: `page.tsx` reads `search.get("trace")`,
  so `?tab=findings&trace=<runId>` opens it directly. Prefer that over hunting
  for the per-row icon in the timeline when scripting or deep-linking. (2026-07-28)

- The Agent Runs timeline's per-run severity chips are a **client-side join,
  not server data**: `RunSummary` carries only `findings_count`/`blockers`, so
  `FindingsTab` builds `Map<review.run_id, findings>` from the reviews the page
  already fetched and hands it to `RunHistory`. A run row showing the plain
  "N finding(s)" text instead of chips means its review has no joinable entry —
  deleted review or `kind: summary` — which is the designed fallback, not a bug.
  (2026-07-31)

- **Verifying Smart Diff needs a PR whose findings' `file` actually exists in
  `pr_files`, and the obvious candidate usually fails that.** `/pulls/:id/smart-diff`
  joins findings onto files BY PATH, so a PR whose stored file list does not
  contain a finding's path renders zero badges and zero line rails — on a PR the
  UI simultaneously advertises as having 13 findings, which reads as a broken
  client. Measured: `teplyakoff/dev-digest` #5 shows "Files changed 178" but has
  100 `pr_files` rows, and all six finding paths were absent from them, so the
  endpoint returned `core 52 files, 0 findings`. Check before picking a fixture:
  `select f.file, exists(select 1 from pr_files pf where pf.pr_id=… and
  pf.path=f.file) from findings f join reviews rv on rv.id=f.review_id where
  rv.pr_id=…`. #2 (`scripts/notify-review-done.ts`, 19 findings on one file,
  5 CRITICAL) is the good fixture — mixed severities on a single file also make
  it the one that can tell "most severe" apart from "first in the array".
  (2026-08-10)

- **A new `lib/hooks/<domain>.ts` must NOT be re-exported from `hooks/index.ts`.**
  The barrel has five `export *` lines baselined in `eslint-suppressions.json`;
  a sixth is a fresh `no-restricted-syntax` error ("No new barrel files —
  frontend-architecture §12") and `pnpm lint` fails, which is the baseline
  working as designed rather than something to re-baseline. Import the module
  directly (`@/lib/hooks/intent`). Cross-domain reach between hook modules is
  fine and has precedent — `skills.ts` imports `invalidateAgents` from
  `./agents`, and `reviews.ts` now imports `invalidatePrIntent` from `./intent`
  — as long as it is the NAMED INVALIDATOR that crosses, never the query key.
  (2026-08-10)

- **A style spread in JSX is an inline style as far as `pnpm lint` is
  concerned** — `style={{ ...s.chip, ...accentFor(depth) }}` is two
  `no-restricted-syntax` errors ("Inline style object. Move it to this folder's
  styles.ts"), not zero, and it type-checks and renders fine until lint runs.
  The sanctioned shape is a function in `styles.ts` that returns the WHOLE
  computed style: `chipStyle(depth)`, alongside the existing `swatchFor`
  (`SmartDiffViewer/styles.ts`) and `toggleButtonFor` (`DiffTab/styles.ts`).
  Same rule, same fix, and it also stops the object being a new reference every
  render. (2026-08-13)

- **`MonoLink` with no `href` renders a `<button>`, so "no URL available" must
  not go through it at all.** The Blast tab has a real case: with no repo
  `full_name` loaded there is no correct GitHub URL to build, and passing
  `href={undefined}` would offer the reviewer a clickable affordance that does
  nothing. Render a plain `<span className="mono">` with the same text instead —
  the information is still there, the promise of a click is not. Extends the
  2026-08-05 entry on `MonoLink` switching primitive by prop: that one is about
  not wrapping it in `next/link`, this one is about not reaching for it when
  there is no destination at all. (2026-08-13)

- **A list row that gains a server-computed field needs every mutation that can
  change it to invalidate that list — including mutations keyed by something
  else.** `ContextDoc` gained `agents` (how many agents receive the document);
  attaching is `useSetAgentContextDocs` / `useSetSkillContextDocs`, keyed by
  agent and by skill, which correctly `setQueryData` on their own keys and
  touched nothing else. The API returned `agents: 1` and the row kept saying
  "no agents" until a reload. Those hooks know no repo id, so the invalidation is
  by prefix (`["context-docs"]`) through a named private helper, per
  frontend-architecture §10. Caught by clicking in the running app; every unit
  test was green, because each hook did exactly what its own test asserted.
  (2026-08-25)


- **Renaming a route is not finished when the routes compile: `grep` the app for
  the old path, because a stale in-app link still WORKS.** Moving the eval
  dashboard from `/evals` to `/eval/:agentId` left `<Link href="/evals">` in
  `EvalsTab.tsx` — and since `/evals` was kept as a redirect, nothing failed, no
  test went red, and the only symptom was that "View dashboard" on one agent's
  tab opened a *different* agent's metrics (the first in the list). A redirect
  that keeps old bookmarks alive also keeps every stale internal link alive, so
  the compatibility route is exactly what hides the work. The sweep is
  `grep -rn '/old-path' client/src`, before the commit, and the deep-linkable
  form is usually the point of the rename: `/eval/${agent.id}`, not `/eval`.
  (2026-08-29)

## Tool & Library Notes

- **`next build` runs ESLint through its own runner, which does NOT read
  `eslint-suppressions.json`.** So the moment an `eslint.config.mjs` exists here,
  every build fails on the pre-existing inline-style and barrel violations that
  the lint lane deliberately accepts. Fix already applied:
  `eslint: { ignoreDuringBuilds: true }` in `next.config.mjs`. Linting lives in
  `pnpm lint` and the `lint` CI workflow — do not turn it back on in the build
  unless the suppressions are gone. (2026-08-03)

- **The lint baseline is a ceiling, not a quota.** `eslint-suppressions.json`
  records 148 pre-existing violations (inline `style={{}}`, barrel `index.ts`).
  ESLint's default is to FAIL when a suppressed violation no longer occurs, which
  would break the build every time someone improves something — so `pnpm lint`
  passes `--pass-on-unpruned-suppressions`. Lower the counts deliberately with
  `pnpm lint:baseline`, never to make a build pass. (2026-08-03)

- `_assets/DevDigest Design (standalone).html` is a **self-unpacking bundle, not
  markup** — grepping it for `cost`, `token` or any class name finds nothing. The
  React sources are gzip+base64 inside `<script type="__bundler/manifest">` on
  line 170, keyed by UUID; the HTML/CSS shell is a JSON string on line 178.
  Decode a module with:
  `python3 -c "import json,base64,gzip;L=open(F).read().split(chr(10));m=json.loads(L[169]);v=m[UUID];d=base64.b64decode(v['data']);print((gzip.decompress(d) if v['compressed'] else d).decode())"`.
  Useful UUIDs: `34082cc0-…d5f7` = `primitives.jsx` (Badge, CostBadge,
  CircularScore), `e843ac29-…0bed` = `screen_dashboard.jsx` (PR list),
  `5dd941dc-…815d` = `prdetail_runs.jsx`, `f798d8ad-…ff8a` = `screen_trace.jsx`.
  These are the visual source of truth when porting a screen. (2026-07-28)

- **`MonoLink` with no `href` renders a `<button>`, so wrapping it in a
  `next/link` nests a button inside an anchor.** The `href` prop is not "the
  same link, typed" — it switches the primitive to an `<a target="_blank">`,
  which is wrong for in-app navigation. For an internal destination pass
  `onClick={() => router.push(...)}` and let the button be the control;
  `SkillStatsTab` navigates to `/agents/:id?tab=skills` that way. Read the
  vendored primitive before composing it — several in `src/vendor/ui/primitives`
  change element type based on which props are set. (2026-08-05)

- **Extends the 2026-07-28 design-bundle decode entry: L02 ships a SECOND bundle
  with different UUIDs, and the line-170 recipe does not open it.**
  `_assets/L02/DevDigest Design (standalone) (3).html` is the source of truth for
  anything L02, and its manifest is not on the same line — find it with a regex
  on `<script type="__bundler/manifest">` instead of indexing line 169, then
  decode entries the same way (base64 → gzip). Useful UUID prefixes in that file:
  `d71d023c` = `chrome.jsx` (the sidebar `NAV`, which is where the WORKSPACE /
  SKILLS LAB split is specified), `2d3fde59` = `screen_skills.jsx`
  (`SkillStatsTab`, `SkillCard`), `09ba214d` = `screen_agents.jsx`,
  `729ddc3e` = `screen_conv_conf.jsx`. The module names are in a leading comment
  on line 1 of each decoded blob, not in the manifest. (2026-08-05)

- **React 19 flushes passive effects INSIDE RTL's synchronous `render()`, so a
  spy attached after `render()` never sees an effect that fires on mount.**
  `ReviewRunAccordion.test.tsx` attached a per-element `scrollIntoView` spy after
  rendering and failed with `expected "spy" to be called 1 times, but got 0
  times` — which reads as "the component never scrolls" and is wrong. It cost a
  wrong fix first: the production code was wrapped in `requestAnimationFrame` to
  make the test pass, which then silently dropped the scroll in any backgrounded
  tab. Attach the spy to `Element.prototype` in `beforeEach`, before `render()`,
  and `delete` it in `afterEach`. A test's spy-attachment order must never
  dictate when production code runs. (2026-08-08)

- **next-intl needs explicit ICU plurals — `"{count} findings"` renders `1
  findings`.** The form that works is
  `"{count, plural, one {# finding} other {# findings}}"`, and `#` is the
  placeholder inside a plural arm, not `{count}`. This bit four keys in
  `messages/en/` at once (`smartDiff.filesCount`, `findingsBadge`, `summary`, and
  `diffViewer.findingsBadge`) because the singular case only appears when real
  data happens to produce exactly one. Nothing type-checks it: a missing plural
  arm is a runtime string, not an error. Grep `"{count}` in `messages/` when
  adding a counted noun. (2026-08-08)

- **`borderColor` IS a shorthand, and pairing it with `borderLeftColor` makes
  React warn on every rerender.** `FindingCard/styles.ts` carried a comment
  saying "All-longhand (never mix `border` shorthand with `borderLeft`…)" while
  the line below it did exactly that with the colour shorthand — so the author
  knew the rule, fixed `border`, and missed `borderColor`. The tell is in this
  suite's own output: "Updating a style property during rerender (borderColor)
  when a conflicting property is set (borderLeftColor) can lead to styling bugs",
  printed by `FindingsPanel.test.tsx` and read as noise for months. Write all
  four (`borderTopColor` / `borderRightColor` / `borderBottomColor` /
  `borderLeftColor`). Note jsdom does not model the collision, so no rendering
  assertion can fail on it — the guard that works is structural, and
  `FindingCard.test.tsx` now asserts `s.card(...)` has no `borderColor` key.
  (2026-08-10)

- **Supersedes the 2026-07-28 entry claiming the Zod contracts under
  `src/vendor/shared/**` are "hand-copied … and there is no re-vendor script".**
  That is now false and actively harmful: `scripts/vendor-shared.sh` exists, it is
  the only sanctioned way to update the client copy, and `--check` runs as the
  `vendor-sync` gate in `gates.sh` (and in the `lint` workflow), so **hand-copying
  is precisely what fails CI**. The flow is: edit `server/src/vendor/shared` (the
  source), run `./scripts/vendor-shared.sh`, and commit **both** copies in the same
  change — a change set where only one side moved is a gate failure, which is why
  the edit and the re-vendor must be one step rather than two. The old entry's
  underlying warning still holds in spirit (a drifted copy fails silently at
  runtime, not at typecheck), but its prescription — "diff the two folders by
  hand" — has been replaced by `bash scripts/vendor-shared.sh --check`.
  (2026-08-27)

- **The vendored `LineChart` fills a missing series entry with `?? 0`
  (`src/vendor/ui/charts/LineChart.tsx:33`), so it cannot render an "unknown"
  data point.** Anything whose metric is legitimately unknown — an eval batch whose
  denominator was zero, a run that errored — is drawn as a catastrophic-looking
  zero instead of a gap. `src/vendor/ui/**` is frozen, so the fix is not to edit
  it: the L06 dashboard hand-draws a small inline SVG that breaks the polyline at
  an unknown point and centres a lone point rather than dividing by zero. That also
  avoids pulling `recharts` (imported by nothing but the showcase) onto a new
  route. Before reusing a vendored chart for a nullable metric, read how it
  coerces a missing value. (2026-08-27)

## Recurring Errors & Fixes

- `Attempted import error: 'X' is not exported from './Y'` in the browser while
  `pnpm typecheck`, `pnpm lint` and `pnpm test` are all green → a stale Next dev
  compile, not a bug. Confirm with `grep -rn 'X' client/src` returning nothing,
  then restart the dev server and hard-reload the tab. See the fuller entry under
  *What Doesn't Work*. (2026-08-08)

## Session Notes

- **2026-07-27** — First local boot. Next.js dev server came up on :3000 and
  rendered the seeded repo; no client-side work done yet.

- **2026-07-28** — Built the L01 Run Cost Badge UI: `RunCostBadge` in
  `src/components/run-cost-badge/`, mounted on the PR list (COST column), the PR
  detail page (verdict banner, timeline row, run accordion header) and the run
  trace drawer (COST stat tile). Format rule that matters: a typical OpenRouter
  run costs ~$0.0016, so the formatter drops to four decimals below a cent —
  `toFixed(2)` would have rendered every real run as "$0.00".

- **2026-08-03** — Architecture pass driven by the `frontend-architecture` and
  `react-best-practices` skills. Added `eslint.config.mjs` (data-hook ownership,
  env boundary, no new barrels, no new inline styles) with the 148 pre-existing
  violations baselined into `eslint-suppressions.json`. Added the app's first
  React error boundary — `src/app/error.tsx` → `_components/RootErrorView/` —
  which `nextjs.md` §8 had flagged as a real gap rather than a deliberate
  absence. Thinned two drifted pages to a single import each (root 49→8,
  PR detail 185→9) into `HomeRedirectView` / `PrDetailView`. Query keys are now
  module-private in `lib/hooks/reviews.ts` behind `useInvalidatePrRuns`. The
  unplanned discovery was the webpack `.js`→`.ts` resolution trap above, found
  only because `pnpm build` was run — `typecheck` and `test` never see it.

- **2026-07-31** — L01 rework: severity counters. `SeverityCounters` +
  `FindingsPopover` in `src/components/severity-counters/`, on the PR list
  (FINDINGS column + hover popup), the timeline rows (chips + blockers suffix)
  and `FindingsPanel` (toggle filter chips composing with hide-low-confidence).
  The predicted `common`-namespace fan-out from the 2026-07-28 entry landed
  exactly as warned — `RunHistory.test.tsx` had to add `common` to its messages.

- **2026-08-06** — L03 Intent Layer UI. `IntentCard` at the top of
  `?tab=findings` (the tab labelled "Agent runs"), `usePrIntent` /
  `useDeriveIntent` joining `lib/hooks/reviews.ts`, and an "Intent" prompt block
  in the trace drawer. `FindingsTab` owns the hooks and passes results down, so
  the card stays presentational and the tab gains zero props — it already takes
  14. The footer naming the model, the sources used and what could NOT be read is
  entirely invented: the design bundle's INTENT mock is
  `{intent, in_scope, out_of_scope}` only, and without that line a thin
  derivation and a well-sourced one render identically. `pnpm build` after: the
  shared First Load JS stayed at 102 kB, so the type-only contract import held.

- **2026-08-05** — L02 mentor-feedback pass. Split the sidebar into WORKSPACE and
  SKILLS LAB in `src/vendor/ui/nav.ts` (the design had it that way all along, and
  both `/skills` and `/agents` already said "Skills Lab" in their breadcrumbs);
  `nav-registry.test.ts` now pins section membership as well as routes, and the
  command palette picked up the grouping for free because `useShellCommands`
  already maps `group: g.section`. Fed `AgentCard`'s dormant skill-count badge
  from the new `Agent.skills_count`, and added the skill editor's fourth tab,
  Stats — usage and token cost only. The design's pull-frequency and accept-rate
  tiles were left out rather than stubbed: nothing links a finding to the skill
  that caused it.

- **2026-08-08** — L03 homework, Smart Diff client lane. Built `useSmartDiff`
  with a named invalidator, one optional `smart?` capability on the shared
  `FileCard`/`CodeLine`, a route-local `SmartDiffViewer` behind a URL-bound
  toggle, and the finding → Agent-runs click chain. `DiffViewer.tsx` was left
  untouched on purpose, which is what makes "no findings in original mode" a
  type-system property rather than a runtime flag. Two decisions overrode the
  plan after live evidence: the toggle keeps `router.replace` while opening a
  finding uses `router.push`, because Back could not otherwise return to
  `?tab=diff&view=smart`; and the client's `ROLE_ORDER` re-sort was deleted so
  the server owns group order alone. Most of the session's cost went to a scroll
  that could not be observed in either available environment — see the two
  entries under *What Doesn't Work*; the honest outcome is that every other link
  of the chain is confirmed in the live app and the scroll is not.

- **2026-08-10** — L04 mentor-feedback pass on the L03 work. Three items: the
  Smart Diff file-header findings badge went nowhere (it called `setOpen(true)`,
  so the most prominent finding affordance was the only one that did not
  navigate — it now routes to the file's `mostSevere` finding, the same rule that
  colours a line's rail); `IntentCard` moved from `FindingsTab` to `OverviewTab`,
  which owns the hooks so the card stays presentational; and the hooks were
  renamed and split out to `lib/hooks/intent.ts` as `usePullIntent` /
  `useRecalculateIntent`, mirroring the server's `modules/intent/`. The badge
  needed its own accessible name (`diffViewer.openFileFindings`) — reusing
  `openFinding` gave two buttons the identical name whenever the badge and a line
  tag pointed at the same finding. The whole chain was confirmed in the live app
  on PR #2 at three different card positions (index 0, 1 and 2), which matters
  because index 0 is the false positive the 2026-08-08 entry warns about. The
  session's real cost was an hour spent "fixing" a focus ring that was never
  broken — see the `getComputedStyle` entry under *What Doesn't Work*; the
  `borderColor` shorthand change it produced was kept on its own merits, with the
  comment rewritten to say no misrender was ever observed.

- **2026-08-13** — L04 homework, Blast Radius client lane. New `BlastTab`
  (`_components/BlastTab/`, no `index.ts`) plus `lib/hooks/blast.ts`, which is
  deliberately absent from the hooks barrel. The `blast` next-intl namespace
  already existed in the starter and was extended rather than replaced. The tab
  renders three states off `data.status` and never off array emptiness — the
  whole point is that `degraded` and "no callers found" produce identical empty
  arrays and mean opposite things, so `BlastTab.test.tsx` asserts that the
  degraded state does NOT show the empty-result copy.

- **2026-08-27** — L06 homework, client lane. An Evals tab on the agent editor, a
  new `/evals` dashboard with run history and a two-run compare, and a one-click
  "turn this finding into an eval case" action on `FindingCard`. Three placement
  decisions worth remembering: the action took its own `onCreateEvalCase` prop
  rather than widening `FindingActionKind` (that union is server verbs that mutate
  the *finding*, and widening it would make `POST /findings/:id/create_eval_case`
  type-legal); `toast.tsx`'s message type was widened to `ReactNode` so the success
  toast could carry a real anchor, rather than faking one with link-looking text;
  and the vendored `Modal` has neither a focus trap nor an Escape handler, so both
  live in `EvalCaseEditor` and `RunCompare` instead of in the frozen primitive.
  First Load JS held at the 102 kB baseline throughout — every contract import is
  type-only.

- **2026-08-29** — L06 mentor-feedback pass, client lane. The eval dashboard moved
  from `/evals` (agent in `useState`) to `/eval/:agentId` (agent in the segment),
  with `/eval` falling back to the first agent and replacing the URL, `/evals`
  kept as a `redirect()` page, and the picker calling `router.push` so Back walks
  back. Three things worth remembering: the view stays in `app/eval/_components/`
  even though two route files import it, because both live under `app/eval/**`
  and a descendant importing an ancestor's component is explicitly not promotion
  (`frontend-architecture` §14); `useParams()` types a segment as
  `string | string[]`, so the "no segment vs some segment" narrowing is
  `typeof rawId === "string" ? rawId : null` rather than a generic argument; and
  the `/evals` alias is a 307 `redirect()` on purpose, not `permanentRedirect()`,
  whose 308 the browser caches for good on a route that may move again.

## Open Questions

_(no entries yet)_
