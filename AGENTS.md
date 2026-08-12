<!-- Every CLAUDE.md in this repo is a symlink to the AGENTS.md beside it.
     Edit AGENTS.md, never CLAUDE.md. Claude Code does not read AGENTS.md
     natively — the symlink is what makes it load.
     On Windows a symlink checkout needs Developer Mode; if that ever bites,
     replace CLAUDE.md with a one-line `@AGENTS.md` import stub instead. -->

# DevDigest — repo map

Local-first AI pull-request review: import a PR → an agent reviews the diff →
grounded, structured findings. This repo is the **course starter**: lessons
L01–L08 each add one feature back, so empty DB tables and unused prompt slots are
extension points, not dead code.

## Stack

Node ≥22 · TypeScript 5.7 · Zod 3 · Vitest 2
Fastify 5 · Drizzle 0.38 · Postgres 16 + pgvector — `server/`
Next.js 15 · React 19 · Tailwind 4 · TanStack Query — `client/`

## Layout — six standalone packages, NOT a workspace

| Path | Package | Manager |
|---|---|---|
| `server/` | `@devdigest/api` (:3001) | **pnpm** |
| `client/` | `@devdigest/web` (:3000) | **pnpm** |
| `reviewer-core/` | `@devdigest/reviewer-core` (engine, no I/O) | **npm** |
| `mcp/` | `@devdigest/mcp` (stdio MCP server over the API) | **npm** |
| `e2e/` | `@devdigest/e2e` (browser flows) | **npm** |
| `demo/` | `@devdigest/demo` (screencast recorder) | **npm** |

Each has its own lockfile. Cross-package code is shared through tsconfig path
aliases, never published modules — so the server imports reviewer-core's **raw
TypeScript**, and reviewer-core never emits JS.

`repo-intel` is NOT a package: it lives at `server/src/modules/repo-intel`.
Zod contracts (`@devdigest/shared`) live in `server/src/vendor/shared` and are
vendored into `client/src/vendor/shared`.

## Commands

- `./scripts/dev.sh` — full local boot (Postgres → migrate → seed → API + web).
  Flags: `--no-seed` · `--no-client` · `--db-only`.
- `./scripts/e2e.sh` — hermetic e2e on alternate ports; never touches the dev DB.
- `claude --mcp-config mcp/devdigest.mcp.json --strict-mcp-config` — the only
  thing that starts the stdio MCP server. It is **opt-in**: `dev.sh` never
  launches it, and the config deliberately does NOT sit at `.mcp.json`, which
  Claude Code would auto-load into every session here at a measured 1 871
  tokens. Needs the API on :3001. See `mcp/README.md`.
- `cd demo && npm run record` — records a video of the real review loop. Unlike
  `e2e`, this triggers a real run and **spends money**; see `demo/README.md`.

## Invariants (never break one silently)

- **Grounding is mandatory.** A finding that doesn't cite a real diff line is
  dropped, and the score is recomputed from the survivors — the model's own
  score is ignored.
- **Prompt-injection defense is one shared rule**, not text scanning: the
  `INJECTION_GUARD` in `reviewer-core/src/prompt.ts` runs on every review path.
- **Secrets never touch the DB or git** — `~/.devdigest/secrets.json` (mode 0600)
  via `SecretsProvider`, with `process.env` as the fallback.
- **Migrations do NOT run on boot.** `relation ... does not exist` → `pnpm db:migrate`.
- **`*.it.test.ts` = DB-backed** (testcontainers); every other test is hermetic.

## Do not touch

- `client/src/vendor/shared/**` — a GENERATED copy. Edit
  `server/src/vendor/shared` (the source), run `./scripts/vendor-shared.sh`,
  commit both. Enforced by `--check` in the `lint` workflow.
- `client/src/vendor/ui/**` — vendored primitives with **no in-repo source and
  no re-vendor script**, so "edit the source" has nowhere to point. Treat as
  frozen; if a change is unavoidable (the nav registry is the known case), keep
  it minimal and pin it with a test in app code.
- Already-applied `server/src/db/migrations/*.sql` — add a new migration instead.
- `docker compose down -v` — deletes the `devdigest_pgdata` volume, and every
  imported repo and review with it.

## Read when

- working inside a package → read its `AGENTS.md` **and** its `INSIGHTS.md`
- you need the review pipeline → `reviewer-core/README.md`
- you need the API surface or DI wiring → `server/README.md`
- you touch tests or CI → `TESTING.md`
- you write or change an agent's system prompt → `docs/agent-prompts/README.md`
- you write or change a Claude Code subagent → `.claude/agents/README.md`

## Session loop

Before working in a package, read its `INSIGHTS.md`, name the top 3 entries
relevant to the task, and treat them as high-confidence guidance unless told
otherwise. Work that touches no package — `.claude/`, `docs/`, `scripts/` — uses
the root `INSIGHTS.md` the same way. At the end of the session run
`/engineering-insights` to append what you learned to that same file — add
entries, never overwrite existing ones. Do not skip this step.

Before the work becomes a pull request run `/pr-self-review`. It gates
`gh pr create` and `git push` on the result, so a blocked verdict is not a
suggestion — see `.claude/skills/pr-self-review/SKILL.md`.
