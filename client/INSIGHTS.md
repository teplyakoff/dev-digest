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

- On **pnpm 11**, every `pnpm <script>` in this package fails before running
  anything, with `ERR_PNPM_IGNORED_BUILDS`. pnpm 11 flipped `strictDepBuilds` to
  true, so the automatic pre-run dependency check refuses to pass while any
  dependency's build script is undecided. The fix is `pnpm-workspace.yaml` with
  an `allowBuilds:` map (`esbuild` and `sharp`, both `false` — each ships a
  prebuilt binary via optionalDependencies). A `pnpm` field in `package.json`,
  `strict-dep-builds` in `.npmrc`, and the `npm_config_*` env vars are all
  ignored in pnpm 11 — only `pnpm-workspace.yaml` is read. (2026-07-27)

## Codebase Patterns

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

## Tool & Library Notes

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

## Recurring Errors & Fixes

_(no entries yet)_

## Session Notes

- **2026-07-27** — First local boot. Next.js dev server came up on :3000 and
  rendered the seeded repo; no client-side work done yet.

- **2026-07-28** — Built the L01 Run Cost Badge UI: `RunCostBadge` in
  `src/components/run-cost-badge/`, mounted on the PR list (COST column), the PR
  detail page (verdict banner, timeline row, run accordion header) and the run
  trace drawer (COST stat tile). Format rule that matters: a typical OpenRouter
  run costs ~$0.0016, so the formatter drops to four decimals below a cent —
  `toFixed(2)` would have rendered every real run as "$0.00".

- **2026-07-31** — L01 rework: severity counters. `SeverityCounters` +
  `FindingsPopover` in `src/components/severity-counters/`, on the PR list
  (FINDINGS column + hover popup), the timeline rows (chips + blockers suffix)
  and `FindingsPanel` (toggle filter chips composing with hide-low-confidence).
  The predicted `common`-namespace fan-out from the 2026-07-28 entry landed
  exactly as warned — `RunHistory.test.tsx` had to add `common` to its messages.

## Open Questions

_(no entries yet)_
