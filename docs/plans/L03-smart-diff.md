# L03 homework — Smart Diff

**Request:** Sort a PR's changed files by risk so the reviewer sees business
logic before lock-files and generated code. Classify every path into **Core
logic**, **Wiring** or **Boilerplate** deterministically, serve it from a new
`GET /pulls/:id/smart-diff`, render it as a toggleable mode of the *Files
changed* tab with per-line finding overlays, and make a click on a finding
navigate to that finding's card in the *Agent runs* tab. Spend zero tokens
doing it.

Companion to [`L03-intent-layer.md`](L03-intent-layer.md) and
[`L03-agents.md`](L03-agents.md) — the lesson's own work. This file is the
**homework**, so its evidence lands in `docs/results/l03-homework/`, not in
`docs/results/l03/`, which is the Intent Layer's.

**Packages:**

| Package | Manager | What it gets |
|---|---|---|
| `server/` (`@devdigest/api`) | **pnpm** | new `modules/smart-diff/`, the contract (source of truth), four test files |
| `client/` (`@devdigest/web`) | **pnpm** | `useSmartDiff`, one optional capability prop on the shared diff-viewer, `SmartDiffViewer`, the click chain |
| `demo/` (`@devdigest/demo`) | **npm** | `record-smart-diff.ts` — **spends real money** |
| repo root | — | `scripts/verify-l03.sh` |
| `reviewer-core/`, `e2e/` | — | untouched (see *Out of scope*) |

Produced by the `planner` agent over two briefs gathered in the same session —
a decode of the L02 design bundle and a repo pass — then extended with the
mentor's `verify:l03` addendum. No model call is added anywhere in this change.

---

## Approach

Add `server/src/modules/smart-diff/` as its own feature module
(`constants.ts` → `classify.ts` → `service.ts` → `routes.ts`), following
`modules/intent/` — the immediately preceding lesson's module — exactly. The
service reads three things that already exist on the DI container
(`reviewRepo.getPull` for tenancy, `.getPrFiles`, `.reviewsForPull`), joins
persisted findings to persisted PR files by path, classifies each path with a
pure function driven by a constants file, and returns the already-committed
`SmartDiff` Zod contract extended additively with the finding **id** that the
click-through requires. No LLM adapter is reachable from the module, no DB
table, no migration, no `reviewer-core` change.

On the client, `?tab=diff` gains a URL-bound `view=smart|original`. Smart mode
renders a new route-local `SmartDiffViewer` that owns grouping, ordering,
collapse policy and badges — but **does not own diff-line rendering**: it
composes the existing shared `FileCard` through one new optional `smart?` prop.

This is **assembly, not greenfield.** The `SmartDiff` contract
(`brief.ts:98-131`), its `SmartDiffResponse` alias (`review-api.ts:136-138`),
the client type re-export (`lib/types.ts:35`) and a full `smartDiff.*` i18n
namespace (`messages/en/prReview.json:53-62`) all exist today with zero callers,
and `modules/index.ts:24` names "intent/smart-diff" as the expected pairing.
Nothing anywhere implements it: a repo-wide grep for a file classifier
(`boilerplate|wiring|lockfile|generated file|classify` over `reviewer-core/src`
and `modules/repo-intel`) returns nothing, so `classify.ts` is genuinely new.

---

## Constraints in force

### Invariants this change could break

| Invariant | How this change could break it |
|---|---|
| **Grounding is mandatory; the score recomputes from survivors** | Not engaged — Smart Diff **reads** persisted findings and never writes, re-scores or filters them. If a step starts computing a score, it has left the plan. |
| **`INJECTION_GUARD` runs on every review path** | Not engaged — no new review path, no prompt, no model call. State this in the PR body; an unguarded new review path is a BLOCKER, and a reviewer must see at a glance that no path was added. |
| **Every query is scoped by the tenant key** | `reviewRepo.reviewsForPull(prId)` and `.getPrFiles(prId)` take **only `prId`**. Tenancy comes from calling `getPull(workspaceId, prId)` FIRST and throwing `NotFoundError` if it misses. Skipping that is a cross-workspace data leak, not a style issue. Pattern to copy: `reviews/service.ts:161-163`. |
| **Migrations do NOT run on boot** | Not engaged — no migration. |
| **`*.it.test.ts` = DB-backed** | The route test MUST be named `smart-diff.it.test.ts`; the classifier test must NOT be, or it drags Docker into the fast lane. |
| **A changed Zod contract needs both vendored copies moved together** | S1 changes `server/src/vendor/shared/contracts/brief.ts`. `./scripts/vendor-shared.sh --check` runs in the `lint` workflow and the pre-PR gate. |

### INSIGHTS.md — the entries that bind

**`server/INSIGHTS.md`**

1. **Seeded PR files carry `patch: null`** (2026-07-28). Grouping, ordering,
   counts and badges work on seed data, but **every finding falls into the
   unanchorable fallback** because no lines render. The line-rail overlay can
   only be demonstrated against a genuinely imported repo — which is why S11
   costs money.
2. **A shared helper a SECOND module needs goes onto the container, not into a
   sibling import** (2026-08-06). `container.reviewRepo` is the sanctioned route
   and already exposes all three reads this feature needs.
3. **`pnpm lint` enforces the onion rings, and six violations are exempted in
   the code with a written reason** (2026-08-03). Do not add a seventh.

**`client/INSIGHTS.md`**

1. **`pnpm build` while `pnpm dev` runs poisons `client/.next`** (2026-08-06) —
   the app renders perfectly and loses only its CSS. See *End-to-end
   verification*.
2. **A route-local test's path to `messages/` is EIGHT `../`**, and
   **`@testing-library/user-event` is NOT a dependency here — every test uses
   `fireEvent`** (both 2026-08-06). Both override the `react-testing-library`
   skill.
3. **Importing a VALUE (not a type) from `@devdigest/shared` fails only in
   `pnpm build`**, and one Zod schema costs ~15 kB First Load JS on every route
   (both 2026-08-03). Every contract shape here is imported with `import type`.

Also binding: **`MonoLink` with no `href` renders a `<button>`; passing `href`
switches it to `<a target="_blank">`**, which is wrong for in-app navigation
(2026-08-05). The click-through must not go to GitHub; this is the primitive
that would silently send it there.

**`demo/INSIGHTS.md`**

1. **Do not run any package's test suite while a recording is in flight** —
   `buildApp` reaps orphan runs against the ambient `DATABASE_URL` and marks the
   live `running` row `failed`. It cost a billed run on 2026-08-06.
2. **`waitFor` passing does not mean the line is on screen** — *wait, scroll,
   settle, shoot*.
3. **Some states a recorder cannot manufacture** — say so in the recorder's
   output rather than faking the scene.

### Frozen paths in range

| Path | What to do instead |
|---|---|
| `client/src/vendor/shared/**` | Generated. Edit `server/src/vendor/shared/contracts/brief.ts`, run `./scripts/vendor-shared.sh`, commit both. |
| `client/src/vendor/ui/**` | Frozen, no in-repo source. `SeverityBadge`, `Chip`, `Badge`, `Icon`, `SectionLabel`, `Button` are consumed as-is. If a visual is impossible without editing a primitive, build it in app code. |
| `server/src/db/migrations/*.sql` | Not touched — no table, no column. |

### Stale map entry — do not be misled

`.claude/skills/onion-architecture/SKILL.md` §15 lists `modules/pulls/routes.ts`
as a 395-line known violation with "no service, no repository". **That is out of
date**: `pulls/` was extracted to `routes.ts` (57 lines) → `service.ts` →
`repository.ts` → `helpers.ts` on 2026-08-05. Do not "fix" it, and do not treat
it as a precedent for inline Drizzle.

---

## Skill contract

Skills are cited by path. Do not resolve them by name — several plugin skills in
a typical session collide by topic and would import foreign rules.

| Step | Skill | Binding rule for this step |
|---|---|---|
| S1 | `.claude/skills/zod/SKILL.md` | Reuse the existing `Severity` enum from `contracts/findings.ts:11` rather than restating three literals; export the schema **and** its `z.infer` type side by side, the file's own convention from line 98 down. The new fields are **required**, not optional. |
| S2 | `.claude/skills/onion-architecture/SKILL.md` | §3 placement: a pure calculation over in-memory data → ring 0, beside the caller; a literal (limit, threshold, default) → `modules/<feature>/constants.ts`. §11: a sibling constant is still a sibling import — never `../reviews/constants.js`. |
| S3 | `.claude/skills/onion-architecture/SKILL.md` | §7: no SQL, no HTTP, no `process.env`, no SDK in a service — throw `NotFoundError`, let transport map the status. §8: every query scoped by the tenant key. §11: sibling data reaches a feature through the composition root, never through `../reviews/repository.js`. |
| S4 | `.claude/skills/fastify-best-practices/SKILL.md` | Schema-first: declare `params` **and** `response` on the route object so an invalid id is a 422 before the handler body runs. `intent/routes.ts:28-32` is the shape to copy. |
| S4 | `.claude/skills/onion-architecture/SKILL.md` | §9: a handler does exactly three things — parse, delegate, map the status code. §14 smell: `Schema.parse(req.body)` in a handler instead of a schema on the route. |
| S4 | `.claude/skills/security/SKILL.md` | Fires on the added `req.params` read. The rule is narrow and complete: the param is validated by `IdParams` (`_shared/schemas.ts:11`), and the id reads nothing before `getPull(workspaceId, …)` has proved it belongs to the caller's workspace. |
| S5 | `.claude/skills/onion-architecture/SKILL.md` §12 | A use-case test that needs a database is a boundary report. The classifier and the join must be testable with no Docker; only the route test is `*.it.test.ts`. |
| S6 | `.claude/skills/frontend-architecture/SKILL.md` | §10 + §14: every data hook goes through `src/lib/hooks/*`; query keys stay module-private; the cache-bust a caller needs is a **named invalidator**, never an exported key. |
| S6 | `.claude/skills/react-best-practices/SKILL.md` | *Data Fetching*: use the project's existing query primitives. `usePullDetail` (`lib/hooks/core.ts:114-120`) is the minimal shape. |
| S7 | `.claude/skills/frontend-architecture/SKILL.md` | §12: no new barrel `index.ts` — `findings.ts` sits beside `comments.ts`, imported by module path. §14: `src/components/<kebab-name>/` is shared across routes. |
| S7 | `.claude/skills/react-best-practices/SKILL.md` | *Accessibility (HIGH)*: the severity tag is a real `<button>` with an `aria-label` naming the finding. *Derive, Don't Store*: the per-line lookup is computed in render, never mirrored into state. |
| S8, S9 | `.claude/skills/frontend-architecture/SKILL.md` | §14: a route-local component lives in `_components/<Name>/` and ships `Component.tsx` + `Component.test.tsx`, plus only the `helpers`/`styles`/`constants` that have real content — and **no `index.ts`**. User-facing text goes through next-intl. §11: imports may only go up the route tree. |
| S8, S9 | `.claude/skills/next-best-practices/SKILL.md` | `'use client'` belongs on the leaf that owns interactivity. `SmartDiffViewer` holds state and handlers, so it carries the directive itself. |
| S8, S9 | `.claude/skills/react-best-practices/SKILL.md` | *State Management (HIGH)*: **URL-dependent state belongs in URL search params, not component state** — this settles the toggle. *Derive, Don't Store (CRITICAL)*: ordering, totals and badge counts are computed in render. *Key Prop Patterns*: key file rows by `path`, not index. |
| S10 | `.claude/skills/react-testing-library/SKILL.md` | Test behaviour, not implementation; fewer, longer tests. **Two repo overrides win over the skill text:** `fireEvent` not `userEvent` (the package is not a dependency), and the `messages/` import is eight `../` — copy the specifier from `RunTraceDrawer.test.tsx`. |
| S10b | `.claude/skills/security/SKILL.md` | `scripts/*.sh` is the `infra` group: the script takes no user input, interpolates nothing into a command, reads no secret. `ROOT` derives from `BASH_SOURCE`, never `$PWD` or an argument. |
| S10b | `.claude/skills/security/SKILL.md` + `.claude/skills/fastify-best-practices/SKILL.md` | `server/package.json` is the `package-config` group — those files decide what the other checks even do. Add **one** key to `scripts`; touch no dependency and no existing script. |

### Skills that do NOT apply — do not invoke these

| Skill | Why not |
|---|---|
| `.claude/skills/drizzle-orm-patterns/SKILL.md` | No repository, no query, no `drizzle-orm` import. Every read goes through existing `ReviewRepository` methods. **If you find yourself writing `db.select()`, the plan has gone wrong — stop and re-read S3.** |
| `.claude/skills/postgresql-table-design/SKILL.md` | No table, no column, no migration. Computed on read. |
| `.claude/skills/typescript-expert/SKILL.md` | Fires only on `as any`, `@ts-ignore`, `@ts-expect-error` or a new generic. If `as any` becomes tempting to make the `FileCard` `smart?` prop typecheck, that is the signal the prop shape is wrong — fix the shape. |
| `.claude/skills/mermaid-diagram/SKILL.md` | No diagram in the change set. |
| `.claude/skills/onion-architecture/SKILL.md` **on any `client/` file** | Non-negotiable: `onion-architecture` never applies to `client/`; `frontend-architecture` never applies to `server/` or `reviewer-core/`. This plan crosses both packages, which is exactly where the rule gets violated. Never assign both to one file. |

---

## Steps

### S1 — Extend the `SmartDiff` contract with the finding id, severity and large-file flag

- **Files:** `server/src/vendor/shared/contracts/brief.ts` (at the block from
  line 98) · `server/test/contracts.test.ts` (the sample at 112-123)
- New `SmartDiffFinding = z.object({ id: z.string(), line: z.number().int(),
  severity: Severity, title: z.string() })` — `Severity` imported from
  `./findings.js`, not restated.
- `SmartDiffFile` gains `findings: z.array(SmartDiffFinding)` and
  `is_large: z.boolean()`. Both **required**.
- `finding_lines` **stays** — it is in the committed contract and the homework
  names it — documented in a comment as derived: `findings.map(f => f.line)`.
- `pseudocode_summary` is left exactly as-is (`.nullish()`) and stays `null` —
  see *Out of scope*.
- **Then, in the same step:** `./scripts/vendor-shared.sh &&
  ./scripts/vendor-shared.sh --check` — the second run must print
  `vendored contracts are in sync`. Commit both copies together.
- **Verify:** `cd server && pnpm vitest run test/contracts.test.ts && pnpm typecheck`
- **Risk:** making the new fields **optional** to avoid touching the fixture.
  That produces a legal payload where `finding_lines: [28, 52]` coexists with
  `findings: undefined` — the exact drift the single-source join exists to
  prevent. The tell that you took the shortcut: the client needs a `?? []` on
  `file.findings`.

### S2 — The classifier and its constants (pure, no I/O)

- **Files:** `server/src/modules/smart-diff/constants.ts` (new) ·
  `server/src/modules/smart-diff/classify.ts` (new)
- `constants.ts` is the homework's explicit requirement — *"thresholds and
  patterns must live in a separate constants file"*. House style is one exported
  constant per rule with a comment explaining **the reasoning behind the
  number**, not what the number is; `reviews/constants.ts:1-30` is the model,
  `pulls/constants.ts` the short form.
  - `BOILERPLATE_PATTERNS` — `*.lock` and the named lock-files
    (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`), `dist/`, `build/`,
    `.next/`, `coverage/`, `__snapshots__/`, `*.snap`, `*.min.js`, `*.map`,
    `**/vendor/**`, binary-ish extensions.
  - `WIRING_PATTERNS` — `*.config.*`, `tsconfig*.json`, `package.json`,
    `index.ts`/`index.tsx`, `routes.ts`, `**/migrations/**`, `*.d.ts`,
    `.github/workflows/**`, `Dockerfile*`, `docker-compose*`, `scripts/**`,
    **and `*.md`**.
  - **`LARGE_FILE_LINES = 200`** — the per-file highlight threshold. The comment
    cites the one in-repo precedent for "a file this size behaves differently",
    `AUTO_EXPAND_MAX_LINES = 200` in
    `client/src/components/diff-viewer/constants.ts:4`. Do not invent a
    measurement that was not taken.
  - `SPLIT_TOO_BIG_LINES` — the `split_suggestion.too_big` threshold.
  - `ROLE_ORDER = ['core', 'wiring', 'boilerplate'] as const`.
- `classify.ts` — `export function classifyPath(path: string): SmartDiffRole`.
  Evaluation order is **boilerplate → wiring → core**, and the order is
  load-bearing: a lock-file must reach `boilerplate` before `package.json` can
  pull it into `wiring`. Encode that as an explicit comment, and pin it with a
  test.
- **Why `*.md` is `wiring` and not `boilerplate`:** the design's own role
  descriptions are the authority, and `boilerplate` means *"Generated /
  mechanical — skim"*. Hand-written markdown is neither. The asymmetry settles
  it: misclassifying a README as `wiring` costs one slot of ordering, while
  misclassifying a system prompt (`docs/agent-prompts/**`) or an ADR as
  `boilerplate` **collapses it by default** and the reviewer never sees it.
  `wiring` still sorts below `core`, so "business logic first" holds either way.
- **Verify:** covered by S5's classifier test; for now
  `cd server && pnpm typecheck && pnpm lint`
- **Risk:** reaching for a real glob library. Keep to plain string/regex
  predicates — a new server runtime dependency for path matching is not
  justified by this feature, and `pnpm lint` will not catch it.

### S3 — The service: tenancy, the join, the sort, the split suggestion

- **File:** `server/src/modules/smart-diff/service.ts` (new)
- Shape: `export class SmartDiffService { constructor(private container:
  Container) {} async get(workspaceId, prId, log?): Promise<SmartDiff> }` —
  constructor takes the container, exactly as `IntentService` does
  (`intent/routes.ts:25`). `Logger` is the structural type
  `{ info(obj: unknown, msg?: string): void }`, never Fastify's concrete logger
  (onion §5).
- Algorithm, in order:
  1. `const pull = await container.reviewRepo.getPull(workspaceId, prId);
     if (!pull) throw new NotFoundError('Pull request not found');` —
     **tenancy gate, first, always.**
  2. `const files = await container.reviewRepo.getPrFiles(prId)`.
  3. `const reviews = await container.reviewRepo.reviewsForPull(prId)` — already
     newest-first (`reviews/repository/review.repo.ts:66`). Take the **first row
     with `review.kind === 'review'`**; `reviewsForPull` also returns
     `kind: 'summary'` rows, which carry no findings worth joining. No review →
     findings are `[]` and the endpoint still returns a full, useful response.
     This is the homework's "sorting still works before any review".
  4. Join `finding.file === file.path`, mapping each to
     `{ id, line: finding.startLine, severity, title }`. Findings whose `file`
     matches **no** PR file are collected into an `unmatched` count and logged;
     they are never invented into a group.
  5. `role = classifyPath(file.path)`;
     `is_large = additions + deletions > LARGE_FILE_LINES`;
     `finding_lines = findings.map(f => f.line)`, sorted and de-duplicated.
  6. Sort **within** each group: files with findings first, ordered by the
     highest severity present (`CRITICAL` > `WARNING` > `SUGGESTION`), then by
     `additions + deletions` descending, then by `path` ascending. The final
     path tie-break is not cosmetic — it is what makes the demo and the tests
     reproducible.
  7. Emit groups in `ROLE_ORDER`, **omitting empty groups** — an empty section
     renders as dead space.
  8. `split_suggestion = { too_big: totalLines > SPLIT_TOO_BIG_LINES,
     total_lines: totalLines, proposed_splits: [] }`. Always `[]` — see
     *Out of scope*.
- **Done when:** the service compiles with zero imports from `drizzle-orm`,
  `db/schema`, `fastify`, or any `../<sibling>/` path, and `container.llm` is
  never referenced.
- **Verify:** `cd server && pnpm typecheck && pnpm lint` — `pnpm lint` is what
  enforces the onion rings here.
- **Risk:** reaching for `import { PullsRepository } from
  '../pulls/repository.js'` because `listFiles` looks convenient. That is a
  sibling import, it trips the lint lane, and it is unnecessary —
  `container.reviewRepo.getPrFiles(prId)` is the same query and is already on
  the composition root.

### S4 — The route and the module registration

- **Files:** `server/src/modules/smart-diff/routes.ts` (new) ·
  `server/src/modules/index.ts` (exactly **one** import line and **one**
  registry entry, per its own docstring at lines 18-25)
- Shape — copy `intent/routes.ts:23-33` structurally:

```ts
app.get('/pulls/:id/smart-diff',
  { schema: { params: IdParams, response: { 200: SmartDiffResponse } } },
  async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id, req.log);
  });
```

  `SmartDiffResponse` is the existing alias at `review-api.ts:136-138`;
  `IdParams` comes from `../_shared/schemas.js`. **No rate-limit config** —
  unlike `/pulls/:id/intent`, this call costs nothing, and a per-route ceiling
  would misrepresent that.
- The zero-token proof line goes in the **service**, not the route, and is
  factual rather than self-congratulatory:

```ts
log?.info(
  { pr_id: prId, files: files.length, findings: matched.length, unmatched,
    latest_review_id: latest?.review.id ?? null },
  'SMART DIFF: computed from stored PR files + latest review (no model call)',
);
```

  Use Fastify's Pino logger (`req.log`), **not** `RunLogger.tool` — `tool`
  belongs to a run and publishes to the SSE bus (`platform/run-logger.ts:58-61`);
  Smart Diff has no run, and emitting a `tool` event with no run would put a line
  in a trace that no run produced.
- **Done when:** `GET /pulls/<uuid>/smart-diff` returns a `SmartDiff`, and
  `GET /pulls/not-a-uuid/smart-diff` returns 422 before the handler body runs.
- **Verify:** `cd server && pnpm typecheck && pnpm lint`
- **Risk:** registering the plugin under a prefix or in a second place.
  `/pulls/:id/reviews` already lives in `reviews/routes.ts` while `/pulls/:id`
  lives in `pulls/routes.ts`, so a third module owning a `/pulls/:id/*` path is
  established and safe — but only through `modules/index.ts`. Nothing else
  registers routes.

### S5 — Server tests

- **Files:** `server/test/smart-diff-classify.test.ts` (new, hermetic) ·
  `server/test/smart-diff-service.test.ts` (new, hermetic) ·
  `server/test/smart-diff.it.test.ts` (new, Docker-gated) ·
  `server/test/routes-smoke.test.ts` (modified)
- `smart-diff-classify.test.ts` — pure function, local fixture list, no app, no
  container. Model: `server/test/pulls-helpers.test.ts`. Assertions 1-21 of the
  *Test matrix*.
- `smart-diff-service.test.ts` — hermetic, stubbed container. Precedent for the
  stub literal: `repo-intel-resync.test.ts:48` (`{ … } as unknown as Container`).
  Give the stub an `llm()` that **throws**, and assert: the happy path groups,
  orders and joins correctly; **the throwing `llm()` is never called** (the
  machine-checkable half of "no new model call"); a PR with no review still
  returns groups with empty `findings`; a finding whose `file` matches no PR file
  appears in no group; `getPull` returning `undefined` throws `NotFoundError`.
  Assertions 22-29.
- `smart-diff.it.test.ts` — Docker-gated with the
  `const d = hasDocker ? describe : describe.skip` guard from
  `intent.it.test.ts:16-17`, driven by `app.inject`. Assert: 200 with a
  schema-valid body; a PR in **another workspace** 404s; and
  **`select count(*) from agent_runs` is unchanged across the call** — the
  strongest available proof of "no model call", since those rows are created only
  by `ReviewRepository.createAgentRun`, called only from `run-executor.ts`.
- `routes-smoke.test.ts` — one Docker-free case:
  `GET /pulls/not-a-uuid/smart-diff` → 422 with
  `error.code === 'validation_error'` (the existing 422 case at line 56 is the
  template).
- **Done when:** all four pass, and the two hermetic files pass **with Docker
  stopped**.
- **Verify:**
  `cd server && pnpm vitest run test/smart-diff-classify.test.ts test/smart-diff-service.test.ts test/routes-smoke.test.ts test/contracts.test.ts`,
  then with Docker running `pnpm vitest run test/smart-diff.it.test.ts`
- **Risk:** an `*.it.test.ts` that omits an adapter override makes live, billed
  API calls, and the only symptom is a timeout. Smart Diff needs no LLM, so
  override nothing it does not use — but copy `intent.it.test.ts`'s override
  block wholesale rather than assembling a partial one.

### S6 — `useSmartDiff` and its invalidator

- **File:** `client/src/lib/hooks/reviews.ts` (modified)
- Add `smartDiff: (prId: PrId) => ["pr-smart-diff", prId] as const` to the
  module-private `keys` registry (`reviews.ts:33-39`). It stays private.
- `export function useSmartDiff(prId: PrId)`:

```ts
useQuery({
  queryKey: keys.smartDiff(prId),
  queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
  enabled: !!prId,
});
```

  Import `SmartDiff` with **`import type`**. Pass **no** schema to `api.get` —
  no call site in this codebase does, deliberately.
- Add `invalidateSmartDiff(qc, prId)` and expose it as
  `smartDiff: () => invalidateSmartDiff(qc, prId)` on the object
  `useInvalidatePrRuns` returns (`reviews.ts:71-84`).
- **Call it** from `PrDetailView`'s existing `onRunDone` handler
  (`PrDetailView.tsx:161-170`), beside `invalidateRuns.history()`.
- **Done when:** after a review run completes, the Smart Diff badges appear with
  **no page reload**.
- **Verify:** `cd client && pnpm typecheck && pnpm test`
- **Risk:** shipping the invalidator without calling it. An exported invalidator
  with no caller reads as done while doing nothing, and the symptom is a stale
  number that looks right until reload — which a demo surfaces and a test does
  not. The `onRunDone` wiring is part of this step, not a follow-up.

### S7 — Extend the shared diff-viewer with one optional `smart?` capability

- **Files:** `client/src/components/diff-viewer/findings.ts` (new) ·
  `FileCard/FileCard.tsx` · `CodeLine/CodeLine.tsx` · `diff-viewer/styles.ts`
- **`DiffViewer.tsx` is NOT touched.** That is deliberate: the Files tab's
  original mode renders `DiffViewer`, which has no way to receive findings, so
  "findings are not visible in normal mode" is guaranteed by the type system
  rather than by a runtime flag.
- `findings.ts` (beside `comments.ts`, no barrel) exports:

```ts
export interface SmartFileView {
  findings: SmartDiffFinding[];   // this file's findings only
  isLarge: boolean;
  defaultOpen: boolean;
  onOpenFinding: (id: string) => void;
}
export function findingsForLine(ln: Line, byLine: Map<number, SmartDiffFinding[]>): SmartDiffFinding[]
export function partitionFindings(findings, renderedLines: Set<number>): { anchored, unanchored }
```

  `partitionFindings` mirrors `partitionThreads` in `comments.ts`, and it is
  **not** an edge case: seeded PR files carry `patch: null`, so on seed data
  *every* finding is unanchored. Findings of `kind` in
  `{secret_leak, lethal_trifecta, phantom, hook}` also bypass line grounding
  entirely (`reviewer-core/src/grounding.ts:16,64-68`) and may carry a
  `start_line` that no rendered line matches.
- `FileCard` gains exactly one optional prop, `smart?: SmartFileView`, mirroring
  `commenting?: DiffCommentApi` (`FileCard.tsx:33`):
  - open state becomes `React.useState(smart?.defaultOpen ??
    ((additions + deletions) <= AUTO_EXPAND_MAX_LINES))`;
  - the header gains a clickable **"N findings"** badge beside the existing
    comment count, and a **large-file** chip when `smart.isLarge`;
  - unanchored findings render below the lines as chips, mirroring
    `<OutdatedComments/>` (`FileCard.tsx:87`).
- `CodeLine` gains `findings?: SmartDiffFinding[]` and
  `onOpenFinding?: (id) => void`. Anchor on **`ln.newNo`**, matching
  `ln.kind !== 'del'`. This is provable, not assumed: `grounding.ts:22` builds a
  file → **new-side** line set and a diff-finding survives only if
  `[start_line, end_line]` intersects it (`grounding.ts:70-72`), while
  `server/src/adapters/git/diff-parser.ts:63-75` consumes no new-side number for
  deletions — so a grounded diff-finding always lands on an `add` or `ctx` line,
  both of which carry `newNo`. Note `CodeLine.tsx:54` renders
  `ln.newNo ?? ln.oldNo`, so a `del` line shows its **old** number in the same
  gutter; never match on rendered gutter text.
- Render the design's decoration: a 3px full-height left rail in the severity
  colour, plus a right-side tag (severity icon at 11px + label; `CRITICAL`
  renders as the word **"blocker"**, others lowercase). The tag is a real
  `<button type="button">` with an `aria-label` naming the finding title,
  calling `onOpenFinding(f.id)`.
- **Done when:** `<FileCard file={f} />` with no `smart` prop renders
  byte-identically to today.
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Risk:** adding a `findings` prop to `DiffViewer` "for symmetry". It has no
  caller, it widens the surface the Files tab could accidentally light up, and it
  makes the mode separation a runtime concern instead of a structural one.

### S8 — `SmartDiffViewer` and the Files-tab toggle

- **Files:** `_components/SmartDiffViewer/{SmartDiffViewer.tsx, helpers.ts,
  styles.ts, constants.ts}` (new) · `DiffTab/DiffTab.tsx` (modified) ·
  `client/messages/en/prReview.json` (modified)
- **No `index.ts`** in the new folder; `FindingsTab.tsx:8-11` records the
  precedent and why its siblings' barrels are not one.
- `SmartDiffViewer` renders, top to bottom:
  1. **Summary strip** — total files touched, `+N −M`, total findings, total
     changed lines. All derived during render from `data.groups`; no state, no
     effect. The design's `"9 files · +247 −38"` is a hardcoded literal in the
     mock and is **not** a precedent.
  2. **Large-PR banner** when `split_suggestion.too_big`, using the
     already-shipped, currently-unused `prReview.smartDiff.largeTitle`
     (`messages/en/prReview.json:57`). Styled per the design's SplitBanner
     (`--warn` border, `--warn-bg`, `AlertTriangle` 18). Render `largeBody`
     **only** when `proposed_splits.length > 0` — it ends in a colon that would
     otherwise dangle, and today the array is always empty.
  3. **Three group blocks** in `ROLE_ORDER`. Each header is
     `position: sticky; top: 0` with an 8×8 colour swatch, the label, the
     description and a right-aligned file count. **Fix the design's porting bug:
     the sticky header must get `background: var(--bg-primary)` and a `zIndex`,**
     or code rows bleed through it on scroll. Colours: `core` → `var(--accent)`,
     `wiring` → `var(--warn)`, `boilerplate` → `var(--text-muted)`.
  4. Per file, a `<FileCard>` imported by module path (not the top-level
     barrel), with `smart={{ findings, isLarge, defaultOpen, onOpenFinding }}`
     and **no `commenting`** — inline commenting stays a normal-mode capability.
- `defaultOpen` policy: `core` and `wiring` open; `boilerplate` **always
  collapsed, even when it has findings**. Put this in the folder's `constants.ts`
  as `COLLAPSED_ROLES` with the reason in a comment.
- i18n keys to add under `smartDiff`: `coreDesc`, `wiringDesc`,
  `boilerplateDesc` (the design's three descriptions, verbatim), `smartOrder`
  ("Smart order"), `originalOrder` ("Original order"), `findingsBadge`
  ("{count} findings"), `largeFile`, `summary`. **Also change `coreLabel` from
  `"Core"` to `"Core logic"`** — both the design's roles map and the mentor's
  brief say "Core logic". Reuse the existing `filesCount` (line 58) and
  `groupedByRole` (line 61) rather than adding duplicates; `groupedByRole`
  ("Smart Diff · grouped by role") is the section label in smart mode and is the
  repo's own already-committed user-facing use of the string "Smart Diff".
- `DiffTab` gains `view: "smart" | "original"` and `onSetView` props (4 → 6; the
  react-best-practices ceiling is 5-7). The segmented toggle goes in
  `SectionLabel`'s `right` slot, which already hosts the comments button
  (`DiffTab.tsx:44-60`). Original mode renders today's `<DiffViewer>` unchanged;
  its ordering is **alphabetical by path**, matching the design — say so in a
  comment, because the label implies PR order and it is not.
- **Why the toggle is URL-bound (`?tab=diff&view=smart`), overruling the
  design's local `useState`:** the design has no concept of Smart Diff as a mode
  of the Files tab at all, so its local-state choice is not a considered decision
  being overturned. `react-best-practices` puts URL-dependent state in search
  params at HIGH; `PrDetailView` already owns `setParam` and already keeps `tab`
  and `trace` there. The decisive consequence is user-visible: the click-through
  navigates **away** to `?tab=findings`, and with local state pressing Back
  returns the reviewer to the Files tab in **Original order** — the mode is
  silently lost on the feature's most-used interaction. Absent `view` → `smart`.
- **Done when:** on `?tab=diff&view=smart`, Core logic sits on top, boilerplate
  is collapsed, and the lock-file is inside boilerplate.
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Risk:** reaching for `styles.ts` conventions from the wrong neighbour. Every
  `styles.ts` in this route exports **style objects** consumed as `style={s.x}`,
  not class strings. The eslint rule against **new** inline `style={{}}` literals
  in JSX still applies, so put every object in `styles.ts`.

### S9 — The click chain: a finding on a diff line → its card in the Agent runs tab

This is the point most people stumble on, and the only step that touches six
files. Do it as one unit.

- **Files:** `PrDetailView.tsx` · `DiffTab.tsx` · `FindingsTab.tsx` ·
  `ReviewRunAccordion.tsx` · `FindingsPanel.tsx` · `FindingCard.tsx`
- The chain, link by link:
  1. **`PrDetailView` — generalize `setParam` first.** Today `setParam(key, val)`
     (`PrDetailView.tsx:70-75`) sets one key and calls `router.replace`. Opening
     a finding must set `tab` **and** `finding` in one navigation; calling
     `setParam` twice races, because each call reads `search` from the same
     closure and the second overwrites the first. Add
     `setParams(patch: Record<string, string | null>)` doing the whole merge in
     one `router.replace`, and reimplement `setParam` as a one-key wrapper.
     **Do this before anything else in this step** — every later link depends on
     it.
  2. `PrDetailView` gains `const focusFindingId = search.get("finding")` and
     resolves the owning run from data it already holds:
     `runs.find(r => r.findings.some(f => f.id === focusFindingId))?.run_id`
     (`PrDetailView.tsx:79-80`). Both go down to `FindingsTab`.
  3. `PrDetailView` passes
     `onOpenFinding={(id) => setParams({ tab: "findings", finding: id })}` down
     through `DiffTab` → `SmartDiffViewer` → `FileCard` → `CodeLine`.
     **Never `MonoLink` with an `href`** — with `href` it becomes
     `<a target="_blank">` and sends the reviewer to GitHub, which the
     requirement forbids explicitly.
  4. `FindingsTab` already owns `target: {runId, n}` state and a nonce
     (`FindingsTab.tsx:84-87`). Add an effect keyed on `focusFindingId` that
     calls `setTarget({ runId: resolvedRunId, n: n + 1 })`, so an incoming URL
     drives the same mechanism the Timeline already drives. Pass
     `focusFindingId` to each `ReviewRunAccordion`.
  5. `ReviewRunAccordion` already opens and scrolls on `targetRunId` +
     `targetNonce` (`ReviewRunAccordion.tsx:51-58`), and already renders a
     `review-run-<run_id>` element id with `scrollMarginTop: 16`. Add a
     pass-through of `focusFindingId` to `FindingsPanel`.
  6. `FindingsPanel` — the subtle link. The target finding may be hidden by
     `sevFilter` or `hideLow` (`FindingsPanel.tsx:34-42`). In an effect keyed on
     `focusFindingId`: if the target is not in `shown`, reset `sevFilter` to
     `ALL_SEVERITIES_ON` and `hideLow` to `false`; then set `focusIdx` to its
     index in `shown`; then scroll it into view via the panel's own root ref plus
     `[data-finding-id="…"]`, which `FindingCard.tsx:54` already renders for
     exactly this purpose. Do **not** query `document` globally.
  7. `FindingCard` — `defaultExpanded` feeds
     `React.useState(defaultExpanded ?? false)` (`FindingCard.tsx:43`), so it is
     **initial state only** and a later prop change will not expand the card. Add
     `expandNonce?: number` and an effect `if (expandNonce) setExpanded(true)`.
     The existing `focused` prop already drives the highlight ring.
- **Done when,** in one click and with no popup: a severity tag in Smart Diff
  navigates to `?tab=findings&finding=<id>`, the owning run's accordion is open,
  its severity chips are all on, and that finding's card is expanded,
  ring-highlighted and scrolled into view.
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Risk:** the two-`setParam` race in link 1. It fails intermittently and looks
  like a React bug — the tell is that the URL ends up with `finding` but no
  `tab`, or the reverse, depending on render timing.

### S10 — Client tests

- **Files:** `SmartDiffViewer/SmartDiffViewer.test.tsx` (new) ·
  `FindingsPanel/FindingsPanel.test.tsx` (modified) ·
  `FindingCard/FindingCard.test.tsx` (modified)
- `SmartDiffViewer.test.tsx` — one flow test over a local `SmartDiff` fixture:
  groups render in `core → wiring → boilerplate` order; a `pnpm-lock.yaml` file
  lands in boilerplate and its body is **not** in the document; a core file with
  findings is expanded and shows its "N findings" badge; clicking a finding tag
  calls `onOpenFinding` with that finding's id. Assertions 30-31.
- `FindingsPanel.test.tsx` — add one test: with a `focusFindingId` whose severity
  chip is toggled **off**, the card still becomes visible and focused. This pins
  the un-filter branch in S9 link 6, the branch most likely to be dropped.
- `FindingCard.test.tsx` — add one test: bumping `expandNonce` on an
  already-mounted card expands it. This pins the initial-state-only trap.
- Both repo overrides apply: `fireEvent`, not `userEvent`; and the
  `messages/en/prReview.json` import is **eight** `../` from
  `_components/<Name>/` — copy the specifier from `RunTraceDrawer.test.tsx`.
  Wrap in `NextIntlClientProvider` with the real messages, as
  `FindingsPanel.test.tsx` already does.
- **Verify:** `cd client && pnpm test`
- **Risk:** mocking `@/lib/hooks/reviews` in `SmartDiffViewer.test.tsx`. It
  should not be needed — the component takes `data` as a prop and does no
  fetching. If a mock feels necessary, the component is fetching and violates
  frontend-architecture §10.

### S10b — `verify:l03`, the one-command classification check

- **Files:** `scripts/verify-l03.sh` (new, `chmod +x`) · `server/package.json`
  (modified — one line in `scripts`)
- **Why a shell script and not one package's npm script.** The requirement's
  second test case — *"a core-logic file stays on top **and expanded**"* —
  splits across packages: "on top" is the service's sort order, "expanded" is the
  viewer's default-open policy. The client half is not optional, and **there is
  no server-side artifact that expresses it**: the `SmartDiff` contract has no
  `collapsed` field and the service returns no open/closed state. A script inside
  `server/package.json` could not reach it and would go green while "Boilerplate
  is always collapsed" was unimplemented — precisely the stub failure the
  requirement calls out. `scripts/` already owns cross-package wrappers
  (`dev.sh`, `e2e.sh`, `vendor-shared.sh`) with the house style to copy.
- Add one delegating line to `server/package.json` `scripts`, so both entry
  points work with one implementation:

```json
"verify:l03": "bash ../scripts/verify-l03.sh"
```

- `scripts/verify-l03.sh`:

```bash
#!/usr/bin/env bash
#
# verify:l03 — Smart Diff classification, in one run.
#
#   bash scripts/verify-l03.sh
#   cd server && pnpm verify:l03      # thin alias, same script
#
# WHY THIS EXISTS
#
# Smart Diff sorts a PR's files into Core logic / Wiring / Boilerplate from path
# patterns alone — no model call, no network, no DB. That makes it the one part
# of the feature that is fully checkable without opening the UI, and clicking
# through PRs to see whether a lock-file landed in Boilerplate is not
# verification.
#
# WHY A SHELL SCRIPT AND NOT ONE PACKAGE'S npm SCRIPT
#
# The guarantee spans two packages on purpose:
#   server/ — which ROLE a path gets, and the ORDER files come back in
#   client/ — which groups start EXPANDED and which start COLLAPSED
# Nothing on the server expresses "Boilerplate is always collapsed": the
# SmartDiff contract has no `collapsed` field and the service returns no
# open/closed state. A script living inside server/package.json could not reach
# that half, and would pass while the most visible acceptance criterion was
# unbuilt.
#
# DB-FREE ON PURPOSE. `smart-diff.it.test.ts` is deliberately NOT run here. This
# must stay runnable with Docker stopped, or it stops being the thing you run
# first.
#
# NOT A CI GATE. `.github/workflows/server-unit.yml` already runs both server
# files (it runs everything that is not `*.it.test.ts`), and `client.yml`
# already runs the viewer test. Adding a workflow for this script would run the
# same three files a second time and create a second path list to keep in sync.
# Same posture as scripts/e2e.sh — see its header.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "── verify:l03 · Smart Diff classification ──────────────────────────"

echo
echo "[1/2] server — role assignment + group ordering"
( cd "$ROOT/server" && pnpm exec vitest run smart-diff-classify smart-diff-service )
server_status=$?

echo
echo "[2/2] client — group expand/collapse policy"
( cd "$ROOT/client" && pnpm exec vitest run SmartDiffViewer )
client_status=$?

echo
echo "── result ──────────────────────────────────────────────────────────"
if [[ $server_status -eq 0 ]]; then echo "  PASS  server  classification + ordering"
else                                echo "  FAIL  server  classification + ordering"; fi
if [[ $client_status -eq 0 ]]; then echo "  PASS  client  expand/collapse policy"
else                                echo "  FAIL  client  expand/collapse policy"; fi

if [[ $server_status -ne 0 || $client_status -ne 0 ]]; then
  echo
  echo "verify:l03 FAILED" >&2
  exit 1
fi

echo
echo "verify:l03 PASSED"
```

- Two deliberate departures from the neighbouring scripts, both of which need the
  comment they carry:
  - **`set -uo pipefail`, not `set -euo pipefail`.** With `-e` a server failure
    aborts before the client lane runs, so you fix one thing, rerun, and only
    then discover the second. The requirement asks for a script that *shows
    green/red* — that means both lanes report, every time. Exit status is still
    non-zero if either failed.
  - **Positional args are vitest *filename filters*, not paths.**
    `smart-diff-classify` matches `test/smart-diff-classify.test.ts` and does not
    match `smart-diff.it.test.ts`. This matters most on the client, where the
    literal path contains `[repoId]`, which is fragile in both the shell and the
    filter. `SmartDiffViewer` is unambiguous and stable across a folder move.
- **Done when:** `bash scripts/verify-l03.sh` prints two `PASS` lines and
  `verify:l03 PASSED`, **with Docker stopped**, and exits 0. Then break one
  classifier assertion and confirm it prints one `FAIL`, still runs the client
  lane, and exits 1 — a script that cannot go red is not evidence.
- **Verify:** `bash scripts/verify-l03.sh` and `cd server && pnpm verify:l03`
- **No CI workflow.** `server-unit.yml` runs
  `pnpm exec vitest run --exclude '**/*.it.test.ts'`, which already includes both
  server files the moment they exist, and `client.yml` runs
  `pnpm typecheck && pnpm test`, which already includes the viewer test. All
  three files `verify:l03` runs are gated in CI today with zero workflow edits.
  **Say so in the PR body** so a reviewer does not read the absence as a gap.
- **Risk:** writing the script before S10's `SmartDiffViewer.test.tsx` exists.
  Vitest exits 1 with "No test files found" on an unmatched filter, so it fails
  loudly rather than silently passing — but only if you actually run it. Run it.

### S11 — The demo recording (**THIS STEP SPENDS REAL MONEY**)

- **Files:** `demo/record-smart-diff.ts` (new) · `demo/package.json`
  (`"record:smart-diff": "tsx record-smart-diff.ts"` — no lesson number, matching
  `record:intent` / `record:conventions` / `record:skills`) · output to
  `demo/recordings/l03-smart-diff` · curated frames promoted to
  `docs/results/l03-homework/`
- Model it on `demo/record-intent.ts` (16 scenes). Scene list, matching the
  acceptance criteria one to one: Files changed tab in original order → toggle to
  Smart order → summary strip with the file count → Core logic on top →
  lock-file inside a collapsed Boilerplate group → Run Review → badges appear
  with no reload → click a finding → land on that finding's card in Agent runs →
  the API log pane showing the `SMART DIFF:` line with **no** `REVIEW model:` or
  `INTENT CLASSIFIER model:` line beside it → the terminal running `verify:l03`
  with both lanes green.
- **Target a genuinely imported repo, not the seed.** Seeded PR files carry
  `patch: null`, so no diff lines render and the line-rail overlay cannot be
  filmed on seed data.
- **Do not run any package's test suite while the recording is in flight** —
  `buildApp`'s orphan-run reaper will mark the live `running` row `failed` in the
  dev DB and cost a billed run.
- Every assertion is *wait, scroll, settle, shoot*.
- Frames downscaled with `sips -Z 1280` before committing.
  `docs/results/l03-homework/README.md` follows
  `docs/results/l02-homework/README.md:1-7`: title, one-line what, the exact
  `npm run record:*` command, and a link back to this plan.
- **Verify:** `cd demo && npm run typecheck` first, then
  `npm run record:smart-diff` **once**.
- **Risk:** a state the recorder cannot manufacture. If one scene is unfilmable,
  say so in the recorder's own output and in the README rather than faking it.

### S12 — Session close

- Run `/engineering-insights` and append to `server/INSIGHTS.md`,
  `client/INSIGHTS.md`, `demo/INSIGHTS.md` **and the root `INSIGHTS.md`** — this
  work touches `scripts/`, which routes to the root file. Append only.
- Run `/pr-self-review` **before** `git push` / `gh pr create`. It gates both,
  and a blocked verdict is not a suggestion.

---

## Ordering and parallelism

```
S1 (contract + vendor-shared) ─┬─────────────────────────────┐
S2 (constants + classify) ─────┤                             │
                               ▼                             ▼
   SERVER LANE ──  S3 ─► S4 ─► S5 ──────────────────────────┐
                                                             ├─► S10b (verify:l03)
   CLIENT LANE ──  S6/S7 ─► S8 ─► S9 ─► S10 ────────────────┘
                                                             │
                                   End-to-end verification ─► S11 (money) ─► S12
```

- **S1 and S2 are independent.** S2 needs only the `SmartDiffRole` enum, which
  already exists unchanged.
- **The two lanes are independent** once S1 has landed and
  `./scripts/vendor-shared.sh` has run. Two implementers can work them
  concurrently.
- **S6 and S7 are independent of each other** — different files, no shared type
  beyond the contract.
- **S9 must not be split.** Its seven links are one navigation; a half-landed
  chain looks like a working feature that silently does nothing on click.
- **S10b is the only step that depends on both lanes' test files**, which is
  exactly why it is the right artifact to point a reviewer at.
- **S11 is strictly last** and runs against a fully green stack.

---

## Test matrix

Import `LARGE_FILE_LINES` and `ROLE_ORDER` from `constants.ts` rather than
restating numbers; that is what makes the constants file load-bearing rather than
decorative. **AT RISK** marks assertions that can genuinely regress; the rest are
cheap and near-trivial, and are kept because a five-case test does not read as
evidence.

| # | Assertion | Note |
|---|---|---|
| 1 | `package-lock.json` → boilerplate, asserted in the **same `it()`** as `package.json` → wiring | **AT RISK, highest in the file.** Any `includes('package.json')` captures the lock-file — a named acceptance criterion failing to a one-character pattern bug |
| 2 | `pnpm-lock.yaml` → boilerplate | **AT RISK** — a later "`*.yaml` is config → wiring" pattern steals it |
| 3 | `yarn.lock`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock` → boilerplate | pins that the rule is `*.lock`, not three hardcoded JS filenames |
| 4 | `dist/index.js`, `build/main.css`, `.next/static/chunk.js`, `coverage/lcov.info` → boilerplate | |
| 5 | `server/dist/index.js` → boilerplate | **AT RISK** — a pattern anchored to the path start passes 4 and fails this |
| 6 | `src/__snapshots__/Panel.test.tsx.snap` → boilerplate | |
| 7 | `client/src/vendor/shared/contracts/brief.ts` → boilerplate | **AT RISK and load-bearing** — a `.ts` under `src/` that a naive core rule calls core; it is a generated copy |
| 8 | `app.min.js`, `bundle.js.map` → boilerplate | |
| 9 | `README.md` → **wiring**, not boilerplate | **AT RISK by design** — the only thing stopping this decision silently reverting |
| 10 | `docs/agent-prompts/reviewer.md` → wiring | **AT RISK** — where the open "promote prompt markdown to core?" question surfaces |
| 11 | `vitest.config.ts`, `next.config.mjs`, `tsconfig.json`, `eslint.config.mjs` → wiring | |
| 12 | `package.json` → wiring (same `it()` as 1) | |
| 13 | `client/src/lib/hooks/index.ts` → wiring | |
| 14 | `server/src/modules/pulls/routes.ts` → wiring | **AT RISK** — routes are arguably core; this pins the decision |
| 15 | `server/src/db/migrations/0012_add_x.sql` → wiring | |
| 16 | `.github/workflows/lint.yml` → wiring | |
| 17 | `types/global.d.ts` → wiring | |
| 18 | `server/src/modules/reviews/service.ts` → core | trivially true, and the assertion the whole feature exists for |
| 19 | `client/src/components/diff-viewer/FileCard/FileCard.tsx` → core | **AT RISK** — an over-broad `vendor`/`components` pattern swallows it after 7 |
| 20 | `server/src/modules/smart-diff/classify.ts` → core | |
| 21 | A path matching **both** a boilerplate and a wiring pattern resolves **boilerplate** (`package-lock.json`, `dist/next.config.js`) | **AT RISK, structural** — nothing in the type signature protects this ordering |
| 22 | Groups come back `core → wiring → boilerplate` from a boilerplate-first fixture | |
| 23 | A role with no files is **omitted**, not emitted as an empty group | |
| 24 | Within a group, a file **with findings** outranks a larger file with none | **AT RISK** — the "business logic first" promise; a comparator sign flip inverts it silently |
| 25 | Between two files with findings, highest-severity `CRITICAL` outranks `SUGGESTION` | |
| 26 | Between two files with no findings, more changed lines ranks first | |
| 27 | Files equal on every key sort by `path` ascending | **AT RISK** — every other assertion, and the demo's reproducibility, rest on this tie-break existing |
| 28 | `additions + deletions === LARGE_FILE_LINES` → `is_large === false`; `+1` → `true` | **AT RISK, off-by-one.** Import the constant; never hardcode |
| 29 | `is_large` counts `additions + deletions`, not `additions` alone | |
| 30 | On first render, a Core file's diff body is in the document and the Boilerplate group's file bodies are **not** | |
| 31 | A **boilerplate file that has findings** is still collapsed | **AT RISK** — `AUTO_EXPAND_MAX_LINES` and the design's `useState(finding_lines.length > 0)` both pull the other way; `smart.defaultOpen` must win |

Assertions 1-21 live in `smart-diff-classify.test.ts`, 22-29 in
`smart-diff-service.test.ts`, 30-31 in `SmartDiffViewer.test.tsx`. Do **not** put
the ordering assertions in the classifier file: `classifyPath` receives one path
and knows nothing about order, so an ordering assertion there would be pinning
the test's own fixture array — the stub wearing a better name.

---

## Companion changes

| Row | Fires? | What the change set must also contain |
|---|---|---|
| a new or changed repository, or a migration → a touched `*.it.test.ts` | **No** | No repository, no migration, no schema change. |
| a new route → validation, an auth path, and a test | **Yes — HIGH** | `IdParams` as the route's `params` schema; `getContext` + `getPull(workspaceId, prId)` as the auth path; `smart-diff.it.test.ts` plus the Docker-free 422 case. All in S4/S5. |
| a new service → its wiring in the composition root | **Yes — HIGH** | One import + one entry in `server/src/modules/index.ts`. The service is constructed inside its own plugin (`new SmartDiffService(app.container)`), which is that plugin's composition point — `intent/routes.ts:25` is the precedent. **No `platform/container.ts` edit is needed or wanted**: nothing outside this module consumes the service. |
| a changed Zod contract → both vendored copies **and** the client call sites | **Yes — BLOCKER** | `./scripts/vendor-shared.sh` then `--check`; commit `server/src/vendor/shared/contracts/brief.ts` **and** `client/src/vendor/shared/contracts/brief.ts` in the same commit. Client call sites: the `contracts.test.ts` sample, and `client/src/lib/types.ts:35`, which already re-exports `SmartDiff` but must also re-export `SmartDiffFinding` if the client names that type. |
| a new review path in `reviewer-core` → `INJECTION_GUARD` applied | **No** | No `reviewer-core` change, no prompt, no model call. Say this in the PR body so a reviewer does not have to prove the negative. |
| changed finding/scoring code → grounding still drops uncited findings | **No** | Smart Diff reads persisted findings only. It never writes a finding, never re-scores, never re-grounds. |
| a deleted test → a reason | **No** | None deleted. Two extended, one fixture updated. |
| a new secret or credential read → `SecretsProvider` | **No** | No credential read anywhere. |
| `.github/workflows/**` | **No — and that is a decision, not an omission** | `server-unit.yml` and `client.yml` already gate all three files `verify:l03` runs. State this in the PR body. |

**i18n.** Every new user-facing string needs a key in
`client/messages/en/prReview.json` under `smartDiff`. Note `DiffTab.tsx`
currently hardcodes `"Files changed · N files"` and `"Show comments"` — that is
pre-existing debt; do not fix it here, but do not copy it either.

---

## End-to-end verification

Run in this order, from a **stopped** dev stack.

```bash
# 1 — contracts in sync (fails the lint workflow otherwise)
cd /Users/tply/Projects/dev-digest && ./scripts/vendor-shared.sh --check

# 2 — server, full lane (it-tests self-skip without Docker; start it to include them)
cd /Users/tply/Projects/dev-digest/server && pnpm typecheck && pnpm lint && pnpm test

# 3 — client, fast lane
cd /Users/tply/Projects/dev-digest/client && pnpm typecheck && pnpm lint && pnpm test

# 4 — the homework's own gate
bash /Users/tply/Projects/dev-digest/scripts/verify-l03.sh

# 5 — the ONLY check that catches the webpack .js→.ts vendor trap.
#     STOP `pnpm dev` FIRST. See the warning below.
cd /Users/tply/Projects/dev-digest/client && pnpm build
```

> **Step 5 is a loaded gun.** `client/INSIGHTS.md` (2026-08-06) records that this
> exact sequence poisoned the stack during the L03 sweep even though the L03 plan
> carried the warning **twice**. `pnpm build` under a running `pnpm dev`
> overwrites `client/.next`; the app then renders perfectly and **loses only its
> CSS** — one 404 on `_next/static/css/app/layout.css`, a "1 Issue" badge
> bottom-left — which reads as "my styles broke" and sends you into `styles.ts`
> for twenty minutes. Recovery is `rm -rf client/.next` **plus** a full restart,
> and `scripts/dev.sh`'s `trap cleanup EXIT` means killing the Next process takes
> the API down with it. **There is no `--distDir` escape hatch on this version.**

Then the manual pass, which is what the acceptance criteria actually name:

```bash
./scripts/dev.sh
```

1. Open a PR, `?tab=diff` → **Original order**: no findings visible on any line.
2. Toggle → **Smart order**: the summary strip shows the file count; `Core logic`
   on top; `Boilerplate` collapsed; a lock-file inside it.
3. A file over `LARGE_FILE_LINES` shows its highlight chip.
4. Run Review. Badges and line rails appear **with no reload** (S6's invalidator).
5. Click a finding's severity tag → the URL becomes `?tab=findings&finding=<id>`,
   the Agent runs tab opens, the owning accordion expands and scrolls, and that
   finding's card is expanded and highlighted. **No popup, no GitHub, not the top
   of the file.**
6. Browser **Back** returns to `?tab=diff&view=smart` — still in Smart Diff mode.
   This is what the URL-bound toggle buys, and the check that proves it.
7. In the API log, the request logs `SMART DIFF: computed from stored PR files +
   latest review (no model call)` and **no** `REVIEW model:` or
   `INTENT CLASSIFIER model:` line. Those two sites
   (`reviews/run-executor.ts:330`, `intent/service.ts:306`) are the only places a
   model call becomes visible — the LLM adapters themselves log nothing.

Finally: S11 (record), then `/engineering-insights`, then `/pr-self-review`.

---

## Acceptance criteria

1. Demo video of Smart Diff on a large PR: Core logic on top, lock-file
   collapsed, badges appear after Run Review, click leads to the line. →
   `docs/results/l03-homework/`
2. A PR with a clear description of the implementation and the checks performed.
3. A lock-file is **always** classified Boilerplate and starts collapsed. →
   assertions 1-3 (classification) and 30-31 (collapsed)
4. Finding badges are clickable and lead to the corresponding place — the
   finding's card in the Agent runs tab, in-app, no popup, not GitHub. → S9
5. The Smart Diff view's logs contain no new model call. → the `SMART DIFF:` line
   with no model line beside it; the throwing-`llm()` service test; the unchanged
   `agent_runs` count in `smart-diff.it.test.ts`
6. Thresholds and patterns are extracted into constants. →
   `server/src/modules/smart-diff/constants.ts`, imported by the tests rather
   than restated
7. **A `verify:l03` script exists and actually runs the classification tests —
   green/red in one command, no UI, no Docker.** → `scripts/verify-l03.sh`, also
   reachable as `cd server && pnpm verify:l03`

---

## Out of scope

Named explicitly, because each is somewhere a reasonable implementer would
otherwise drift.

- **`pseudocode_summary` stays `null`, and gets no non-LLM meaning.** The field
  exists at `brief.ts:104` and the design renders a `Sparkles` "summary" chip
  when it is present. Populating it requires a model call, which the zero-token
  constraint forbids. Do **not** substitute a non-LLM value (first line of the
  patch, the function name, a heuristic) — the field name is a promise the value
  would not keep, and the `Sparkles` icon signals AI-authored content to the
  reader. The client must not render the summary chip at all. This is an
  extension point for a later lesson.
- **The "Generate split PRs" button, and `proposed_splits` generation.** Dormant
  in the design, absent from every acceptance criterion. `proposed_splits: []`,
  no button, no row rendering. `smartDiff.largeBody` stays unused for the same
  reason.
- **`PrBrief` composition.** `PrBrief` (`brief.ts:133-141`) is
  `{intent, blast, risks, history}` and does not include `SmartDiff`. Do not add
  it. Composing the brief is a different lesson.
- **Any DB table, column, migration or repository.** Smart Diff is computed on
  read from `pr_files` + `findings`. If a step starts caching the response in
  Postgres, it has left the plan.
- **A `verify-l03.yml` workflow**, and **a `verify:l03` entry in
  `client/package.json`** — one entry point plus one alias, not three.
- **An `e2e/specs/*.flow.json` for Smart Diff.** The acceptance criterion is a
  demo video, not a browser flow. This is a *deferral*, not a blocker: the seed
  does insert findings (`server/src/db/seed.ts:164-180`) and
  `05-pr-diff.flow.json` is a working model, so a flow asserting classification,
  ordering, the collapsed lock-file and the click-through **is** feasible on
  seeded data. What it could not assert is the line rail, because seeded `patch`
  is `null`. Good follow-up; not this change.
- **`reviewer-core/`.** The classifier is pure, and ring 0 is where pure
  calculation lives — but onion §3 places it *beside the caller* by default, and
  `reviewer-core` is the LLM review engine. A path classifier has no
  `reviewer-core` consumer. Promotion happens on the second consumer, not the
  first.
- **Fixing `DiffTab`'s hardcoded English strings** and the 148 baselined
  inline-style/barrel violations. Pre-existing debt. New strings go through
  next-intl; old ones stay put. Lower the lint baseline deliberately with
  `pnpm lint:baseline`, never as a side effect.
- **Adding `@testing-library/user-event`.** `client/INSIGHTS.md` (2026-08-06)
  names this as its own deliberate change.
- **Touching `client/src/vendor/ui/**`.** Frozen. Every primitive this feature
  needs already exists.
- **Removing existing barrel `index.ts` files**, including
  `client/src/components/diff-viewer/index.ts`. frontend-architecture §12 scopes
  the rule to new and touched code and calls removal a separately-requested
  migration.

---

## Open decisions

None of these blocks S1. Each is recorded so the decision surfaces where it
matters rather than being made silently by whoever edits the pattern list next.

| Open question | Why it is still open | What would settle it |
|---|---|---|
| Should `.claude/skills/**/SKILL.md` and `docs/agent-prompts/**` be classified `core` rather than `wiring`? In this repo those files *are* behaviour. | The classifier runs on **imported** PRs from arbitrary repos, so a dev-digest-specific rule may be over-fitting — but the demo films a dev-digest PR, where it would visibly matter. A product call about whether the classifier is generic or repo-aware. | A decision from the course author. Ship `wiring` for now; the change is two lines in `constants.ts` and one flip of assertion 10. |
| Should findings whose `file` matches no row in `pr_files` be surfaced in the UI, or only logged? | Grounding guarantees the finding's file was in the **diff**, but `pr_files.path` (the GitHub detail payload) and `loadDiff`'s output are different producers, and it is not established that they always agree on path form. If they can disagree, silently dropping findings is a correctness bug the reviewer never sees. | Run the endpoint against a real imported PR with findings and read the `unmatched` count in the S4 log line. Zero across several PRs → log-only is fine. Non-zero → the count needs a UI surface, and path normalisation needs fixing first. |
| Should a `dismissed` finding still show a line rail and count toward the badge? | The existing UI has an opinion — `ReviewRunAccordion.tsx:60` excludes dismissed findings from the blocker count and `FindingCard` mutes them — but neither the homework nor the mentor mentions dismissal, and the contract has no slot for it. Adding one is a second contract change. | A product call. The conservative reading of the existing code is to exclude `dismissed_at != null` from `finding_lines` and the badge count while keeping them reachable — but that is inference, not a stated rule. |
| The exact value of `SPLIT_TOO_BIG_LINES`. | `LARGE_FILE_LINES` has an in-repo precedent (`AUTO_EXPAND_MAX_LINES = 200`); the PR-level threshold has none, and the constants convention here demands a measured rationale. | Measure the changed-line distribution across a few real imported PRs, or take the course author's number. Until then, say in the comment that it is provisional. |
