# `repo-intel` — the codebase indexer

Indexes a cloned repo (symbols + import graph) into the **repo map** that becomes
review context and powers the *Indexed* badge. Not a package — a module inside
the server. Details: `README.md`.

## Map

`service.ts` (facade) · `repository.ts` (Drizzle helpers) · `routes.ts`
`pipeline/` — `walk.ts` → `rank.ts` → `repo-map.ts`, plus `full.ts` / `incremental.ts`

## Conventions

- Consumers depend on the `RepoIntel` interface from the container, never on
  `RepoIntelService` directly — that is how tests inject a mock.
- The repo map is token-budgeted. Anything you add to it competes with the diff
  for the model's attention, so justify the cost.

## Gotchas

- `REPO_INTEL_ENABLED=false` degrades every consumer to ripgrep-only behaviour.
  The per-agent `repo_intel` toggle gates enrichment on top of that.
- Prompt sections populate only once a repo is actually **indexed** — an
  unindexed repo degrades silently to diff-only. If the repo map looks empty,
  check the index state before debugging prompt assembly.

Before working here read the server's `INSIGHTS.md`; append to it with
`/engineering-insights` at the end of the session.
