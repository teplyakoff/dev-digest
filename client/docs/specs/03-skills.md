# 03 — Skills (client)

The studio half of L02: author skills, attach them to agents in an order, import
one safely, and see what a skill cost on a run. The API is
[`server/docs/specs/03-skills.md`](../../../server/docs/specs/03-skills.md);
scope and the trust model are in
[`docs/plans/L02-skills.md`](../../../docs/plans/L02-skills.md).

## Problem

There is no Skills surface at all — no route, no nav entry, no hook file. The
Agent Editor ships `Config` only; `TABS` in
`app/agents/[id]/_components/AgentEditor/constants.ts` is a one-element array
with the comment "later lessons add the rest".

What *does* exist is scaffolding worth knowing about before writing anything:
`messages/en/skills.json` is fully populated, `agents.json` already has
`editor.tabs.skills` and an `agents.skills.*` block, and the run trace drawer
already renders a dedicated skills `PromptBlock` — it has simply never had a
non-null value to render.

## Routes

Two, mirroring the shape `/agents` and `/agents/:id` already use, because the
page shells, the card and the editor chrome are ports of those files.

### `/skills` — grid + preview

Ported from `AgentsListView`. Card grid of `SkillCard`; header with a search
input and an `Add Skill` dropdown; `EmptyState` when there are none.

`SkillCard` (ported from the design's `SkillCard` in `screen_skills.jsx`) shows
the name in mono, a type-coloured pill (`rubric` blue · `convention` green ·
`security` red · `custom` grey), the description on one truncated line, the
source chip with its icon, an `enabled` `Toggle` in the corner, and a footer with
the usage count from `GET /skills/:id/agents`. A disabled card renders at 0.6
opacity. An `imported_file` card that is still disabled additionally shows the
`listItem.needsVetting` badge.

Clicking a card opens a **preview drawer** on the right: the body rendered as
markdown, its token count, and `Open editor` → `/skills/:id`. Read-only — the
drawer answers "what does this actually say", the editor answers "change it".

`Add Skill` dropdown: `Create from scratch` and `Import from file`. The design
also offers `Import from URL` and `Search community skills…` — both are out of
scope for L02, so both are **omitted from the menu**, not rendered disabled. The
`skills.page.menu.fromUrl` / `.community` keys stay in the message file for the
lesson that builds them.

### `/skills/:id` — list + tabbed editor

Ported from `app/agents/[id]/page.tsx`: skills list in a 290 px left column,
editor on the right, tab state in `?tab=`.

**Config** — `name` (mono), `description`, `type` (select), and the body in a
monospace editor with a line gutter and a live token count in its header. Save,
Cancel, and a "Saving snapshots the body as v{n+1}" hint. A danger zone at the
bottom: `Delete skill`, whose confirmation names the agents that use it, from
`GET /skills/:id/agents`.

The `description` field carries the hint from the requirements —
**the description is the skill's interface, so write it as a directive.** It is
what a person scans in the grid and what a later lesson will match against a
diff, and "Rules for tests" is useless where "Flag new branches that no test
asserts on" is not.

The body field's hint states the plain fact: this text is the only thing sent to
the model — everything else is metadata.

**Preview** — the body rendered as markdown, "as the reviewing agent receives
it". The design ships a small renderer (headings, lists, fenced code,
paragraphs) in `screen_skills.jsx`; port it into `_components/MarkdownPreview/`
rather than adding a markdown dependency for one screen.

**Versions** — `GET /skills/:id/versions`, newest first, current one badged.
Copy: "Every save snapshots the body so eval runs stay reproducible against the
exact text they scored." `Diff` and `Restore` are out of L02 — list only.

`Evals` and `Stats` from the design are not rendered.

### Nav

`NAV` in `src/vendor/ui/nav.ts` gains
`{ key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" }`
before `agents`, plus the matching `SHORTCUTS` entry and a
`pathname.startsWith("/skills")` branch in `app-shell/helpers.ts`.

This edits a file under `src/vendor/**`, which both `CLAUDE.md` files mark
do-not-touch. The rule reads "edit the source, then re-vendor" — but
`@devdigest/ui` has no source in this repo (unlike `@devdigest/shared`, which
has `scripts/vendor-shared.sh` and a real upstream in `server/`). The nav
registry is the one place a new route must be declared, so the edit is
unavoidable; make it in one commit, touch nothing else under `vendor/ui`, and
say so in the PR body.

## Agent editor — Skills tab

One entry in `TABS` (`{ key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" }`,
the label key already exists), `"skills"` added to `VALID_TABS` in
`app/agents/[id]/page.tsx`, and a `SkillsTab` component.

The tab lists **every** workspace skill, not just the linked ones — attaching is
the primary action, so the unattached ones have to be visible. Per row: drag
handle, checkbox (checked = linked), mono name, type pill. Header shows
`agents.skills.enabledCount` and a filter input; below it the existing
`agents.skills.orderHint` — "Order matters — earlier skills appear earlier in
the assembled prompt."

Checking, unchecking and reordering all resolve to one call:
`POST /agents/:id/skills` with the full ordered `skill_ids` array. The endpoint
replaces the set, so a single write covers every mutation and there is no
partial state to reconcile. Optimistic update on the `["agent-skills", id]` key,
rollback on error.

A globally disabled skill still appears and can still be linked — the row is
dimmed and captioned "disabled globally — will not load". Hiding it would make
"why is my skill not in the prompt" unanswerable from this screen.

## Run trace

The drawer already renders `prompt_assembly.skills` as its own `PromptBlock`
with `PROMPT_COLORS.skills`. Two additions, both from the new
`RunTrace.config.skills`:

- the block's label gains the token count — `Skills / rules · 4,210 tokens` —
  which is the "how many tokens did it add" half of the requirement;
- the Configuration section gains a `Skills loaded` row of mono badges, one per
  skill with its version, matching the design's trace. Absent when
  `config.skills` is null or empty.

`config.skills` is nullish in the contract, so traces persisted before L02 render
exactly as they do today.

## Import — file, preview, confirm

`Add Skill → Import from file` opens a file picker (`.md`, `.zip`), reads the
file as base64 in the browser, and `POST`s it to `/skills/import/preview`. The
response opens a modal with three regions:

1. **Where it came from** — filename, kind, size, and for an archive which entry
   became the body.
2. **What was ignored** — `preview.ignored` rendered as a list of
   `path — reason`. This is the screen the video is about. It is not a
   reassurance banner; it is the actual list of files the server refused to
   open, and for the L02 fixture archive it names `run.sh` and `package.json`.
   Dropped frontmatter keys render beside it.
3. **What you are about to adopt** — name, description and type in editable
   fields, and the body in full in the same editor the Config tab uses. Full, not
   truncated: this is the last point before someone else's instructions enter
   your agent's prompt.

The footer states the outcome plainly — *"Imported skills are saved disabled.
Enable it when you have read it."* — with `Cancel` and `Import skill`, which
`POST`s to `/skills/import/confirm`. On success: toast, and navigate to
`/skills/:id?tab=config` so the body is the first thing on screen.

Failures (too large, no markdown found, ambiguous, path traversal) render the
server's message inside the modal. `import/preview` returning 422 must never
look like a network blip.

### Copy that has to change

`messages/en/skills.json` currently claims an imported body is "wrapped as
untrusted data — never executed as instructions" (`file.bodyHint`), "stored as
untrusted" (`url.hint`), and that it is "stored as data (delimiter-wrapped)"
(`preview.untrustedNotice`). That describes a posture the feature does not
implement and could not usefully implement — a skill the model is told to ignore
is a skill that changes nothing (see
[`reviewer-core/docs/specs/01-skills-block.md`](../../../reviewer-core/docs/specs/01-skills-block.md)).

Those three strings get rewritten to what is true: an imported skill is
**someone else's instructions**, nothing executable in the upload is read, it
arrives disabled, and enabling it is you adopting the text. Leaving the old
wording would tell the next reader to restore a behaviour we deliberately did
not build — the same trap `server/INSIGHTS.md` records for code comments
(2026-07-31).

`listItem.source` also gains `imported_file`.

## Hooks

`src/lib/hooks/skills.ts` — the only place these routes are called from; no
`fetch` in a component.

`useSkills` · `useSkill` · `useCreateSkill` · `useUpdateSkill` · `useDeleteSkill`
· `useSkillVersions` · `useSkillUsage` · `useImportPreview` (mutation, no cache
write) · `useImportConfirm` · `useAgentSkills` · `useSetAgentSkills`.

Query keys stay module-private and invalidation is exported as a helper, the
pattern `lib/hooks/reviews.ts` moved to on 2026-08-03.

Type-only imports from `@devdigest/shared`. Importing a Zod **value** from that
barrel costs ~15 kB First Load JS on every route and, worse, used to break
`pnpm build` outright while `typecheck` and `test` stayed green — run
`pnpm build`, not just the tests, after touching those imports
(`INSIGHTS.md`, 2026-08-03).

## Verification

`pnpm test` (vitest + jsdom, `fetch` mocked):

- `SkillCard.test.tsx` — type pill and source chip per variant; toggle fires with
  the inverted value; disabled card dims; an `imported_file` + disabled card
  shows the vetting badge.
- `SkillsListView.test.tsx` — grid renders, search filters, empty state, card
  click opens the preview drawer.
- `ConfigTab.test.tsx` (skills) — editing the body enables Save; Save posts the
  changed fields; the delete confirmation names the agents from `useSkillUsage`.
- `SkillsTab.test.tsx` (agent editor) — every workspace skill renders; checking
  one posts the full ordered `skill_ids`; reordering posts the new order; a
  globally disabled skill renders dimmed and still linkable.
- `ImportPreviewModal.test.tsx` — `ignored[]` renders every entry with its
  reason; the footer states that the skill saves disabled; confirm posts the
  edited fields; a 422 renders in the modal.
- `TraceBody.test.tsx` — the skills block shows its token count when
  `config.skills` is present, and a trace without `config.skills` renders
  unchanged.

Two known traps: a shared component that starts calling a new next-intl
namespace breaks every existing test that renders it, because a test's provider
only carries the namespaces it was handed (2026-07-28) — the trace additions
touch `runs`, which several tests already provide. And `rerender()` with the same
element reference is a no-op; build the element in a function and pass a fresh
one (2026-08-03).

Browser coverage lives in
[`e2e/docs/specs/01-skills-flow.md`](../../../e2e/docs/specs/01-skills-flow.md),
not here.
