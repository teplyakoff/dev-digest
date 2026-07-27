# `@devdigest/e2e` — browser flows

Deterministic UI journeys driven by Vercel agent-browser (CDP). No Playwright, no
LLM, no API key. How a flow is structured: `README.md`.

## Commands (npm, NOT pnpm)

- `npm run e2e:hermetic` — **use this locally.** Isolated, freshly-seeded stack on
  alternate ports (PG 5433 · API 3101 · web 3100); leaves your dev DB untouched.
- `npm test` — the pure runner. Assumes a freshly-seeded stack is already up;
  this is the path CI uses.
- One-time setup: `npm i -g agent-browser && agent-browser install`.

## Map

- `specs/NN-name.flow.json` — **browser flows**: a JSON list of agent-browser
  commands. This folder is NOT for project-context specs; those go in `docs/specs/`.
- `lib/assert.ts` · `run.ts` — the runner

## Conventions

- Deterministic locators only: `--url`, `--text`, `find role|text|label`.
  **Never** the AI `chat` command — that is what keeps runs stable and key-free.
- `wait --text` / `wait --url` ARE the assertions: they exit non-zero on timeout.
- Flows target read-only seeded data, so nothing triggers a model call.

## Gotchas

- Flows 02/04/05 follow the home redirect to the *first* repo, so they assume the
  seeded demo repo is the only one. `npm test` against your dev DB will fail once
  you have imported anything else — that is what `e2e:hermetic` is for.
- **Never `docker compose down -v`** to reset — it deletes `devdigest_pgdata` and
  every repo and review you imported with it.

## Read when

- adding or debugging a flow → `README.md`
- specifying new work → `docs/specs/`

Before working here read `INSIGHTS.md`; append to it at the end of the session.
