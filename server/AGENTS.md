# `@devdigest/api` — server

Fastify API: imports repos and PRs, indexes repos, runs reviews, persists
findings. Architecture, request/DI flow and the API map are in `README.md` —
do not restate them here.

## Commands (pnpm)

`pnpm dev` (:3001) · `pnpm db:migrate` · `pnpm db:seed` · `pnpm typecheck`

`pnpm test` runs both suites; split them when you need speed:
- unit — `pnpm exec vitest run --exclude '**/*.it.test.ts'` (no Docker)
- integration — `pnpm exec vitest run .it.test` (real Postgres, self-skips
  without Docker)

## Map

- `modules/<name>/` — one self-contained Fastify plugin per feature:
  `routes.ts` → `service.ts` → `repository.ts`
- `platform/` — composition root and cross-cutting concerns: `container.ts` (DI),
  `jobs.ts`, `sse.ts`, `resilience.ts`, `run-logger.ts`
- `adapters/` — ports to the outside world (llm, github, git, astgrep, tokenizer,
  secrets); `mocks.ts` holds their test doubles
- `db/schema/` — **every** table, including those no lesson has filled yet
- `vendor/shared/` — Zod contracts, vendored

## Conventions

- A new feature = a new `modules/<name>/` folder + one `app.register` in
  `modules/index.ts`. Nothing else registers routes.
- Routes declare Zod `params`/`body` schemas, so invalid input is rejected with
  422 **before** the handler runs. Never hand-roll `Schema.parse(req.body)`.
- Services depend on the interfaces the container hands them, never on concrete
  adapter classes — that is what lets tests swap in mocks.
- Need another module's data? Use `container.agentsRepo` / `container.reviewRepo`.
  Do not import from a sibling module's folder.
- Plugins register before modules, so encapsulated module plugins inherit them.

## Gotchas

- The API imports reviewer-core's **raw TypeScript** through a path alias. If
  `reviewer-core/node_modules` is missing, boot dies with `ERR_MODULE_NOT_FOUND`
  even though nothing in `package.json` mentions that package.
- Secrets are NOT part of `AppConfig` — they come from `SecretsProvider`.
  `GITHUB_TOKEN` is canonical; `GITHUB_PAT` is accepted as a fallback.
- `NODE_ENV=test` silences logs and disables the global rate limit.
- The engine reaps orphaned `running` runs on boot — don't add a second reaper.
- A DB-backed test MUST be named `*.it.test.ts` or the CI suite split breaks.

## Do not touch

- `src/vendor/shared/**` — vendored contracts.
- Already-applied files in `src/db/migrations/` — generate a new one with
  `pnpm db:generate`.

## Read when

- adding or changing a route → `README.md` (request/DI flow + API map)
- working on repo indexing → `src/modules/repo-intel/AGENTS.md`
- changing what the model actually sees → `../reviewer-core/README.md`
- specifying new work → `docs/specs/`

Before working here read `INSIGHTS.md`; append to it with `/engineering-insights`
at the end of the session.
