# 03 — Skills (server)

The API half of the L02 Skills feature: store skills, link them to agents, get
them into the review prompt, and account for what they cost. The UI half is
[`client/docs/specs/03-skills.md`](../../../client/docs/specs/03-skills.md); the
prompt rendering is
[`reviewer-core/docs/specs/01-skills-block.md`](../../../reviewer-core/docs/specs/01-skills-block.md).
Scope, sequencing and the trust model live in
[`docs/plans/L02-skills.md`](../../../docs/plans/L02-skills.md).

## Problem

`skills`, `skill_versions` and `agent_skills` exist and are empty. The agent side
of the link is already built — `GET/POST /agents/:id/skills`, `linkedSkills`,
`setSkills` — and `agent_versions.config_json.skills` already snapshots the
ordered ids. Two things are missing.

There is **no skills module**, so nothing can create the rows the link points at.

And `run-executor.ts` never reads them. `reviewPullRequest` is called with
`systemPrompt`, `model`, `diff`, `llm`, `strategy`, `callers`, `repoMap`,
`prDescription` and `task` — `skills` is not among them, so `PromptParts.skills`
is always `undefined` and `PromptAssembly.skills` is always `null`. The trace
drawer's skills block is already written and has never once rendered.

## Schema

No new tables. The three that exist carry the whole feature:

- `skills` — `id`, `workspace_id`, `name`, `description`, `type`, `source`,
  `body`, `enabled`, `version`, `evidence_files`, `created_at`
- `skill_versions` — `(skill_id, version)` PK, `body`, `created_at`
- `agent_skills` — `(agent_id, skill_id)` PK, `order`

`type` and `source` are Drizzle `text(..., { enum })`, which is a TypeScript
refinement only — `0000_init.sql` writes plain `text` with no `CHECK`. Adding
`imported_file` to `SkillSource` therefore costs **no migration**. (Contrast
`findings`, where migration `0011` pinned the enum into the database and the Zod
enum and the `CHECK` must be edited together — `INSIGHTS.md`, 2026-08-03.)

Migration `0012` adds the indexes `skills` has never had:

```sql
CREATE INDEX      "skills_workspace_id_idx" ON "skills" ("workspace_id");
CREATE UNIQUE INDEX "skills_workspace_id_name_uq" ON "skills" ("workspace_id","name");
```

The first is the shape of every list read. The second makes the name a real
handle: it is what renders as the block heading in the prompt, what the trace
shows, and what a person types when talking about a skill — two skills called
`test-coverage` in one workspace makes every one of those ambiguous. Generate it
with `pnpm db:generate`; expect `meta/_journal.json` modified and a large
`meta/0012_snapshot.json` added in the same diff (`INSIGHTS.md`, 2026-08-03).

`agent_skills` needs nothing: its PK is `(agent_id, skill_id)` and every read
filters on the leading column.

## Contracts

`server/src/vendor/shared/contracts/knowledge.ts` is the source; run
`./scripts/vendor-shared.sh` afterwards. Never edit the client copy — it is
overwritten, and CI runs `--check`.

```ts
// widened — an import from a file is neither a URL nor the community catalog
SkillSource = z.enum(['manual', 'imported_url', 'imported_file', 'extracted', 'community'])

SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
})

/** Which agents load this skill — powers the card's "N agents" and the
    delete confirmation. */
SkillUsage = z.object({ agent_id: z.string(), agent_name: z.string() })

/** The result of parsing an upload. Returned by preview, echoed back to
    confirm. Nothing here has been written to the database yet. */
SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  source: z.literal('imported_file'),
  origin: z.object({
    filename: z.string(),
    kind: z.enum(['markdown', 'archive']),
    bytes: z.number().int(),
  }),
  /** Which entry inside the archive became the body; null for a bare .md. */
  entry_path: z.string().nullable(),
  /** Every archive entry we refused to open, and why. The audit trail for
      "executable parts are ignored" — the UI renders it verbatim. */
  ignored: z.array(z.object({ path: z.string(), reason: z.string() })),
  /** Frontmatter keys read (name/description/type) vs dropped. */
  frontmatter: z.object({ used: z.array(z.string()), dropped: z.array(z.string()) }),
  warnings: z.array(z.string()),
})
```

And on `contracts/trace.ts`, so a trace can answer "which skills, at what cost":

```ts
RunTrace.config.skills: z.array(z.object({
  name: z.string(),
  version: z.number().int(),
  tokens: z.number().int(),
})).nullish()    // nullish so every trace persisted before L02 still parses
```

`PromptAssembly.skills` already exists and needs no change.

## Routes — `modules/skills/`

A new feature is a new `modules/<name>/` folder plus **one** `app.register` in
`modules/index.ts`; nothing else registers routes. Every route resolves
`getContext` and scopes on `workspaceId`, and declares Zod `params`/`body` so
invalid input is rejected with 422 before the handler runs.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/skills` | `Skill[]`, workspace-scoped, name ascending |
| `GET` | `/skills/:id` | `Skill` · 404 outside the workspace |
| `POST` | `/skills` | 201 `Skill` — writes `v1` into `skill_versions` |
| `PUT` | `/skills/:id` | `Skill` — body change bumps `version` + snapshots |
| `DELETE` | `/skills/:id` | `{ ok: true }` — `agent_skills` cascades |
| `GET` | `/skills/:id/versions` | `SkillVersion[]`, newest first |
| `GET` | `/skills/:id/versions/:version` | `SkillVersion` · 404 |
| `GET` | `/skills/:id/agents` | `SkillUsage[]` |
| `POST` | `/skills/import/preview` | `SkillImportPreview` — **writes nothing** |
| `POST` | `/skills/import/confirm` | 201 `Skill` |

The versioning rule mirrors `agents`: a change to `body` bumps `version` and
inserts a `skill_versions` row; changing only `enabled` (or only the
description) does not. `AgentsRepository.isConfigChange` is the shape to copy —
`SkillsRepository` gets its own `isBodyChange`, because for a skill the body is
the whole artifact and everything else is metadata. Snapshotting keeps a past
eval run reproducible against the exact text it scored.

`GET /skills/:id/agents` joins `agent_skills → agents` filtered by the caller's
workspace. It is the only read that crosses into the agents table; it uses
`container.agentsRepo` rather than importing from `modules/agents/`.

### Import

Two endpoints on purpose. The parse — and specifically the decision about what
gets ignored — has to happen server-side, or the client is the one asserting
that nothing executable was read.

Transport is a Zod-validated JSON body, not multipart:

```ts
ImportBody = z.object({
  filename: z.string().min(1).max(255),
  content_base64: z.string().min(1),
})
```

One code path serves both `.md` and `.zip`, no new dependency for multipart, and
the repo's "routes declare Zod schemas" convention survives. The cost is base64's
33% inflation, so both import routes set a route-level
`bodyLimit: 2 * 1024 * 1024`.

`confirm` takes a `SkillImportPreview` and re-runs the same validation before
writing. The preview is not a token: a client that edits the body between the
two calls gets the edited body, validated, which is fine — the point of the gate
is that a human saw the content, not that the bytes are identical.

Pipeline, in `modules/skills/import/` (pure functions, no I/O, unit-testable
without Docker):

1. **Decode and cap.** `.md` ≤ 256 KB, `.zip` ≤ 1 MB compressed. Anything else →
   422.
2. **Archive limits, enforced entry by entry while reading** — ≤ 200 entries,
   ≤ 1 MB per uncompressed entry, ≤ 4 MB uncompressed total. Exceeding any one
   aborts the whole import rather than truncating, so a zip bomb never lands.
3. **Reject the whole archive** on an entry whose path is absolute, contains
   `..`, or is a symlink. Not "skip that entry" — an archive that contains a
   traversal attempt is not an archive we want to keep parsing.
4. **Pick the body.** `SKILL.md` at the shallowest depth; else the only `*.md`
   in the archive; else 422 with the candidate list, so the user can repackage.
5. **Ignore everything else, by listing it.** Every remaining entry lands in
   `ignored[]` with a reason and is never opened. Scripts, manifests, hooks,
   binaries — all the same rule, because the rule is "one markdown file is the
   skill", not a blocklist of dangerous extensions.
6. **Frontmatter allowlist.** If the markdown opens with YAML frontmatter, read
   `name`, `description`, `type` and nothing else. Every other key goes to
   `frontmatter.dropped`. `allowed-tools`, `command` and friends are dropped
   here — named in the test so the intent is legible.
7. **Escape only.** The body is stored verbatim except that `</untrusted>` is
   neutralised (the same escape `wrapUntrusted` applies). We do **not** scan the
   text for suspicious phrasing and silently edit it: the product's stated
   defense is one shared rule, not text scanning, and a heuristic that rewrites
   a user's rule is worse than one that shows it to them. Anything worth a
   human's attention goes in `warnings[]`.
8. **Land disabled.** `source: 'imported_file'`, `enabled: false`. It reaches no
   prompt until a person turns it on.

## Getting skills into the run

In `run-executor.ts`, alongside the existing repo-intel enrichment:

```ts
const links = await this.agents.linkedSkills(agent.id);       // ordered by `order`
const active = links.filter((l) => l.skill.enabled);          // global toggle
const skills = active.map((l) => renderSkillBlock(l.skill.name, l.skill.body));
```

`renderSkillBlock` comes from `reviewer-core` so the studio and the CI runner
render a skill identically. `ReviewInput.skills` is passed only when non-empty —
`assemblePrompt` omits the section otherwise and the prompt is byte-identical to
today's for an agent with no skills. That is the regression bar for this change.

Two filters, and they mean different things:

- **`agent_skills`** — is this skill attached to this agent, and in what order.
  Unlinking is how you take a skill off one agent.
- **`skills.enabled`** — the master switch. A disabled skill loads for nobody,
  which is what makes the exit checklist's "disabled → not in the log, not in
  the trace" a single observable fact rather than a per-agent audit.

There is deliberately no third flag on the link row.

Order is `agent_skills.order` ascending, and it survives into the prompt
unchanged — that is the whole point of letting the user drag the rows.

### Token attribution

`container.tokenizer` is already a first-class container getter
(`TiktokenTokenizer`, overridable in tests). Its header comment currently scopes
it to `modules/repo-intel`; L02 widens that deliberately and **updates the
comment in the same change** rather than leaving a stale "only under repo-intel"
for the next reader.

Per skill, `tokenizer.count(renderSkillBlock(...))` — the rendered block, not the
raw body, so the number matches what the model was actually sent. Then:

- the run log gets `Loaded ${n} skill(s) (${total} tokens)` right after the
  provider is resolved, which is the line the exit checklist looks for;
- `trace.config.skills` gets `{ name, version, tokens }` per skill;
- `trace.prompt_assembly.skills` is non-null, so the existing block renders.

Zero skills → no log line, no `config.skills`, `prompt_assembly.skills` stays
`null`. Silence is the signal.

`traceFromBuffer` (the failure path, `trace-builder.ts:61`) and the pre-work
`failAll` path in `run-executor.ts:514` both hand-build a `PromptAssembly` with
`skills: null`. They stay as they are — a run that failed before assembling a
prompt loaded no skills, and inventing a number there would be the same mistake
as writing `cost_usd = 0` for a run that never settled.

## Seed

`pnpm db:seed` stays idempotent and gains, in the default workspace:

- **Skills** — `test-quality-rubric` (`type: rubric`) and `api-contract-guard`
  (`type: convention`), both `source: 'manual'`, `enabled: true`, `v1`
  snapshotted. Bodies live in a new `db/seed-skills.ts` next to
  `seed-prompts.ts`.

  > **Superseded by the L02 homework** (`docs/plans/L02-conventions.md`).
  > `api-contract-guard` restated the API Contract Reviewer's own system prompt,
  > which is exactly why the control experiment below could not show a
  > difference. It is now three skills — `breaking-change`, `response-schema`,
  > `semver-discipline` — plus `deprecation-policy`, which arrives through the
  > import preview. The agent's prompt lost the taxonomy those carry.
- **Agents** — `Test Quality Reviewer` and `API Contract Reviewer`, same
  `openrouter` / `deepseek-v4-flash` default as the existing three, prompts in
  `seed-prompts.ts`, each linked to its skill via `agent_skills`.

Deliberately **not** seeded: the imported skill. It has to arrive through the
import flow on camera, so it ships as a fixture archive
(`server/test/fixtures/skills/uncovered-branch-gate.zip` — a `SKILL.md` plus a
`run.sh` and a `package.json` that must show up in `ignored[]`), reused by both
the unit test and the demo.

## Verification

**Unit** (`pnpm exec vitest run --exclude '**/*.it.test.ts'`, no Docker):

- `test/skills-import.test.ts` — the fixture archive yields the `SKILL.md` body
  and lists `run.sh` / `package.json` in `ignored[]`; a traversal entry rejects
  the whole archive; entry-count / per-entry / total-size caps each abort;
  frontmatter keeps `name`/`description`/`type` and drops `allowed-tools`;
  `</untrusted>` in the body is neutralised; an archive with two `*.md` and no
  `SKILL.md` is 422 with both candidates named.
- `test/skills-helpers.test.ts` — `isBodyChange` bumps on body, not on `enabled`
  or `description`.
- `test/contracts.test.ts` — a pre-L02 `RunTrace` fixture (no `config.skills`)
  still parses.

**Integration** (`pnpm exec vitest run .it.test`, real Postgres):

- `test/skills.it.test.ts` — CRUD; save bumps `version` and writes
  `skill_versions`; a second workspace's skill is invisible and 404s; the unique
  index rejects a duplicate name in one workspace and allows it across two;
  deleting a linked skill removes the `agent_skills` row and leaves the agent.
- `test/reviews.it.test.ts` extension — an agent with one enabled linked skill
  produces a non-null `prompt_assembly.skills` containing the block heading, a
  `config.skills` entry with `tokens > 0`, and the `Loaded 1 skill(s)` log line;
  flipping that skill to `enabled: false` and re-running produces
  `prompt_assembly.skills === null`, no `config.skills`, and no log line. That
  pair **is** the exit checklist's log assertion.

Build a fixture with the row `setupRepoAndPr` returns rather than selecting from
`t.skills` — `beforeAll` seeds first, so a bare select returns the seeded row
(`INSIGHTS.md`, 2026-07-28). And extending `REVIEW_FIXTURE` cascades into the
score, both grounding strings and `findingsCount`; grep the file for count
assertions before touching it (`INSIGHTS.md`, 2026-07-31).

**Live** — the control experiment in
[`docs/plans/L02-skills.md`](../../../docs/plans/L02-skills.md). It needs a real
imported repo: seeded PR files carry `patch: null`, so a review against seeded
data has nothing to ground against (`INSIGHTS.md`, 2026-07-28).
