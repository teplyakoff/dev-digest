# 04 — Conventions Extractor (server)

Owns: the `conventions` module — sampling, extraction, evidence verification,
the review queue, and the merged skill draft.

Plan: [`docs/plans/L02-conventions.md`](../../../docs/plans/L02-conventions.md).
Client: [`client/docs/specs/04-conventions.md`](../../../client/docs/specs/04-conventions.md).

## Problem

A skill has to be written by hand today. The rules it would contain are already
in the repo — in every route handler, every error path, every import block — and
nothing harvests them.

The extractor harvests them, and then does the thing that makes the output
trustworthy: **it drops every candidate that cannot point at real code.** This is
the review pipeline's grounding invariant one layer up. A finding that doesn't
cite a real diff line is dropped; a convention that doesn't cite a real file+line
is dropped, and the score of the feature is what survives.

### The decision the whole module rests on

The model returns `evidence_path`, `evidence_start_line`, `evidence_end_line`.
**It never returns the snippet.** The server re-reads those lines from the clone
and stores what it read.

A fabricated snippet is therefore not unlikely — it is unrepresentable. Every
snippet on screen is the code that is really at those lines, which is also what
makes the GitHub deep-link honest: the link and the snippet resolve to the same
bytes at the same SHA.

## Schema

**Two** migrations, both generated with `pnpm db:generate` (never hand-edit an
applied file):

- `0013_hot_pepper_potts.sql` — creates `convention_scans`, adds the seven new
  `conventions` columns, both foreign keys, and the two `repo_id` indexes.
- `0014_material_the_phantom.sql` — `ALTER TABLE conventions DROP COLUMN accepted`.

It is two files rather than one for a tooling reason worth writing down: with a
dropped column and added columns in the same table, `drizzle-kit generate` stops
on an interactive "is `scan_id` created, or renamed from `accepted`?" prompt that
needs a real TTY and cannot be answered from a pipe. Generating the additions
first (nothing dropped → no ambiguity) and the drop second (nothing added → no
ambiguity) gets both files non-interactively, with correct snapshots. Do the same
for any future migration that drops one column while adding others.

`conventions` has never held a row, so dropping a `NOT NULL` column is free.

`status` replaces `accepted` because a boolean cannot distinguish *not reviewed*
from *rejected*, and "a rejected candidate never reaches the skill" is the claim
under test — it needs a third state to be observable.

New table — one row per extraction run. It is where the quality report lives:

```ts
export const conventionScans = pgTable('convention_scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
  /** The SHA the samples were read at. Every evidence permalink pins to it. */
  indexedSha: text('indexed_sha').notNull(),
  sampledFiles: jsonb('sampled_files').$type<string[]>().notNull(),
  configFiles: jsonb('config_files').$type<string[]>().notNull(),
  /** What the model returned, before verification. */
  proposed: integer('proposed').notNull(),
  /** What survived it. `proposed - kept` is the hallucination rate, per scan. */
  kept: integer('kept').notNull(),
  dropped: jsonb('dropped').$type<{ rule: string; reason: string }[]>().notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  costUsd: doublePrecision('cost_usd'),
  createdAt: now(),
});
```

`cost_usd = null` means UNKNOWN, `0` means free — the same rule the run tables
follow. Do not collapse them.

## Contracts

`src/vendor/shared/contracts/knowledge.ts`, then `./scripts/vendor-shared.sh`,
then commit **both** copies in the same change.

```ts
export const ConventionCategory = z.enum([
  'naming', 'structure', 'error-handling', 'typing',
  'testing', 'api', 'imports', 'logging', 'other',
]);

export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);

// No `file_missing`: verification runs against the exact files the prompt
// carried, so "cannot find that file" has one shape. A file that failed to read
// never entered the prompt, so no candidate can cite it.
export const ConventionDropReason = z.enum([
  'file_not_sampled',   // cited a file the model was never shown
  'line_out_of_range',  // start/end outside the lines we actually sent
  'empty_snippet',      // the cited span is blank
  'duplicate_rule',     // same normalized rule as an earlier candidate
]);

// REPLACES the starter's `ConventionCandidate` (which had `accepted: boolean`
// and no line numbers). Nothing consumed it, so the change costs no migration
// of callers — but it IS a breaking contract change, and the API Contract
// Reviewer should be expected to say so on this very PR.
export const ConventionCandidate = z.object({
  id: z.string(),
  category: ConventionCategory,
  rule: z.string(),
  evidence_path: z.string(),
  evidence_start_line: z.number().int().positive(),
  evidence_end_line: z.number().int().positive(),
  /** Read from the clone at those lines. NEVER model-authored. */
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  /** Set once the candidate has been merged into a skill. */
  skill_id: z.string().nullable(),
});

export const ConventionScan = z.object({
  id: z.string(),
  repo_id: z.string(),
  indexed_sha: z.string(),
  sampled_files: z.array(z.string()),
  config_files: z.array(z.string()),
  proposed: z.number().int(),
  kept: z.number().int(),
  dropped: z.array(z.object({ rule: z.string(), reason: ConventionDropReason })),
  provider: Provider,
  model: z.string(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  created_at: z.string(),
});

/** What the page shows: the last scan (or null) plus its surviving candidates. */
export const ConventionsView = z.object({
  scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
});

/** Server-built merge of the ACCEPTED candidates. The modal edits this text. */
export const ConventionSkillDraft = z.object({
  name: SkillName,
  description: z.string(),
  type: SkillType,
  enabled: z.boolean(),
  body: z.string(),
  candidate_ids: z.array(z.string()),
});
```

## Routes — `modules/conventions/`

One new folder, one line in `modules/index.ts`. Nothing else registers routes.

| Route | Returns |
|---|---|
| `POST /repos/:id/conventions/extract` | `200 ConventionsView` — runs the pipeline, replaces the previous candidate set |
| `GET /repos/:id/conventions` | `200 ConventionsView` — `{ scan: null, candidates: [] }` before the first scan |
| `PATCH /conventions/:id` | `200 ConventionCandidate` — body `{ status?, rule?, category? }` |
| `GET /repos/:id/conventions/skill-draft` | `200 ConventionSkillDraft`, `422` when nothing is accepted |
| `POST /repos/:id/conventions/skill` | `201 Skill` — body is the edited draft |

Every route resolves tenancy through `getContext` and scopes by `workspaceId`;
`params`/`body` are Zod schemas on the route, never parsed by hand in the handler.

`POST …/extract` is **synchronous**. Bounded input (≤ 15 files, ≤ 120 kB) and a
cheap model make it a seconds-scale call, and one spinner beats a poll loop.
`server/INSIGHTS.md`'s 10-minute-provider warning is about full-diff reviews; the
call still carries an explicit `timeoutMs` and `maxTokens` so a hung provider
fails the request instead of hanging it.

Failure modes are answers, not 500s:

- repo not cloned → `409 { code: 'not_cloned' }`
- `getConventionSamples` returns `[]` (flag off or never indexed) →
  `409 { code: 'not_indexed' }`, which the page renders with a "Re-index" CTA
- provider key missing → the existing `ValidationError` path, unchanged

`POST …/skill` creates the skill with `source: 'extracted'` — the first use of a
value the contract has always had — and stamps `skill_id` on the merged
candidates **in the same transaction**. A skill that exists while its candidates
still read `skill_id: null` would make the "already exported" state a lie.

It reaches skills through **`container.skills`**, not by importing
`../skills/service.js`. Onion §11 makes a sibling module private and the lint
rule enforces it; the container is the sanctioned route, exactly as `agentsRepo`
and `reviewRepo` already are. Re-implementing the v1 snapshot and the
duplicate-name translation locally to avoid the import would have been the worse
trade.

That transaction needed one change on the skills side: `SkillsService.create`
now takes an optional `tx` and uses it instead of opening its own. Two
transactions is not atomicity, and it reads exactly like code that works
(`db/client.ts`).

Duplicate names are not special-cased here: `SkillsService` already throws
`ConflictError` with a message a person can act on, and the modal is the right
place to rename.

The **service trusts its own accepted set, not the `candidate_ids` the client
echoes back**. A client holding a stale draft would otherwise stamp — and
silently include — a candidate that has since been rejected.

## Pipeline

`service.ts` orchestrates four steps. Only step 2 involves a model.

### 1. Sample — `samples.ts`, code only

Config allowlist, first match per family:

```
eslint.config.{js,mjs,cjs,ts}  ·  .eslintrc{,.json,.js,.cjs}
tsconfig.json  ·  biome.json  ·  .editorconfig
.prettierrc{,.json}  ·  prettier.config.{js,mjs,cjs}
package.json  → reduced to { scripts, dependencies, devDependencies } only
```

Looked for at the repo root **and in each package directory**. This spec first
said root only, and the first live run disproved it: `teplyakoff/dev-digest` is
five standalone packages with nothing at its root, so the scan sampled ZERO
config files — the most rule-dense input there is, missing entirely, with nothing
on screen to say so.

The package directories are **derived from the ranked sample paths' first
segments** (`server/src/db/schema/core.ts` → `server`), not discovered by
listing: the packages whose code ranks highest are the ones whose conventions
matter, it costs no extra I/O, and `SourceReader` stays a one-method port instead
of growing a directory walk. One file per family PER SCOPE — `server/tsconfig.json`
and `client/tsconfig.json` are two different sets of rules, and collapsing them
would hide whichever package sorted second.

Then `repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT)` — top-12 by
rank, tests/configs/migrations already excluded by the facade.

Caps (`constants.ts`): `MAX_CONFIG_BYTES = 4_000` each · `MAX_SAMPLE_LINES = 180`
· `MAX_SAMPLE_BYTES = 8_000` each · `SAMPLE_FILE_COUNT = 12` ·
`MAX_PACKAGE_DIRS = 3` · `MAX_CONFIG_FILES = 8` · `MAX_TOTAL_BYTES = 120_000`.

Measured effect on `teplyakoff/dev-digest`, same model, same prompt, same 20
proposed candidates:

| | configs sampled | kept | dropped |
|---|---|---|---|
| root-only | 0 | 7 / 20 | 13, all `duplicate_rule` |
| + package dirs | 4 | **20 / 20** | 0 |

The duplicates were a symptom, not the disease: given four config files to reason
about, the model stopped restating one hook file's imports four different ways.

Every sampled file is rendered **with 1-based line numbers**, and truncation is
stated in-band:

```
--- src/api/users.ts (lines 1-180 of 412, truncated) ---
   1| import { db } from "../lib/db";
   …
  23| const user = await db.users.find(id);
```

The line numbers are what make a citation checkable at all; the truncation notice
is what stops the model citing line 300 of a file it only saw 180 lines of.

**Reading the clone goes through a port, not `node:fs`.** This spec originally
said the opposite — copy `repo-intel`'s `// KNOWN DEBT` disable and move on — and
that was wrong. `service.ts` is ring 2, where the onion lint rule forbids `fs`
and names the fix in its own error message: put it behind a port. That port is
the `SourceReader` `repo-intel/service.ts` has been documenting as debt, so it
was built rather than excused a second time:

- `SourceReader` in `vendor/shared/adapters.ts` — one method, `read(clonePath,
  relPath) → string | null`, refusing absolute paths and any `..` that escapes;
- `FsSourceReader` in `adapters/source/fs-reader.ts`;
- `MockSourceReader` in `adapters/mocks.ts` — an in-memory `Record<path,
  contents>`, which is what lets the sampling tests run with no temp directory;
- `container.sourceReader`, overridable via `ContainerOverrides`.

`repo-intel` is deliberately NOT migrated onto it here — five call sites across
four files is its own change. The count of `no-restricted-imports` disables in
`server/src` is unchanged at 7 by this work.

Splitting the reads out this way also buys the property the verifier depends on:
the clone is read ONCE, and both the prompt and the verification work off the
same `SampledFile` map. A second read could race with a checkout and validate a
citation against bytes the model never saw.

### 2. Extract — `prompt.ts` + one structured call

`schemaName: 'ConventionExtraction'` (the name `adapters/mocks.ts` already
documents, so `structuredBySchema` fixtures work unchanged).

```ts
const ExtractedConvention = z.object({
  category: ConventionCategory,
  rule: z.string().min(10).max(200),
  evidence_path: z.string(),
  evidence_start_line: z.number().int().positive(),
  evidence_end_line: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});
export const ConventionExtraction = z.object({
  candidates: z.array(ExtractedConvention).max(MAX_CANDIDATES),
});
```

Model choice: **`container.featureModel(workspaceId, 'conventions')`** first,
falling back to the module's own cheap default (`openrouter` /
`deepseek/deepseek-v4-flash` in `constants.ts`) — the exact path
`feature-models.ts` reserves for "callers that keep their own dynamic default
(e.g. conventions)". `resolveFeatureModel` would substitute the registry's
`gpt-5.4`, which is not a cheap model, and extraction re-runs on every re-scan.

The accessor is on the container for the same §11 reason as skills:
`modules/settings/feature-models.ts` is a sibling to every feature that asks, and
the composition root is the layer allowed to know about both. It returns the
override ONLY — a caller with its own default has to be able to see the absence,
which `resolveFeatureModel` hides behind the registry value.

**Prompt-injection defense.** Sampled repo files are untrusted input by the same
definition the review path uses, so they are wrapped in `<untrusted>…</untrusted>`
and the system message ends with the shared `INJECTION_GUARD`. That constant is
currently module-private in `reviewer-core/src/prompt.ts`; export it from
`prompt.ts` and re-export from `index.ts`. Copying the text into this module
would satisfy the compiler and break the invariant that there is exactly one such
rule — which is the invariant, not the text.

The rest of the prompt is short and mostly negative: describe rules the code
*follows repeatedly*, not one-off style; never invent a file; cite the narrowest
span that shows the rule (≤ 12 lines); return fewer candidates rather than weaker
ones.

### 3. Verify — `verify.ts`, pure, no model, no clone

Signature is `(candidates, sampled: Map<path, {lines: string[], shownUpTo: number}>) => {kept, dropped}`
— pure, so its tests are a fixture literal and no filesystem.

Per candidate, in order, first failure wins:

1. `evidence_path` ∈ `sampled`, after forgiving a `./` prefix and a trailing
   `:23` / `:23-31` the model copied from the citation format → else
   `file_not_sampled`
2. `1 ≤ start ≤ end ≤ shownUpTo` → else `line_out_of_range`. Against
   `shownUpTo`, **not** the file's length: a citation into the truncated tail is
   a guess about text the model never received, however real that line is.
3. slice `[start, end]`, clamping the span to `MAX_EVIDENCE_SPAN` rather than
   dropping — an over-long span is a badly framed citation, not a false one
4. trim blank edges; a span that trims to nothing → `empty_snippet`.
   Comment-only spans are **kept**: "every exported function carries a JSDoc
   block" is a real convention whose only possible evidence is a comment.
5. normalized rule (lowercased, punctuation and backticks stripped, collapsed
   whitespace) unseen → else `duplicate_rule`

Survivors carry `evidence_snippet` = the slice **read from disk**.

### 4. Persist — `repository.ts`

One transaction: insert the `convention_scans` row, delete the repo's previous
candidates, insert the survivors.

Re-scan carries decisions forward: before deleting, load the previous rows into a
`Map<normalizedRule, status>` and re-apply `accepted` / `rejected` to matching new
candidates. Without it every re-scan re-proposes what you already rejected, which
is exactly the behaviour that makes a suggestion feature get switched off.

## The merged skill

`GET …/skill-draft` reads `status = 'accepted'` — nothing else can enter the
body — and renders one markdown document grouped by category:

```md
# repo-conventions

House conventions for `acme/payments-api`, extracted from 15 sampled files at
`a1b2c3d`. Flag a change that violates a rule below and cite the offending
`file:line`. Do not flag code that merely differs in style from these examples;
only flag violations of the stated rule.

## error-handling

- Route handlers return `Result<T, ApiError>` rather than throwing.
  Seen in `src/api/public/index.ts:14-20`:

  ```ts
  function handler(): Result<Item[], ApiError> {
    return ok(items);
  }
  ```
```

Defaults: `name: 'repo-conventions'`, `type: 'convention'`, `enabled: true`,
`description: "N house conventions extracted from <full_name>"`. All editable in
the modal; only membership is not.

## Verification

Unit (no Docker, no model):

No fixture directory: both units are pure over plain data, so the tests are
literals. (This spec first called for a fixture directory; extracting
`SourceReader` made it unnecessary, and a test that needs no temp dir is one
fewer thing that can fail for a reason unrelated to the code.)

- `conventions-samples.test.ts` (17) — the config allowlist picks one file per
  family and one per *mid-migration* family; `package.json` reduces to three
  keys and `null` when unparseable; a 412-line file truncates at 180 **and says
  so in the header**; the gutter is right-aligned; line counting matches an
  editor on LF, CRLF and a missing trailing newline; at least one line always
  renders however long it is; the total budget stops adding files rather than
  shrinking one, and refuses everything after the first refusal so membership
  depends on rank rather than on file size.
- `conventions-verify.test.ts` (16) — one case per `ConventionDropReason`, plus
  the load-bearing one: a survivor's snippet is **sliced from the sampled map**,
  never supplied by the model. Also: a citation into the truncated tail is
  `line_out_of_range` even though the line really exists in the file; an
  over-long span is clamped and its stored `evidence_end_line` moves with the
  snippet, so the GitHub link cannot highlight more than the snippet shows; a
  comment-only span is KEPT; and dedupe is seeded only by survivors, so one bad
  citation cannot suppress a good citation of the same rule.
- `source-reader.test.ts` (8) — every failure reads `null`; `..`, absolute paths
  and a sibling directory sharing the clone's name prefix are all refused, while
  `./` and an inward `..` still resolve.
- `conventions-helpers.test.ts` (9) — the merged body carries each rule with its
  verified evidence, groups by category, names the repo and the short SHA, tells
  the reviewing model not to flag mere stylistic difference, and fences a snippet
  that itself contains backticks (real code does — a three-backtick fence would
  close early and spill the rest of the snippet into the skill as instructions).

`reviewer-core/test/prompt.test.ts` gains one assertion: the exported
`INJECTION_GUARD` is byte-identical to what `assemblePrompt` appends, so the
export cannot quietly fork into a weaker second version.

Integration (`conventions.it.test.ts`, 10 tests, real Postgres, `MockLLMProvider`
with a `structuredBySchema.ConventionExtraction` fixture and `MockSourceReader`
as the clone):

- extract → the stored `evidence_snippet` is byte-identical to the fixture file's
  lines, and the fixture supplied no snippet at all;
- the config allowlist is sampled and `package.json` arrives reduced;
- two ungrounded candidates are dropped and both reasons land on the scan row —
  `proposed: 3, kept: 1`;
- accept / reject / edit, including that editing the rule does not un-accept it;
- re-extract preserves a prior `rejected` decision while leaving an untouched
  candidate `pending`;
- `skill-draft` is 422 until something is accepted, then contains the accepted
  rule and **not** the rejected one;
- `POST …/skill` creates a skill with `source: 'extracted'`, snapshots v1, and
  stamps `skill_id` on exactly the accepted candidate;
- extract on a repo with no index → `409 not_indexed`, and **no scan row** — a
  scan that sampled nothing is not a scan;
- `GET` before the first scan → `{ scan: null, candidates: [] }`.

Prompt (`reviewer-core`): one assertion that the exported `INJECTION_GUARD` is
the same string `assemblePrompt` appends, so the export cannot drift into a copy.
