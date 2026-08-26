# Development Plan — L06 Project Context

**Request:** Turn the approved SPEC-06 (two files, one Spec ID) into an executable plan:
a DB-backed, editable store of `.md` documents per repository, three ways to fill it
(import from the clone, new empty file, upload), attachment to agents and skills, token
counts, and the feeding of the already-existing `specs` slot in the assembled prompt —
plus the Project Context page, editor, target tabs and the trace block.

**Spec:** `server/docs/specs/06-project-context.md` + `client/docs/specs/06-project-context.md`
— **SPEC-06, Status: draft**, revision 2. 46 ids allocated, **45 live**, AC-30 withdrawn in
place. Criteria are the union of the two files; neither is complete on its own.

**Packages:**
- `server/` — `@devdigest/api`, **pnpm**
- `client/` — `@devdigest/web`, **pnpm**
- `reviewer-core/` — **no change** (verified below)

**Execution mode:** **single-agent, twice** — one `implementer` per pull request, PR-1
(server) then PR-2 (client). Applied as the default; the invocation did not name a mode.

**Assumptions:**
1. Two pull requests, not one (R-3). The change set is ~30 new files; `routing.md` §2 caps a
   review pass at 15 files / 1500 added lines, and one PR would split into six passes.
2. Every `[NEEDS CLARIFICATION]` in the spec is **non-blocking** and its stated default is
   carried into the code verbatim — none of the seven blocks a step, so no step is deferred
   and no `AC` is out of scope for that reason.
3. Work happens on a new branch off `main`. The current branch is `homework-L05`; this is
   L06 work and does not belong on it.

---

## Approach

Nothing new is invented at the engine end: `reviewer-core/src/prompt.ts:213-216` already
wraps every element of `parts.specs` in `wrapUntrusted('spec-N', …)`, `:293-300` renders
`## Project context` into the section manifest, and `:327` records it on `PromptAssembly`.
The work is a store to feed that slot and a page to manage it. The store is a new
`modules/context/` feature with its own three tables — **not** files in the clone, because
`server/src/adapters/git/simple-git.ts:77-88` resyncs with `git reset --hard origin/<branch>`
and would delete any write there without a word.

Exactly one genuinely new read mechanism is required, and it gets its own step (S3): a
directory-listing method on the `SourceReader` port, reversing the decision recorded at
`server/docs/specs/04-conventions.md:236-238`. Everything else is assembly: a repository, a
use-case service, one route file, one container key, and a client page built from the same
shapes.

`run-executor.ts` reaches the store the way it already reaches every other feature — through
the composition root (`container.projectContext`), never a sibling import.

---

## Execution

One `implementer` per pull request, in order. Both PRs are single-agent: the steps inside
each share files heavily (the same `service.ts`, the same `context.it.test.ts` fixture), and
the tests named in *Traceability* need the same fixtures the implementer has just built — so
an independent `test-writer` context would spend most of its budget rediscovering them. This
is also the only shape `/impl` runs.

**PR-1 — server (S1…S9).** Strictly in order. S1 (contracts) and S2 (schema) gate everything
after them; S3 is independent of S1/S2 and may be done first if preferred. S7 must come after
S4–S6, because it consumes `container.projectContext`.

**PR-2 — client (S10…S17).** After PR-1 is merged: the vendored client copy of the contracts
lands in PR-1 (both copies are committed together — `server/CLAUDE.md`, "`src/vendor/shared/**`
— this IS the source"), and PR-2 imports it **as types only**. S11 (the nav entry) is its own
commit and touches nothing else under `client/src/vendor/ui/**`. S13→S16 may be built in any
order; S17 is independent of all of them.

**Commit trailers** (root `CLAUDE.md`, *Commits*): every commit in both PRs carries

```
Plan: docs/plans/L06-project-context.md
Steps: S4, S5
```

with the `S<n>` ids that commit actually carries.

---

## Requirements review

Findings on SPEC-06 as handed over. Each is reported, none is fixed here.

| Finding | Kind | Cited | Owner |
|---|---|---|---|
| AC-46 carries a positive display **and** a negative prohibition ("не повинна показувати кількість чанків"). One id, two verdicts. | compound | `client/docs/specs/06-project-context.md:92-94` | `spec-creator` |
| AC-4 carries three distinct triggers (too large · not UTF-8 · escapes the clone) under one id; its own traceability note says "по кейсу на причину", so one verdict has to cover three cases. | compound | `server/docs/specs/06-project-context.md:117-119` | `spec-creator` |
| AC-3 names an implementation symbol inside the criterion (`container.tokenizer`). Fails the *Behavioural* test; the intent (a real count, not a size estimate) is clear and plannable. | behavioural | `server/docs/specs/06-project-context.md:154-156` | `spec-creator` |
| AC-13 and NFR-5 assert the same observable — one log line, always. Build it once; grade it twice knowingly, not by accident. | duplication | `server/docs/specs/06-project-context.md:194-195` and `:314-318` | `spec-creator` |
| **AC-16 already ships.** `SkillsRepository.usageCounts` + `Skill.used_by` are live on `GET /skills`. The step is a pinned regression test, not a build. | already met | `server/src/modules/skills/service.ts:60-64`, `server/src/vendor/shared/contracts/knowledge.ts:159` | me (plan) — S8 |
| **AC-25/AC-26 are mostly already true.** The trace already renders a collapsible `Project context` block off `prompt_assembly.specs`; only the token count in the header is new, and AC-26 already holds by the `!= null` guard. | already met | `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:113-115` | me (plan) — S17 |
| The **nav entry** — the change set's only frozen-path edit — is carried by no acceptance criterion. It appears only under *Design coverage* and *Open questions*, so nothing grades it. Planned as groundwork and pinned by `nav-registry.test.ts`. | uncovered | `client/docs/specs/06-project-context.md:211-217`, `:358-365` | `spec-creator` / me (plan) — S11 |
| NFR-6 requires keyboard operation, but `@testing-library/user-event` is **not** a dependency of `client/`. Following the RTL skill literally fails at import. | attributable | `client/INSIGHTS.md:234-240` | me (plan) — S16 uses `fireEvent` + role/state assertions and does not add the package as a side effect |

---

## Recommendations

Proposals. The steps below follow the requirements as given; nothing here is folded into a
step until you accept it.

- **R-1 — do the upload (AC-34) client-side.** The client reads the `.md` with `FileReader`
  and POSTs the text through the same JSON create endpoint as AC-33; the server grows no
  multipart path. **Buys:** no `@fastify/multipart` dependency (`server/package.json:21-31`
  has none), no binary-parse surface, no `package-config` review group, and AC-32/33/34
  collapse onto one server code path so `test_context_store_it` covers all three.
  **Costs:** the browser reads a file into memory before the size check — mitigated by
  checking `File.size` against `MAX_DOC_BYTES` before reading. **Touches:** AC-34.
  *(The steps below are written on this recommendation. If you reject it, S5/S6 grow a
  multipart route and S13 changes.)*
- **R-2 — build `SourceReader.list()` on the existing exclusion vocabulary.**
  `EXCLUDED_DIRS` in `server/src/platform/source-scope.ts:22-32` is ring 1 and already lists
  `node_modules`, `.git`, `vendor`, `dist`, `build`, `coverage`, `.next`, `out` — a superset
  of what AC-1 requires. **Buys:** AC-1's exclusions are single-sourced with the indexer's, and
  the new port method becomes the migration target that `repo-intel/pipeline/walk.ts:23-32`
  has been asking for in writing since it was built. **Costs:** `list()` needs an
  extension-filter parameter the indexer does not use. **Touches:** AC-1.
- **R-3 — two pull requests, server then client.** **Buys:** each PR fits the review budget
  (`routing.md` §2: 15 files / 1500 added lines per pass) and the server half is independently
  demonstrable via `curl`. **Costs:** the client half waits on a merge; the vendored contract
  copy ships one PR ahead of its first consumer, which is exactly what
  `./scripts/vendor-shared.sh --check` expects. **Touches:** nothing in the AC list.
- **R-4 — plan AC-16 as a pin, not a build.** See the requirements-review row. **Buys:** a
  step that would otherwise re-implement a working aggregate becomes one it-test.
  **Costs:** none. **Touches:** AC-16.
- **R-5 — feed AC-28 from the existing `Skill.used_by`**, not a new count on the context
  endpoints. **Buys:** one source of truth for "used by N agents"; the client already has the
  invalidation rule for it (`client/INSIGHTS.md:242-252`). **Costs:** the skills target tab
  fetches `GET /skills` as well as the attachment set. **Touches:** AC-28, AC-16.

---

## Constraints in force

**Invariants this change could break, and how:**

- **Prompt-injection defense is one shared rule.** Document bodies reach the model **only**
  through the `specs` slot, which is wrapped by `wrapUntrusted('spec-N', …)` at
  `reviewer-core/src/prompt.ts:213-216`. Passing a body into `PromptParts.skills` —
  `:80-86`, which the engine documents as *trusted* configuration — bypasses the guard
  entirely. NFR-1's threshold is zero such paths, and S7 is where it would be broken.
- **The store's text has two untrusted origins, not one.** Imported text comes from
  `server/clones/**`, *"the only tree here whose contents an outsider influences"*
  (`INSIGHTS.md:328-331`). Created and uploaded text was written by the user, who is also not
  trusted engine configuration. Attaching a document to a **skill** decides *whether* it is
  included, never *at what trust level*.
- **Migrations do NOT run on boot.** After S2, `pnpm db:migrate` or every route answers
  `relation "context_docs" does not exist` (`server/INSIGHTS.md:474-475`).
- **`*.it.test.ts` = DB-backed**, and the CI suite split keys on that filename
  (`server/CLAUDE.md`, *Commands*).
- **Grounding and scoring are untouched.** No step goes near `groundFindings` or the score
  recomputation; if a step finds itself there, it is the wrong step.

**Frozen paths in range:**

| Path | What to do instead |
|---|---|
| `client/src/vendor/shared/**` | generated. Edit `server/src/vendor/shared/contracts/`, run `./scripts/vendor-shared.sh`, commit **both** — `--check` runs in the `lint` workflow and the `vendor-sync` gate |
| `client/src/vendor/ui/nav.ts` | frozen with no in-repo source. The nav registry is the sanctioned exception (`client/docs/specs/03-skills.md:83-94`): one isolated commit, nothing else under `vendor/ui`, said out loud in the PR body |
| `server/src/db/migrations/*.sql` (applied) | never edited — `pnpm db:generate` produces a new one. The `meta/_journal.json` + `meta/NNNN_snapshot.json` churn in the same diff is expected and generated (`server/INSIGHTS.md:463-470`) |

**`server/eslint.config.js:122-140` enumerates the ring globs by literal FILENAME.** A module
file named anything outside `service.ts` / `routes.ts` / `repository.ts` / `helpers.ts` /
`constants.ts` / `pipeline/**` / `classify.ts` is covered by **no** rule at all. This plan
keeps `modules/context/` to the five sanctioned names, so the glob list needs no edit — if a
step invents a sixth filename, that step also edits the glob list and proves it bites
(`server/INSIGHTS.md:212-222`).

**`server/INSIGHTS.md` — top 3 for this task:**

1. **The lint ring globs are literal filenames** (2026-08-08, `:212-222`) — the constraint
   directly above; the whole decision-logic file of Smart Diff once sat outside every rule.
2. **An `*.it.test.ts` that omits one adapter override makes live, billed API calls, and the
   only symptom is a timeout** (2026-08-06, `:130-147`). The remedy is not enumerating ports:
   inject `secrets: new MockSecretsProvider({})` so a forgotten port fails loudly on every
   machine. Every new `*.it.test.ts` in S4–S9 does this.
3. **`buildApp` reaps stale runs on construction, so the suite fails live runs in the dev DB**
   (2026-08-06, `:170-185`). Do not run the server suite against a stack with a review in
   flight.

Also carried: `pnpm db:generate` only turns interactive when a column is dropped and another
added on the same table (`:149-158`) — S2 adds three new tables and touches no existing
column, so it should run non-interactively; if it prompts, something else changed.

**`client/INSIGHTS.md` — top 3 for this task:**

1. **One runtime Zod import from `@devdigest/shared` costs ~15 kB First Load JS on every
   route** (2026-08-03, `:45-53`) — this is NFR-3's entire mechanism. Import contract types
   with `import type`, never a schema value.
2. **`pnpm build` while `pnpm dev` runs poisons `client/.next`**, and the symptom is the whole
   app rendering correctly in serif type with one 404 on `layout.css` — which reads as "my
   styles broke" (2026-08-03 `:89-99`, corrected 2026-08-06 `:124-137`, and ignored twice
   despite being written down `:139-156`). NFR-3 forces a build, so **stop the dev server
   first**.
3. **A component test that passes the prop by hand proves nothing about whether anything
   passes it** (2026-08-05, `:112-122`) — the skill-count badge was green for a whole lesson
   without once appearing in the app. This is exactly why the spec pins AC-28 and AC-43 at
   the tab level rather than the card (`client/docs/specs/06-project-context.md:292-295`).

Also carried: `@testing-library/user-event` is not a dependency here (`:234-240`); a new
`lib/hooks/<domain>.ts` must **not** be added to `hooks/index.ts` (`:321-330`); a style spread
in JSX is two `no-restricted-syntax` errors, so `styles.ts` exports a function returning the
whole computed style (`:332-340`).

**`reviewer-core` needs no change, verified rather than assumed:** the `specs?: string[]` slot
is declared at `reviewer-core/src/prompt.ts:89-90`, wrapped at `:213-216`, rendered and
recorded at `:293-300`, surfaced on `PromptAssembly` at `:327`, and accepted by
`reviewPullRequest` at `reviewer-core/src/review/run.ts:62,189`. `grep -rn "specs" server/src/modules/reviews`
finds only `specs_read: []` (`run-executor.ts:568,795`) and a `specs: null` in the failure-path
assembly (`:791`). Nothing in the engine is missing; the slot has simply never been fed.

---

## Skill contract

Built from `.claude/skills/pr-self-review/routing.md` §1, §3 and §4. Every citation is a path
plus an anchor.

| Step | Files | Skill (path + anchor) | Binding rule |
|---|---|---|---|
| S1 | `server/src/vendor/shared/contracts/context.ts` | `.claude/skills/zod/SKILL.md` — *Quick Reference* §1–§2 | validate at the system boundary, `z.unknown()` never `z.any()`, and choose `optional` vs `nullable` deliberately — `Skill.used_by` uses `.nullish()` and this contract mirrors it |
| S2 | `server/src/db/schema/context.ts`, `server/src/db/migrations/00NN_*.sql` | `.claude/skills/postgresql-table-design/SKILL.md` — *Constraints* | every FK names an explicit `ON DELETE` action **and** gets an index on the referencing column; a `CHECK` passes on NULL, so pair it with `NOT NULL` |
| S2 | same | `.claude/skills/drizzle-orm-patterns/SKILL.md` — *Best Practices* | `generate` + `migrate`, never `push`; index every FK and every frequently-queried column |
| S3 | `server/src/vendor/shared/adapters.ts`, `server/src/adapters/source/fs-reader.ts`, `server/src/adapters/mocks.ts` | `.claude/skills/onion-architecture/SKILL.md` §4 | inner defines, outer implements — and it is **four** edits: the interface (ring 1), the real implementation (ring 3), the test double next to it, and the container override key. Miss the double or the key and the port is decorative |
| S3 | `server/src/adapters/source/fs-reader.ts` | `.claude/skills/security/SKILL.md` — *File Upload Security* | path traversal: resolve both sides and re-check containment before returning a path. A lexical check cannot see a symlink, which is why `read()` already calls `realpath` on the root **and** the target (`fs-reader.ts:20-40`) — `list()` applies the same rule per directory entry |
| S4 | `server/src/modules/context/repository.ts` | `.claude/skills/onion-architecture/SKILL.md` §8 | the ORM appears only here; **every** query is scoped by the tenant key as a required parameter, not an optional; read-time aggregation is a query, not a loop; row types stop at the repository |
| S4 | same | `.claude/skills/drizzle-orm-patterns/SKILL.md` — *Best Practices* | `$inferSelect`/`$inferInsert` for types; `.where()` + `.limit()` so only needed rows are fetched |
| S5, S7 | `server/src/modules/context/service.ts`, `server/src/modules/reviews/run-executor.ts` | `.claude/skills/onion-architecture/SKILL.md` §11 | never import a sibling module's `service.ts`/`repository.ts`/`constants.ts`; shared behaviour becomes a port or a composition-root key. `run-executor` reaches the store as `container.projectContext`, the same route as `container.intent` and `container.skills` |
| S5 | `server/src/modules/context/service.ts`, `helpers.ts`, `constants.ts` | `.claude/skills/onion-architecture/SKILL.md` §3 | placement table: SQL → `repository.ts`, orchestration → `service.ts`, a pure calculation over data already in memory → `helpers.ts`, a limit → `constants.ts`. `platform/config.ts` is the only place env is read — the four thresholds are constants, not config |
| S6 | `server/src/modules/context/routes.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts` | `.claude/skills/fastify-best-practices/SKILL.md` — *Core Principles* | schema-first: the route declares Zod `params`/`body`, so invalid input is rejected before the handler runs. Never hand-roll `Schema.parse(req.body)` |
| S6 | same | `.claude/skills/onion-architecture/SKILL.md` §3 | an HTTP endpoint is ring 3 and lives in `modules/<feature>/routes.ts`; a new service is wired in the composition root or nothing can reach it |
| S7 | `server/src/modules/reviews/run-executor.ts` | `.claude/skills/security/SKILL.md` — *Agentic AI Security (OWASP 2026)* | ASI01 Goal Hijacking — untrusted text enters the prompt wrapped and bounded, never as instruction. Here that means the `specs` slot only; `PromptParts.skills` is the trusted section and is off limits for a document body (NFR-1) |
| S8, S9 | `server/test/**` | `.claude/skills/onion-architecture/SKILL.md` §12 | ring-2 tests take override doubles and no database; ring-3 repository tests take a real database via testcontainers and are named `*.it.test.ts`; assert on the double's **recorded output**, not on call counts |
| S10 | `client/src/lib/hooks/context.ts`, `client/src/lib/types.ts` | `.claude/skills/frontend-architecture/SKILL.md` §10 | a query key lives with the query that owns it and stays module-private; export the hook, not the key; cross-domain invalidation goes through a **named invalidator**, never a re-exported key |
| S10 | `client/src/lib/hooks/context.ts` | `.claude/skills/frontend-architecture/SKILL.md` §12 | import modules directly; add no new `index.ts`. Concretely: do **not** re-export this module from `lib/hooks/index.ts` — the barrel's five `export *` lines are baselined and a sixth is a fresh lint error |
| S11 | `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/helpers.ts` | `.claude/skills/frontend-architecture/SKILL.md` §1 | placement: the nav registry is the app-wide declaration of a route and there is nowhere else for it — which is why this frozen path has one sanctioned exception, and why the edit is isolated |
| S12 | `client/messages/en/context.json` | — none; `routing.md` §1 has no row matching `client/messages/**` (recorded in *Open decisions*) | repo rule instead (`client/CLAUDE.md`, *Conventions*): user-facing text goes through next-intl, never hardcoded in JSX |
| S13–S16 | `client/src/app/repos/[repoId]/context/**` | `.claude/skills/frontend-architecture/SKILL.md` §1 | one route, one feature → `_components/<Name>/`; the default is the leftmost column that fits. Nothing here is promoted to `src/components/` on a prediction of a second consumer |
| S13–S16 | same | `.claude/skills/frontend-architecture/SKILL.md` §10 | component bodies get no business logic: read props, call a hook, return JSX. Data goes through `lib/hooks/*` only — never a `fetch` in a component |
| S13 | `client/src/app/repos/[repoId]/context/page.tsx` | `.claude/skills/next-best-practices/SKILL.md` — *File Conventions* | `page.tsx` stays thin — one import of the view; special-file semantics are not a place for feature logic |
| S16 | `client/src/app/repos/[repoId]/context/_components/ContextTargetTab/**` | `.claude/skills/react-best-practices/SKILL.md` — *Accessibility (HIGH)* | icon-only controls carry an `aria-label`; dynamic state is exposed as state, not as colour. NFR-6's threshold — an accessible name that includes the document name, plus a role and state on the mode switch — is this rule made measurable |
| S9, S12–S17 | `client/**/*.test.tsx`, `server/test/**` | `.claude/skills/react-testing-library/SKILL.md` — *Query Priority* | `getByRole` first, always. The Tier-1 query and NFR-6's accessible-name requirement are the same assertion, so a test that reaches for `getByTestId` has also stopped checking accessibility |

**Content triggers fired (`routing.md` §3):** `readFile`/`readdir` in S3, upload/file handling
in S5 and S13, `req.body`/`req.params` in S6 → all three pull `security-sweep` into the
review, and it may block. No step plans an `as any`, a `@ts-expect-error` or a new generic,
so `typescript-expert` is not assigned; if one appears, it is a finding, not a skill to add
afterwards.

**Placement boundary:** `onion-architecture` is assigned to `server/` files only,
`frontend-architecture` to `client/` files only. No file in this plan carries both.

---

## Steps

### PR-1 — server

**S1 — Zod contracts for the store, the candidates and the attachments**
- Files: `server/src/vendor/shared/contracts/context.ts` (new) · `server/src/vendor/shared/index.ts` (modified — add the `export *`) · `client/src/vendor/shared/**` (regenerated, **not hand-edited**) · `server/test/contracts.test.ts` (modified)
- Shapes: `ContextDoc { id, name, bytes, tokens, updated_at }`, `ContextDocBody { …ContextDoc, body }`, `ContextStoreStatus { docs, total_bytes }`, `ImportCandidate { path, bytes, status: 'ok' | 'skipped', reason?: 'too_large' | 'not_utf8' | 'outside_clone' }`, `ImportCandidates { candidates, truncated }`, `AttachmentSet { doc_ids: string[] }`, `AttachedDoc { …ContextDoc, missing: boolean }`.
- Skills: `.claude/skills/zod/SKILL.md` — *Quick Reference* §1–§2
- Satisfies: — (groundwork: every server AC below reads or writes one of these shapes, and the client half type-checks against the vendored copy)
- Done when: the contracts parse the fixtures in `contracts.test.ts`, and `./scripts/vendor-shared.sh --check` exits 0 after the regeneration.
- Verify: `cd server && pnpm exec vitest run test/contracts.test.ts && ../scripts/vendor-shared.sh --check`
- Risk: editing the **client** copy instead of the server one. The edit is lost on the next script run, the client type-checks against its stale copy, and the field reads `undefined` at runtime with nothing logged (`server/CLAUDE.md`). `contracts.test.ts` is the test a renamed field breaks and it is in no other plan's file list (`server/INSIGHTS.md:565-567`) — it is in this one.

**S2 — three tables and one migration**
- Files: `server/src/db/schema/context.ts` (modified — append) · `server/src/db/migrations/00NN_*.sql` (new, generated) · `server/src/db/migrations/meta/**` (generated churn)
- Tables: `context_docs (id, workspace_id, repo_id, name, body, updated_at)` with `UNIQUE (repo_id, name)`; `agent_context_docs (agent_id, doc_id)` and `skill_context_docs (skill_id, doc_id)`, each a composite PK. Every FK `ON DELETE CASCADE`, every referencing column indexed. `code_chunks` is **not touched** — it stays empty, per the spec's non-goal.
- Skills: `.claude/skills/postgresql-table-design/SKILL.md` — *Constraints* · `.claude/skills/drizzle-orm-patterns/SKILL.md` — *Best Practices*
- Satisfies: — (groundwork for AC-32…AC-40, AC-6, AC-7)
- Done when: `pnpm db:generate` emits one new `.sql` **without prompting**, and `pnpm db:migrate` applies it against a fresh database.
- Verify: `cd server && pnpm db:generate && pnpm db:migrate`
- Risk: `db:generate` turns interactive when a column is dropped and another added on the same table, and cannot be answered from a pipe (`server/INSIGHTS.md:149-158`). Three new tables should not trigger it — a prompt here means something else changed, and answering "create" where it meant "rename" is silently wrong rather than an error.

**S3 — `SourceReader` grows a directory listing (the deliberate reversal)**
- Files: `server/src/vendor/shared/adapters.ts` (modified — the port) · `server/src/adapters/source/fs-reader.ts` (modified — `FsSourceReader.list`) · `server/src/adapters/mocks.ts` (modified — `MockSourceReader.list`) · `server/test/adapters.test.ts` (modified)
- Signature: `list(clonePath, opts: { extensions: string[]; maxEntries: number }) → Promise<{ paths: string[]; truncated: boolean }>` — forward-slash-normalised, alphabetically sorted, `EXCLUDED_DIRS` from `server/src/platform/source-scope.ts:22-32` skipped (R-2).
- Skills: `.claude/skills/onion-architecture/SKILL.md` §4 · `.claude/skills/security/SKILL.md` — *File Upload Security*
- Satisfies: AC-1, AC-2, AC-29 (with S5's filter) · AC-39
- **Written justification, required in the port's doc comment.** `server/docs/specs/04-conventions.md:236-238` recorded the opposite decision in as many words: *"`SourceReader` stays a one-method port instead of growing a directory walk."* That decision is reversed here, deliberately, and the reversal is recorded in three places because a negative decision recorded in a comment must be reversed everywhere it is written down (`server/INSIGHTS.md:285-292` and its extension `:294-305`): (a) the port's doc comment in `adapters.ts`, (b) SPEC-06's *Inputs and provenance* section, which already states it (`server/docs/specs/06-project-context.md:391-397`), and (c) the PR body. The reason it survives the store reversal: the walk no longer feeds the prompt, it feeds the import picker, and the picker cannot exist without it. The reason it belongs on the **port** rather than in the module: `repo-intel/pipeline/walk.ts:23-32` already carries two `eslint-disable no-restricted-imports` whose own comment names extracting exactly this port as the payoff — putting the walk anywhere else would make the seventh disable, which `server/INSIGHTS.md:447-455` forbids without the same written reason.
- Done when: `list()` returns sorted repo-relative `.md` paths, skips every `EXCLUDED_DIRS` entry, caps at `maxEntries` with `truncated: true`, and returns `[]` (never throws) for an absent root. `MockSourceReader` implements it over its in-memory record, so no test needs a temp directory.
- Verify: `cd server && pnpm exec vitest run test/adapters.test.ts && pnpm lint`
- Risk: a symlinked **directory** walking out of the clone. `read()` already resolves both sides with `realpath` and re-checks containment (`fs-reader.ts:20-40`); `list()` must do the same per entry, or the port that refuses to be talked out of its root on reads can be walked out of it on lists.

**S4 — `modules/context/repository.ts`**
- Files: `server/src/modules/context/repository.ts` (new)
- Methods: `listDocs(workspaceId, repoId)`, `getDoc(workspaceId, docId)`, `createDoc(workspaceId, repoId, name, body)`, `replaceBody(workspaceId, docId, body)`, `storeBytes(workspaceId, repoId)`, `setAgentDocs(workspaceId, agentId, docIds)`, `setSkillDocs(workspaceId, skillId, docIds)`, `docsForAgent(workspaceId, agentId, repoId)`, `docsForSkills(workspaceId, skillIds, repoId)`.
- Skills: `.claude/skills/onion-architecture/SKILL.md` §8 · `.claude/skills/drizzle-orm-patterns/SKILL.md` — *Best Practices*
- Satisfies: — (groundwork for AC-6, AC-7, AC-8, AC-32…AC-40)
- Done when: every method takes `workspaceId` as a **required** first-class parameter and every query filters on it; `storeBytes` is a SQL `sum(length(body))` wrapped in `Number(...)`, not a loop.
- Verify: `cd server && pnpm typecheck && pnpm lint`
- Risk: `count()`/`sum()` come back as **strings** from postgres-js and `db.execute()` returns the rows directly, not `{ rows }` — `.rows[0]` type-checks, compiles, and reads `undefined` at runtime (`server/INSIGHTS.md:436-445`). A missing `workspaceId` filter is a data-leak bug that AC-8's test is the only thing standing between you and.

**S5 — `modules/context/service.ts`, `helpers.ts`, `constants.ts`**
- Files: `server/src/modules/context/service.ts` (new) · `server/src/modules/context/helpers.ts` (new) · `server/src/modules/context/constants.ts` (new)
- `constants.ts`: `MAX_DOC_BYTES = 64_000`, `MAX_STORE_BYTES = 2_000_000`, `MAX_LISTED_DOCS = 500`, `WARN_CONTEXT_TOKENS = 20_000` — the spec's own defaults, carried verbatim from an unresolved but non-blocking clarification (`server/docs/specs/06-project-context.md:415-421`). Constants, never `platform/config.ts`: they are limits, not environment.
- `helpers.ts` (pure, unit-tested without a database): `candidatesFrom(paths, sizes)` → the `.md` filter, the alphabetical cap and the `truncated` flag; `skipReasonFor(path, bytes, decoded)` → `too_large` / `not_utf8` / `outside_clone`; `tokenCountsFor(docs, tokenizer)`; `orderedSpecs(agentDocs, skillDocs)` → alphabetical by name **and** deduplicated by doc id.
- `service.ts`: orchestration only — `candidates(repoId)` (409 `not_cloned` when the repo has no clone), `importCandidate`, `createDoc`, `saveDoc`, `store(repoId)`, `setAgentDocs`, `setSkillDocs`, and `specsForAgent(agentId, repoId)` returning `{ bodies, names, loaded, total }`.
- Skills: `.claude/skills/onion-architecture/SKILL.md` §11 · §3 · `.claude/skills/security/SKILL.md` — *File Upload Security*
- Satisfies: AC-1, AC-2, AC-3, AC-4, AC-5, AC-29, AC-32…AC-40
- Done when: both bounds are checked **before** any write and both refuse with an explanation that names which bound (AC-36, AC-37), a refused write leaves the stored body byte-identical, and the store works with no clone present (AC-38). The service reaches agents and skills through `container.agentsRepo` / `container.skillsRepo`, never a sibling import.
- Verify: `cd server && pnpm exec vitest run test/context-helpers.test.ts && pnpm lint`
- Risk: a bound checked after the write, or checked on the request rather than on the resulting store size. AC-36's test asserts the *old body is still there*, which is the assertion a check-after-write passes only by accident.

**S6 — routes, module registration, container key**
- Files: `server/src/modules/context/routes.ts` (new) · `server/src/modules/index.ts` (modified — one import, one entry) · `server/src/platform/container.ts` (modified — `contextRepo` + `projectContext` getters and their `ContainerOverrides` keys)
- Routes: `GET /repos/:repoId/context/docs` · `GET /repos/:repoId/context/docs/:docId` · `POST /repos/:repoId/context/docs` (create · upload · import — one body union) · `PUT /repos/:repoId/context/docs/:docId` · `DELETE …/:docId` · `GET /repos/:repoId/context/candidates` · `PUT /agents/:agentId/context-docs` · `PUT /skills/:skillId/context-docs`.
- Skills: `.claude/skills/fastify-best-practices/SKILL.md` — *Core Principles* · `.claude/skills/onion-architecture/SKILL.md` §3
- Satisfies: AC-5, AC-6, AC-7, AC-8, AC-38, AC-39
- Done when: every route declares Zod `params`/`body` from S1's contracts so a bad body is 422'd before the handler; a cross-workspace agent or skill id answers **404**, not 403 and not 500 (AC-8); no clone answers `409 { code: 'not_cloned' }` (AC-5).
- Verify: `cd server && pnpm exec vitest run test/routes-smoke.test.ts && pnpm typecheck && pnpm lint`
- Risk: a service that is not wired into the composition root is unreachable and nothing fails at build time — the route 404s and reads as a routing bug. `routing.md` §5 grades a new service without its composition-root wiring as HIGH.

**S7 — feed the `specs` slot, the log line and the trace**
- Files: `server/src/modules/reviews/run-executor.ts` (modified)
- Shape: mirror `resolveSkills` (`run-executor.ts:369`, `:627-679`) with a `resolveSpecs` that calls `this.container.projectContext.specsForAgent(agent.id, pull.repoId)`, then passes `...(specs.length > 0 ? { specs } : {})` into `reviewPullRequest` alongside the existing spread at `:415`, and sets `specs_read` (currently hard-coded `[]` at `:568`) to the names actually included.
- Skills: `.claude/skills/onion-architecture/SKILL.md` §11 · `.claude/skills/security/SKILL.md` — *Agentic AI Security (OWASP 2026)*
- Satisfies: AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-31 · NFR-1, NFR-5, NFR-7
- Done when, precisely:
  - agent attachments **and** the attachments of every *enabled* skill of that agent are included (AC-9, AC-10) — a globally disabled skill contributes nothing, exactly as its own body already does not;
  - the list is alphabetical by name and deduplicated by doc id, so a document attached to both an agent and its skill appears once (AC-11, AC-31);
  - a doc id whose row is gone is skipped and the run completes normally (AC-12);
  - `runLog.info('Project context: N/M document(s) loaded')` is emitted on **every** run, including runs with zero attachments (`0/0`) and runs with no skips (AC-13, NFR-5);
  - with no available attachment the spread is omitted and the assembled prompt is **byte-identical** to today's (AC-15);
  - no code path passes a document body into `PromptParts.skills` (NFR-1);
  - nothing truncates a body — the size bound is enforced at write time in S5, and an oversized total fails the run loudly (NFR-7).
- Verify: `cd server && pnpm exec vitest run test/context-prompt.test.ts && pnpm lint`
- Risk: the log line emitted only when documents loaded. *"A gate that reports only when it acts is indistinguishable from a gate that never ran"* (`server/INSIGHTS.md:103-110`) — `Project context:` missing from a trace must mean exactly one thing, and NFR-5's threshold is 100 % of runs.

**S8 — pin AC-16 rather than build it (R-4)**
- Files: `server/test/skill-usage.it.test.ts` (new)
- Skills: `.claude/skills/onion-architecture/SKILL.md` §12
- Satisfies: AC-16
- Done when: `test_skill_usage_it` links two agents to one skill through `agent_skills` and asserts `GET /skills` reports `used_by: 2` for it — pinning `SkillsRepository.usageCounts` (`server/src/modules/skills/repository.ts:156`) and `Skill.used_by` (`server/src/vendor/shared/contracts/knowledge.ts:159`), which already ship.
- Verify: `cd server && pnpm exec vitest run test/skill-usage.it.test.ts`
- Risk: writing a second usage aggregate in `modules/context/` because the criterion is in this spec. Two sources of truth for "used by N agents" will disagree the first time one is invalidated and the other is not.

**S9 — the server test set**
- Files: `server/test/context-helpers.test.ts` (new) · `server/test/context-prompt.test.ts` (new) · `server/test/context.it.test.ts` (new) · `server/test/context-prompt.it.test.ts` (new)
- Test names, as *Traceability* binds them: `test_context_candidates`, `test_context_skip_reasons`, `test_context_tokens`, `test_context_ordering`, `test_prompt_specs_absent`, `test_context_trust_boundary`, `test_context_no_clone_writes` (unit); `test_context_routes_it`, `test_context_store_it`, `test_context_bounds_it`, `test_context_attach_it`, `test_context_tenancy_it`, `test_context_prompt_it`, `test_context_missing_it`, `test_context_no_llm_it` (integration).
- Skills: `.claude/skills/onion-architecture/SKILL.md` §12
- Satisfies: every server AC and NFR — see *Traceability*
- Notes that decide whether these tests are worth anything:
  - **Every `*.it.test.ts` here builds the app with `secrets: new MockSecretsProvider({})`.** Not an enumerated list of providers — a list of ports is a list someone will fail to extend, and the bug is invisible exactly on the machine where it is harmless (`server/INSIGHTS.md:130-147`).
  - `test_prompt_specs_absent` asserts **strict string equality** of the assembled prompt, not `not.toContain`: a `not.toContain` passes just as happily when the system message has silently grown whitespace (`reviewer-core/INSIGHTS.md:38-46`, cited by the spec at `server/docs/specs/06-project-context.md:371-374`).
  - `test_context_no_clone_writes` (NFR-8) is **structural**: assert that no source file under `server/src/modules/context/` references a filesystem write API or `container.git`. A behavioural test cannot prove the absence of a path; this one can, and it is the same shape as Smart Diff's "a stub `llm()` that throws is asserted never called" (`server/INSIGHTS.md:579-589`).
  - `test_context_no_llm_it` (NFR-4) injects an `llm()` that throws and asserts the whole store + attach + list flow never reaches it.
  - `test_context_trust_boundary` (NFR-1) asserts a document body appears inside `<untrusted>` in the assembled prompt and **never** inside the `## Skills / rules` section.
  - A test that builds its own fixture must use the row `setupRepoAndPr` hands back — `db.select().from(t.repos)` returns the **seeded** repo, and the symptom is a confusing `Cannot read properties of undefined` several lines later (`server/INSIGHTS.md:25-30`).
- Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` then `pnpm exec vitest run .it.test`
- Risk: running the integration suite against a stack with a live review — `buildApp` reaps `running` rows on construction, unscoped (`server/INSIGHTS.md:170-185`). Also: `Error: No host port found for host IP` from testcontainers is a known flake, roughly one run in six; re-run once and say so rather than retrying until green (`:477-482`).

### PR-2 — client

**S10 — data hooks and contract types**
- Files: `client/src/lib/hooks/context.ts` (new) · `client/src/lib/api.ts` (modified) · `client/src/lib/types.ts` (modified)
- Hooks: `useContextDocs(repoId)`, `useContextDoc(repoId, docId)`, `useContextCandidates(repoId)`, `useRescanContext(repoId)`, `useCreateContextDoc`, `useSaveContextDoc`, `useDeleteContextDoc`, `useSetAgentContextDocs`, `useSetSkillContextDocs`.
- Skills: `.claude/skills/frontend-architecture/SKILL.md` §10 · §12
- Satisfies: — (groundwork for AC-17…AC-24, AC-41…AC-46) · NFR-3
- Done when: contract types are imported with `import type` only; query keys stay module-private and the module is **not** added to `lib/hooks/index.ts`; mutations that change a skill's or agent's attachment set also call the named invalidator that owns the affected list.
- Verify: `cd client && pnpm typecheck && pnpm lint`
- Risk: one runtime import from `@devdigest/shared` costs ~15 kB First Load JS on **every** route (`client/INSIGHTS.md:45-53`) and breaks NFR-3's 102 kB threshold. Adding the module to the hooks barrel is a fresh `no-restricted-syntax` error and `pnpm lint` fails (`:321-330`) — that is the baseline working, not something to re-baseline.

**S11 — the nav entry (isolated commit, frozen path)**
- Files: `client/src/vendor/ui/nav.ts` (modified — **this file only** under `vendor/ui`) · `client/src/components/app-shell/helpers.ts` (modified) · `client/src/components/app-shell/nav-registry.test.ts` (modified)
- Change: `{ key: "context", label: "Project Context", icon: "Folder", href: "/repos/:repoId/context" }` as the **second** item of `WORKSPACE`, after `Pull Requests`. Key, label and icon are taken from the design unchanged; the position is carried by meaning rather than index, because the design's neighbours (`dashboard`, `onboarding-tour`) do not exist here (`client/docs/specs/06-project-context.md:211-217`). No `gKey`, therefore **no** `SHORTCUTS` entry — see *Open decisions*. `helpers.ts` gains a `pathname.includes("/context")` branch; mind the ordering against the existing `/conventions` branch at `helpers.ts:31`.
- Skills: `.claude/skills/frontend-architecture/SKILL.md` §1
- Satisfies: — (groundwork: no AC covers the nav entry — see *Requirements review*)
- Done when: `nav-registry.test.ts` pins the new entry's href, its section (`WORKSPACE`) and its position, and nothing else under `client/src/vendor/ui/**` is in the diff.
- Verify: `cd client && pnpm exec vitest run src/components/app-shell/nav-registry.test.ts`
- Risk: touching anything else under `vendor/ui`. The sanctioned precedent is narrow and explicit — *"make it in one commit, touch nothing else under `vendor/ui`, and say so in the PR body"* (`client/docs/specs/03-skills.md:83-94`).

**S12 — the copy (AC-27)**
- Files: `client/messages/en/context.json` (modified) · `client/src/app/repos/[repoId]/context/context-messages.test.ts` (new)
- Change: rewrite `empty.body` (`context.json:13`), which today reads *"Drop your PRDs… under `.devdigest/specs/`. Every agent and the PR brief read them as grounding context."* Both halves are false: no such path exists, and attachment is explicit rather than automatic. `mode.preview`/`mode.edit` and `editor.save` are wired for the first time; `chunks` and `indexStatus` stay dormant (the spec's non-goal).
- Skills: — none (`routing.md` §1 has no row for `client/messages/**`; recorded in *Open decisions*)
- Satisfies: AC-27
- Done when: `context-messages.test.ts` asserts no string in the namespace contains `.devdigest/specs`, and that the empty-state body describes a manually-filled store read only by attached agents. Any counted noun added here uses an explicit ICU plural — `"{count} docs"` renders `1 docs` and nothing type-checks it (`client/INSIGHTS.md:412-420`).
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/context/context-messages.test.ts`
- Risk: leaving the old copy. *"A left-over old copy instructs the next reader to restore behaviour nobody built"* — the same reason three dormant `skills.json` strings were rewritten in L02 (`client/docs/specs/03-skills.md:161-179`).

**S13 — the route and `ContextView`**
- Files: `client/src/app/repos/[repoId]/context/page.tsx` (new) · `.../_components/ContextView/ContextView.tsx` (new) · `.../ContextView/styles.ts` (new) · `.../ContextView/ContextView.test.tsx` (new)
- Skills: `.claude/skills/next-best-practices/SKILL.md` — *File Conventions* · `.claude/skills/frontend-architecture/SKILL.md` §1 · §10
- Satisfies: AC-23, AC-24, AC-45, AC-46
- Done when: `page.tsx` is one import; `ContextView` owns the hooks and passes results down; the empty state (AC-23) and the error state (AC-24) are **distinguishable** — a failed list must not render as "no documents yet"; the status line shows document count and total size and the word "chunks" appears nowhere (AC-46); three add affordances are present (AC-45). No new `index.ts` in any of these folders. Styles live in `styles.ts` — a `{...a, ...b}` spread in JSX is two lint errors, so export a function returning the whole computed style (`client/INSIGHTS.md:332-340`).
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/context && pnpm lint`
- Risk: rendering "empty" for a failed request. The `blast` tab had to learn this the hard way — a degraded state and a genuinely empty result produce identical empty arrays and mean opposite things (`client/INSIGHTS.md:529-536`).

**S14 — `ContextDocList` and `ContextDocViewer`**
- Files: `.../_components/ContextDocList/ContextDocList.tsx` + `styles.ts` + `ContextDocList.test.tsx` (new) · `.../_components/ContextDocViewer/ContextDocViewer.tsx` + `styles.ts` + `ContextDocViewer.test.tsx` (new)
- Skills: `.claude/skills/frontend-architecture/SKILL.md` §1 · §10 · `.claude/skills/react-testing-library/SKILL.md` — *Query Priority*
- Satisfies: AC-17, AC-22, AC-41, AC-42
- Done when: each row shows the document name and its token count (AC-17), a long name truncates with the full name in a title (edge case); the viewer renders markdown through the existing `Markdown` primitive (`client/src/vendor/ui/primitives/Markdown.tsx`), which supports headings, lists, code fences and paragraphs and **cannot render active content** — which is precisely why it is the right choice for untrusted text (`client/docs/specs/06-project-context.md:326-331`); the mode switch shows an editable field (AC-41); saving shows a saving state and returns to preview on success (AC-42).
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/context`
- Risk: a flex row whose children stretch takes its height from the tallest child, which silently defeated `rows` on the skill body editor and turned its gutter scroll-sync into dead code — it looks fine on a short body and degrades with length, so a screenshot proves nothing (`client/INSIGHTS.md:101-110`). The edge case "very long body must not change the status row's height" is the same hazard.

**S15 — `ContextImportPicker`**
- Files: `.../_components/ContextImportPicker/ContextImportPicker.tsx` + `styles.ts` + `ContextImportPicker.test.tsx` (new)
- Skills: `.claude/skills/frontend-architecture/SKILL.md` §10 · `.claude/skills/react-testing-library/SKILL.md` — *Query Priority*
- Satisfies: AC-19, AC-44
- Done when: candidates come from the API through the hook, never from a prop the test supplies (AC-44); a `skipped` candidate renders **with its reason** and cannot be selected (AC-19); the truncation flag from AC-29 is surfaced; a repo with no `.md` yields an empty picker and a working page.
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/context`
- Risk: a disabled-looking row that is still selectable. AC-19's assertion is that selection is *impossible*, not that it is styled grey.

**S16 — `ContextTargetTab` (agents and skills)**
- Files: `.../_components/ContextTargetTab/ContextTargetTab.tsx` + `styles.ts` + `ContextTargetTab.test.tsx` (new)
- Skills: `.claude/skills/frontend-architecture/SKILL.md` §1 · §10 · `.claude/skills/react-best-practices/SKILL.md` — *Accessibility (HIGH)* · `.claude/skills/react-testing-library/SKILL.md` — *Query Priority*
- Satisfies: AC-18, AC-20, AC-21, AC-28, AC-43 · NFR-6
- Done when: toggling an attachment sends the **whole** id array for the current target in one request (AC-21); each agent or skill row shows the summed token count of its attachments (AC-43); crossing `WARN_CONTEXT_TOKENS` warns without blocking (AC-18); a doc that has left the store shows as `missing` and can still be detached (AC-20); each skill shows how many agents use it, read from `Skill.used_by` (AC-28, R-5); every attachment control has an accessible name that **includes the document name**, is reachable and operable from the keyboard, and exposes its state as state rather than colour (NFR-6).
- Testing shape: assert at the **tab** level from mocked API data, never by handing the component a prop — a badge asserted that way was green for a whole lesson without appearing in the app (`client/INSIGHTS.md:112-122`, and the spec pins this explicitly at `client/docs/specs/06-project-context.md:292-295`). Use `fireEvent` plus role/state queries; do **not** add `@testing-library/user-event` as a side effect of writing this test (`client/INSIGHTS.md:234-240`).
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/context`
- Risk: sending a delta instead of the full set. AC-6/AC-7 are written as *replace the previous set*, so a client that sends only the changed id leaves the server's replace semantics correct and the result wrong.

**S17 — the trace block's token count**
- Files: `.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx` (modified) · `.../RunTraceDrawer/_components/TraceBody/TraceBody.test.tsx` (new or modified) · `client/messages/en/runs.json` (modified — one key)
- Change: give the existing `specs` `PromptBlock` (`TraceBody.tsx:113-115`) a header token count, in the shape the skills block already uses at `:90-98` (`Skills / rules · 4,210 tokens`). Everything else is already in place: the block is collapsible (`PromptBlock.tsx`), and the `!= null` guard means a trace with no specs renders exactly as it does today.
- Skills: `.claude/skills/frontend-architecture/SKILL.md` §10 · `.claude/skills/react-testing-library/SKILL.md` — *Query Priority*
- Satisfies: AC-25, AC-26
- Done when: a trace with `prompt_assembly.specs` shows a `Project context · N tokens` header that expands to the full text (AC-25); a trace without it renders with no such row and no empty one (AC-26).
- Verify: `cd client && pnpm exec vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/RunTraceDrawer`
- Risk: the route-local test's path to `messages/` is **eight** levels up from a `_components/<Name>/` folder, and seven — the intuitive count — fails at import time with no hint of the right depth. Copy the specifier from `RunTraceDrawer.test.tsx`, which has it right (`client/INSIGHTS.md:225-232`).

---

## Traceability

Every live criterion has a row. AC-30 is listed as withdrawn so that "withdrawn" and
"nobody noticed" cannot look alike.

| AC | Criterion (≤12 words) | Step | Test | Note |
|---|---|---|---|---|
| AC-1 | list every `.md` in the clone, excluding vendor dirs | S3, S5 | `test_context_candidates` | exclusions reused from `source-scope.ts` (R-2) |
| AC-2 | cap the candidate list at `MAX_LISTED_DOCS`, alphabetically | S5 | `test_context_candidates` | — |
| AC-3 | report each document's token count from the tokenizer | S5 | `test_context_tokens` | mock `Tokenizer` |
| AC-4 | mark a candidate `skipped` with a machine-readable reason | S5 | `test_context_skip_reasons` | one case per reason (three) |
| AC-5 | no clone → `409 { code: 'not_cloned' }`, not 500 | S6 | `test_context_routes_it` | — |
| AC-6 | replace an agent's whole document set for a repo | S4, S6 | `test_context_attach_it` | — |
| AC-7 | replace a skill's whole document set for a repo | S4, S6 | `test_context_attach_it` | — |
| AC-8 | reject attaching across workspaces with `404` | S4, S6 | `test_context_tenancy_it` | tenant key required, not optional |
| AC-9 | agent's attached bodies go into the `specs` slot | S7 | `test_context_prompt_it` | — |
| AC-10 | enabled skills' attached bodies join the same slot | S7 | `test_context_prompt_it` | a globally disabled skill contributes nothing |
| AC-11 | order documents in the slot alphabetically by name | S5, S7 | `test_context_ordering` | pure helper |
| AC-12 | a deleted attached document is skipped, run completes | S7 | `test_context_missing_it` | — |
| AC-13 | log `Project context: N/M document(s) loaded` every run | S7 | `test_context_missing_it` | same observable as NFR-5 |
| AC-14 | `RunTrace.specs_read` names exactly the included documents | S7 | `test_context_prompt_it` | field exists (`trace.ts:117`), always `[]` today |
| AC-15 | no attachments → prompt byte-identical to today | S7 | `test_prompt_specs_absent` | **strict string equality** |
| AC-16 | report how many agents use each skill | S8 | `test_skill_usage_it` | already ships — pinned, not built (R-4) |
| AC-17 | show each document with its name and token count | S14 | `ContextDocList.test.tsx` | from mocked API data |
| AC-18 | warn past `WARN_CONTEXT_TOKENS` without blocking | S16 | `ContextTargetTab.test.tsx` | — |
| AC-19 | show a `skipped` candidate with its reason, unselectable | S15 | `ContextImportPicker.test.tsx` | — |
| AC-20 | show a removed attached document as `missing`, detachable | S16 | `ContextTargetTab.test.tsx` | — |
| AC-21 | send the target's full id set in one request | S16 | `ContextTargetTab.test.tsx` | full array, never a delta |
| AC-22 | show a selected document as rendered markdown | S14 | `ContextDocViewer.test.tsx` | existing `Markdown` primitive, no active content |
| AC-23 | empty store → an empty state with a call to action | S13 | `ContextView.test.tsx` | — |
| AC-24 | failed list → an error state distinct from empty | S13 | `ContextView.test.tsx` | — |
| AC-25 | trace shows `Project context` with tokens, expandable | S17 | `TraceBody.test.tsx` | block already exists; only the count is new |
| AC-26 | trace without `specs` renders unchanged | S17 | `TraceBody.test.tsx` | already true via the `!= null` guard |
| AC-27 | describe the store as manual and attachment-scoped | S12 | `context-messages.test.ts` | no `.devdigest/specs` in any string |
| AC-28 | show each skill's using-agent count on the tab | S16 | `ContextTargetTab.test.tsx` | from `Skill.used_by` (R-5) |
| AC-29 | flag a candidate list truncated by the cap | S5 | `test_context_candidates` | — |
| ~~AC-30~~ | ~~reject attaching a `skipped` document~~ | — | — | **withdrawn in the spec** (`server/…:169-173`); no work, number not reused |
| AC-31 | deduplicate the slot across agent and skill | S5, S7 | `test_context_ordering` | — |
| AC-32 | import a candidate as a document with its text | S5, S6 | `test_context_store_it` | via `MockSourceReader` |
| AC-33 | create a named document with an empty body | S5, S6 | `test_context_store_it` | — |
| AC-34 | create a document from an uploaded `.md` | S5, S6, S13 | `test_context_store_it` | client-side `FileReader`, same endpoint (R-1) |
| AC-35 | replace a document's body on save | S5, S6 | `test_context_store_it` | — |
| AC-36 | reject a body past `MAX_DOC_BYTES`, keep the old one | S5 | `test_context_bounds_it` | asserts the stored body is unchanged |
| AC-37 | reject a create that would exceed `MAX_STORE_BYTES` | S5 | `test_context_bounds_it` | — |
| AC-38 | the store works with no clone present | S5, S6 | `test_context_routes_it` | — |
| AC-39 | rescan rebuilds candidates from the clone's current state | S3, S6 | `test_context_routes_it` | the design's "Re-index" button, reassigned |
| AC-40 | two sequential writes → the last one wins, no rejection | S4, S5 | `test_context_store_it` | last-write-wins, no conflict detection |
| AC-41 | edit mode shows the body in an editable field | S14 | `ContextDocViewer.test.tsx` | — |
| AC-42 | saving shows a state, then returns to preview | S14 | `ContextDocViewer.test.tsx` | — |
| AC-43 | show each target's summed attachment token count | S16 | `ContextTargetTab.test.tsx` | asserted at the tab, not the card |
| AC-44 | the import picker shows the repo's `.md` candidates | S15 | `ContextImportPicker.test.tsx` | from the API |
| AC-45 | offer three ways to add a document | S13 | `ContextView.test.tsx` | import · new · upload |
| AC-46 | show a store status line, never chunks or index state | S13 | `ContextView.test.tsx` | compound — see *Requirements review* |
| NFR-1 | bodies reach the prompt only through the wrapped slot | S7 | `test_context_trust_boundary` | zero paths into `PromptParts.skills` |
| NFR-2 | both size bounds checked before every write | S5 | `test_context_bounds_it` | 64 kB per doc, 2 MB per store |
| NFR-3 | shared First Load JS stays at 102 kB | S10 | — | **manual, once:** `pnpm build`, dev server stopped |
| NFR-4 | the feature adds zero model calls | S5, S6 | `test_context_no_llm_it` | a stub `llm()` that throws |
| NFR-5 | one `Project context:` log line in 100 % of runs | S7 | `test_context_missing_it` | present even with zero skips |
| NFR-6 | attachment is keyboard-operable and screen-reader legible | S16 | `ContextTargetTab.test.tsx` | `fireEvent` + roles; no `user-event` dependency |
| NFR-7 | never silently truncate a document body | S5, S7 | — | **manual, once:** out-of-window behaviour needs a real provider |
| NFR-8 | zero write paths under `server/clones/**` | S9 | `test_context_no_clone_writes` | structural assertion over the module's source |

---

## Companion changes

`routing.md` §5 over the whole change set:

| The change set contains | It must also contain | Where |
|---|---|---|
| a new repository and a migration | a touched `*.it.test.ts` | S9 — `context.it.test.ts`, `context-prompt.it.test.ts` |
| eight new routes | Zod validation, a workspace-scoped auth path, and tests | S6 (validation + tenancy) and S9 (`test_context_tenancy_it`) |
| a new service and repository | wiring in the composition root | S6 — `container.contextRepo`, `container.projectContext`, plus their `ContainerOverrides` keys |
| a changed Zod contract | **both** vendored copies and the client call sites | S1 regenerates `client/src/vendor/shared/**` via `./scripts/vendor-shared.sh`; S10 is the call site. `--check` runs in the `lint` workflow and the `vendor-sync` gate |
| a new untrusted input reaching the prompt | `INJECTION_GUARD` applied to it | S7 — unchanged engine, existing `wrapUntrusted('spec-N', …)`; pinned by `test_context_trust_boundary` |
| a new port method | interface, implementation, test double, container override key | S3 — `MockSourceReader.list` is the half most often forgotten, and without it no test can exercise the picker without a temp directory |
| a new nav route | its `app-shell/helpers.ts` branch and a `nav-registry.test.ts` row | S11 |
| new counted nouns in `messages/` | explicit ICU plural arms | S12, S13 — `"{count} docs"` renders `1 docs` and nothing type-checks it |
| a new `lib/hooks/<domain>.ts` | **no** entry in `lib/hooks/index.ts` | S10 — a sixth barrel line is a fresh lint failure |

No secret is read on any path, so `SecretsProvider` needs no new caller. No test is deleted.
`code_chunks` and the `chunks` / `indexStatus` message keys stay dormant — they are lesson
extension points, and removing them is not this change's business.

---

## End-to-end verification

**PR-1, from `server/`:**

```bash
pnpm db:migrate                                   # migrations do NOT run on boot
pnpm typecheck && pnpm lint
pnpm exec vitest run --exclude '**/*.it.test.ts'  # fast lane, no Docker
pnpm exec vitest run .it.test                     # real Postgres via testcontainers
cd .. && ./scripts/vendor-shared.sh --check       # both copies in sync
```

Do not run the integration lane while a review is in flight against the same database:
`buildApp` reaps `running` rows on construction, unscoped (`server/INSIGHTS.md:170-185`). A
`No host port found for host IP` failure is a known testcontainers flake — re-run once and
say so (`:477-482`).

**PR-2, from `client/`:**

```bash
pnpm typecheck && pnpm lint && pnpm test
# STOP the dev server first — see below
pnpm build
```

`pnpm build` is the only check that catches the webpack `.js`→`.ts` vendor-resolution trap,
and it is also the one that poisons `client/.next` if `pnpm dev` is running. The failure
renders the whole app correctly in serif type with a single 404 on `layout.css`, which reads
as a styling bug and is not one; recovery is `rm -rf client/.next` **and** a full restart
(`client/INSIGHTS.md:89-99`, `:124-137`, `:139-156`). Read the shared First Load JS off the
build output and confirm it is still **102 kB** — that is NFR-3's threshold and its only check.

**The whole feature, once, by hand:** import a `.md` from a cloned repo, edit and save it,
attach it to an agent, run a review on a real PR, then open the run trace and confirm the
`Project context` block holds exactly that text and `Specs read` names exactly that document.
Note that a review against **seeded** data cannot show this: seeded PR files carry
`patch: null` and the seed inserts no `agent_runs` row (`server/INSIGHTS.md:66-71`, `:32-36`),
so this needs a genuinely imported repo with a clone.

---

## Out of scope

- **AC-30** — withdrawn in the spec. No step, no test, and the number is not reused.
- **Any write to the clone, git or GitHub.** No commit, no push, no branch, no PR. NFR-8
  makes this failable, and S9 asserts it structurally.
- **Chunking and embeddings.** `code_chunks` (`server/src/db/schema/context.ts:31-47`) stays
  empty and untouched; the `"{count} chunks"` and `indexStatus` message keys stay dormant.
- **Any change to `reviewer-core`.** The slot exists and is fed from the server.
- **Folders.** The store is flat; the design's `New folder` button is not implemented.
- **Versioning, history and rollback.** An edit silently changes what every attached agent
  sees, and the past cannot be reconstructed — `specs_read` stores names, not bodies. This is
  the owner's decision, carried; UX-5 and UX-6 propose mitigations and are not in this plan.
- **Tracking an imported document against its source file.** After import it is an
  independent copy and drift is invisible (UX-2, UX-3).
- **User-defined attachment order, globs, directories, or attaching more than one document
  per selection.** Order is alphabetical; exactly one document is attached at a time.
- **The agent editor and the skill editor.** Attachment lives only on the Project Context
  page; `Config · Skills · Evals · Stats · CI` and `Config · Preview · Evals · Stats · Versions`
  are not touched.
- **`CircularScore` / `COVERAGE`** from the design — coverage reduces to `Used by N agents`.
- **A browser e2e flow.** The spec proposes none: nothing on the page is invisible to jsdom,
  and the one thing that would need a real browser — scroll — is not present
  (`client/INSIGHTS.md:174-184`).
- **Migrating `repo-intel` onto `SourceReader`.** S3 gives that migration a target; performing
  it is five call sites across four files and its own change, exactly as
  `server/docs/specs/04-conventions.md:276-288` already says.
- **Adding `@testing-library/user-event`** to `client/`. If it is wanted, it is a deliberate
  change of its own.

---

## Open decisions / Not established

| Open question | Where I looked | Why it is still open | What would settle it |
|---|---|---|---|
| The four thresholds (`MAX_DOC_BYTES` 64 000, `MAX_STORE_BYTES` 2 000 000, `MAX_LISTED_DOCS` 500, `WARN_CONTEXT_TOKENS` 20 000) are chosen, not measured | `server/docs/specs/06-project-context.md:415-421`; nearest in-repo anchors are `DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500` (`server/src/modules/repo-intel/constants.ts:47`) and the conventions extractor caps | both anchors are about a different volume of text | measuring the `.md` corpus of two or three real imported repos; the constants live in one file (S5) and are cheap to move |
| No versioning: an edit silently changes every attached agent's context, with no history and no way to reproduce a past run's prompt | spec's open questions, both files; `client/docs/specs/03-skills.md:57` solves it for skills with `v(n+1)` snapshots | owner's decision, taken deliberately, and it bites harder now that documents are editable | a product call to adopt the skills' snapshot model here too |
| An imported document does not track its source file; drift is invisible | UX-2, UX-3 in the server spec | proposals, not accepted requirements | accepting UX-2 (store a source hash, compare on rescan) as its own change |
| Concurrent writes are last-write-wins with no conflict detection (AC-40) | spec's open questions, both files | the lightest option, and AC-40 requires it as written | accepting UX-6 (dirty-state tracking) or adding an `If-Match`-style version column |
| `container.tokenizer` counts `cl100k_base` regardless of the agent's model (`server/src/adapters/tokenizer/index.ts:20-45`), and this feature makes that number visible to a user for the first time | the adapter, whose fallback is `ceil(chars/4)` and never throws | for non-OpenAI models the displayed count is an approximation with nothing on screen saying so | a decision on whether to label it, or to resolve an encoding per provider |
| No accessibility standard exists in this repo — NFR-6 is the first such requirement | word-boundary search for `accessibility`, `a11y`, `WCAG`, `aria`, `keyboard`, `screen reader` across all eleven specs: zero matches | there is nothing to write NFR-6 against, so it was written in observable terms instead | a product-owner decision on a standard; until then S16 implements the wording as given |
| The nav entry has no `gKey`, so it gets no `SHORTCUTS` row | the design item quoted at `client/docs/specs/06-project-context.md:211-217` carries key, label and icon only; `client/src/vendor/ui/nav.ts:66-78` shows every other nav item does have one | assigning a letter would be inventing a requirement the spec did not state | you naming a letter (`g x`), or confirming the absence is intended |
| `client/messages/**` matches **no** group in `.claude/skills/pr-self-review/routing.md` §1, so S12's copy change — the fix for a string the spec calls false — is reviewed by nothing | `routing.md` §1, all eighteen rows | *"a file in no group is not reviewed, and that is a decision"* — but here it looks like an oversight, the same shape as the `mcp/src/**` gap that row exists to remember | a `routing.md` change of its own; out of scope for this plan, and named here rather than fixed |
