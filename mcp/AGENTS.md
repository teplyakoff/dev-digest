# `@devdigest/mcp` — the local stdio MCP server

Five tools over stdio, in front of the DevDigest REST API on
`http://localhost:3001`. This package is a **transport adapter**. It holds no
database pool, no `Container`, no secrets, and no model.

The from-scratch runbook and the token cost are in `README.md` — do not restate
them here. The short version: `.mcp.json` in the repo root is auto-discovered,
so every session in this repo carries the five tools and pays 1 936 tokens for
them; `claude --strict-mcp-config` is the opt-out. `./scripts/dev.sh` does not
start this server and never has — the MCP client spawns it over stdio.

## Commands (npm, NOT pnpm)

`npm run typecheck` · `npm run lint` · `npm test` · `npm start`

npm because `psr_pm()` in `.claude/skills/pr-self-review/scripts/_lib.sh` maps
everything that is not `server`/`client` to npm, and because pnpm 11 refuses to
run any script in a package whose dependency tree has undecided build scripts
(`ERR_PNPM_IGNORED_BUILDS`; see `server/INSIGHTS.md`).

## Map — the rings, applied deliberately

`onion-architecture` §15 declares itself the authority for `server/` and
`reviewer-core/`. This package is neither, so the rings here are a decision, not
an inheritance — and `routing.md` forbids only one thing, `onion-architecture`
on `client/`.

| Ring | Files |
|---|---|
| 1 — contracts and ports | `src/api/types.ts` (the `ApiClient` **interface**), `src/api/errors.ts` |
| 2 — use cases | `src/usecases/*.ts` — the multi-step orchestrations |
| 3 — adapters and transport | `src/api/client.ts`, `src/api/fake-client.ts`, `src/tools/*.ts` |
| composition root | `src/main.ts`, `src/server.ts`, `src/config.ts`, `src/deps.ts` |

`list_agents` and `get_blast_radius` have **no** ring-2 service on purpose: one
client call and a projection each. A service that only forwards is §13's own
antipattern. (`get_blast_radius` earned that shape twice over: it was a constant
while it was a stub, and it is still one call and one projection now that it
reads `GET /pulls/:id/blast` — the server does the graph walk.)

`fake-client.ts` lives in `src/`, not `test/` — §12: a test double is production
code, and both it and `client.ts` `implements ApiClient` so a client-shape change
breaks the double at compile time instead of drifting silently.

## Invariants — the ones this package can break

- **Never assemble a prompt and never call a model here.** `INJECTION_GUARD`
  (`reviewer-core/src/prompt.ts`) is the single shared defense on every review
  path; a model call from this package would be a review path without it.
- **Every fragment of PR-authored text is wrapped in `wrapUntrusted`** before it
  is returned to the caller's model. Finding titles, rationales, PR titles and
  convention evidence all come out of somebody else's pull request, and
  `INJECTION_GUARD` protects the *review* model, not the caller's.
- **Import `wrapUntrusted` by sub-path**, `@devdigest/reviewer-core/prompt.js`.
  The barrel re-exports `OpenRouterProvider` and pulls in the `openai` SDK.
  Signal that this broke: `grep -c openai mcp/package-lock.json` stops being `0`.
- **Never name a test `*.it.test.ts`.** In this repo that suffix means DB-backed
  via testcontainers and it selects the integration CI lane. Nothing here
  touches a database.
- **Scores are passed through, never recomputed.** Grounding and scoring belong
  to the engine; this package reports what it read.
- **stdout is the protocol.** Diagnostics go to stderr through `src/log.ts`; the
  lint lane fails on `console.log` and on `process.stdout`.

## Contracts

Through the tsconfig path alias to `server/src/vendor/shared`, never a third
vendored copy. `zod` is self-pinned in `tsconfig.json` for the same reason
`reviewer-core` pins it — two zod instances make `instanceof z.ZodError` false.

## Do not touch

- `src/tools/get-blast-radius.ts`'s **degraded-is-an-error** branch. The
  server's `GET /pulls/:id/blast` answers `200` with `status: "degraded"` when a
  repository has no index; this tool must return `isError: true` there, never an
  empty map. The caller is a model, and "no callers found" is a claim about the
  code that an unindexed repository cannot support.

  This entry used to say the whole file was a stub and not to be implemented,
  because the server exposed no blast route. L04 added `modules/blast/`, so that
  reason expired — the rule that outlived it is the one above.

## Read when

- adding a tool → `README.md` (the token budget is a hard 2 000, and it is the
  reason there are five tools and one `outputSchema`)
- you need the API surface → `../server/README.md`

Before working here read `INSIGHTS.md`; append to it with `/engineering-insights`
at the end of the session.
