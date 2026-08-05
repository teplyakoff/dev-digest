# 01 — Skills browser flow

The end-to-end coverage for L02. Scope is in
[`docs/plans/L02-skills.md`](../../../docs/plans/L02-skills.md); the UI it drives
is [`client/docs/specs/03-skills.md`](../../../client/docs/specs/03-skills.md).

## Problem

The seven existing flows cover boot, repos, PR detail, findings, diff,
onboarding and settings. Nothing opens `/skills`, and nothing opens the Agent
Editor past `Config` — so a regression that breaks the Skills route, the nav
entry, or the agent Skills tab would ship with every suite green.

## What the flow covers, and what it deliberately does not

E2E here runs on **seeded data with no LLM in the loop**, so it verifies that
the surfaces render and route correctly. It cannot verify that a skill changed a
review — that needs a real model call, and it is the control experiment's job
(`docs/plans/L02-skills.md`), evidenced in `docs/results/l02/`.

It also cannot assert on run traces: `pnpm db:seed` inserts a review but no
`agent_runs` row, so every trace-derived surface is legitimately empty on seeded
data (`client/INSIGHTS.md`, 2026-07-28). The token counts and the `Skills
loaded` badges are covered by the client component tests instead.

## The flow

`e2e/specs/08-skills.flow.json`, globbed by the runner like the others. Named
and described in the same style as `03-agents.flow.json`.

Steps, all against seeded data:

1. `open {BASE}/skills` → `wait --url /skills` → `wait --load networkidle`.
2. `wait --text "test-quality-rubric"` — the seeded skill's card renders, which
   proves the route, the nav registration, `useSkills` and the API round-trip in
   one assertion.
3. Click that card → `wait --text "Skill body"` (or the preview drawer's
   heading) — the preview opens beside the grid.
4. `open {BASE}/agents` → click `Test Quality Reviewer` → `wait --url /agents/`.
5. Click the `Skills` tab → `wait --url tab=skills` → `wait --text "Order
   matters"` — the tab is registered, `?tab=skills` is a valid tab, and the
   ordering hint renders.
6. `wait --text "test-quality-rubric"` inside the tab — the agent's linked skill
   is listed.

Step 5 is the one with real regression value: `VALID_TABS` in
`app/agents/[id]/page.tsx` silently falls back to `config` for an unknown tab,
so forgetting to add `"skills"` to that array produces a page that looks fine
and ignores the URL. A `--url tab=skills` assertion alone would pass; pairing it
with text that only the Skills tab renders is what catches it.

## Prerequisites

The flow depends on the L02 seed additions in
[`server/docs/specs/03-skills.md`](../../../server/docs/specs/03-skills.md): the
`test-quality-rubric` skill, the `Test Quality Reviewer` agent, and the
`agent_skills` row linking them. Without them steps 2 and 6 fail on an empty
state — which is the correct failure, not a flaky one.

`./scripts/e2e.sh` runs on alternate ports against its own database and never
touches the dev DB.

## Out of scope for this flow

Import is not driven end-to-end. It needs a real file upload into a file input,
and the value it would add over `ImportPreviewModal.test.tsx` — which already
asserts the ignored-entries list, the disabled-on-save copy and the 422 path —
is the picker itself. If a later lesson adds upload capability to the runner,
the natural addition is: import the fixture archive, assert `run.sh` appears in
the ignored list, confirm, and land on `/skills/:id` with the skill disabled.
