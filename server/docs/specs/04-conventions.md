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

export const ConventionDropReason = z.enum([
  'file_not_sampled',   // cited a file the model was never shown
  'file_missing',       // path not readable in the clone
  'line_out_of_range',  // start/end outside the lines we actually sent
  'empty_snippet',      // the cited span is blank or comment-only
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

`POST …/skill` creates the skill through `SkillsService.create` with
`source: 'extracted'` — the first use of a value the contract has always had —
and stamps `skill_id` on the merged candidates **in the same transaction**. A
skill that exists while its candidates still read `skill_id: null` would make the
"already exported" state a lie.

Duplicate names are not special-cased here: `SkillsService` already throws
`ConflictError` with a message a person can act on, and the modal is the right
place to rename.

## Pipeline

`service.ts` orchestrates four steps. Only step 2 involves a model.

### 1. Sample — `samples.ts`, code only

Config allowlist, repo root only, first match per family:

```
eslint.config.{js,mjs,cjs,ts}  ·  .eslintrc{,.json,.js,.cjs}
tsconfig.json  ·  biome.json  ·  .editorconfig
.prettierrc{,.json}  ·  prettier.config.{js,mjs,cjs}
package.json  → reduced to { scripts, dependencies, devDependencies } only
```

Then `repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT)` — top-12 by
rank, tests/configs/migrations already excluded by the facade.

Caps (`constants.ts`): `MAX_CONFIG_BYTES = 4_000` each · `MAX_SAMPLE_LINES = 180`
· `MAX_SAMPLE_BYTES = 8_000` each · `SAMPLE_FILE_COUNT = 12` ·
`MAX_TOTAL_BYTES = 120_000`.

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

Reading the clone goes through `node:fs` directly, with the same
`// KNOWN DEBT` note `repo-intel/service.ts` carries — a `SourceReader` port is
real work and half-doing it here would be worse than not starting.

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

Model choice: `getFeatureModelOverride(container, workspaceId, 'conventions')`
first, falling back to the module's own cheap default — the exact path
`feature-models.ts` reserves for "callers that keep their own dynamic default
(e.g. conventions)". `resolveFeatureModel` would substitute the registry's
`gpt-5.4`, which is not a cheap model.

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

1. `evidence_path` ∈ `sampled` → else `file_not_sampled`
2. readable → else `file_missing`
3. `1 ≤ start ≤ end ≤ min(lineCount, shownUpTo)` → else `line_out_of_range`
4. slice `[start, end]`, clamp span to 12 lines, trim; must contain at least one
   non-blank, non-comment-only line → else `empty_snippet`
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

- `samples.test.ts` — a fixture directory: the config allowlist picks one file
  per family; `package.json` is reduced to three keys; a 400-line file is
  truncated at 180 with the notice; the total byte cap stops adding files rather
  than truncating the last one to nothing.
- `verify.test.ts` — one case per `ConventionDropReason`, plus: a valid candidate
  keeps the snippet **read from the fixture**, not the one supplied; a candidate
  citing line 300 of a file shown to line 180 is `line_out_of_range` even though
  the file has 412 lines.
- `skill-draft.test.ts` — a rejected candidate's rule text does not occur in the
  body; a pending one does not either; two categories render as two sections.

Integration (`conventions.it.test.ts`, real Postgres, `MockLLMProvider` with a
`structuredBySchema.ConventionExtraction` fixture):

- extract → `GET` returns the same view; `proposed`/`kept`/`dropped` on the scan
  row match what the mock returned;
- `PATCH` accept → `skill-draft` contains it; `PATCH` reject → it does not;
- `POST …/skill` creates a skill with `source: 'extracted'` and stamps `skill_id`
  on exactly the accepted candidates;
- re-extract preserves a prior `rejected` decision for the same rule text;
- extract on a repo with no index → `409 not_indexed`, no scan row written.

Prompt (`reviewer-core`): one assertion that the exported `INJECTION_GUARD` is
the same string `assemblePrompt` appends, so the export cannot drift into a copy.
