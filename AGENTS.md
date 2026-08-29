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

## Layout — seven standalone packages, NOT a workspace

| Path | Package | Manager |
|---|---|---|
| `server/` | `@devdigest/api` (:3001) | **pnpm** |
| `client/` | `@devdigest/web` (:3000) | **pnpm** |
| `reviewer-core/` | `@devdigest/reviewer-core` (engine, no I/O) | **npm** |
| `mcp/` | `@devdigest/mcp` (stdio MCP server over the API) | **npm** |
| `e2e/` | `@devdigest/e2e` (browser flows) | **npm** |
| `demo/` | `@devdigest/demo` (screencast recorder) | **npm** |
| `evals/` | `@devdigest/evals` (evals for the harness itself) | **pnpm** |

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
- `mcp/bin/devdigest-mcp` — the stdio MCP server. **Not** started by `dev.sh`
  (`scripts/` never mentions `mcp`); the client spawns it, and `.mcp.json` in
  the root is auto-discovered so every session here has the five tools. That
  costs a measured 1 967 tokens in each one — `claude --strict-mcp-config` opts
  out. Needs the API on :3001. See `mcp/README.md`.
- `cd demo && npm run record` — records a video of the real review loop. Unlike
  `e2e`, this triggers a real run and **spends money**; see `demo/README.md`.
- `cd evals && pnpm eval` — evals for **this harness**, not for the app: the
  skills, subagents and `CLAUDE.md` under `.claude/`. Suites are
  `eval:skills` · `eval:agents` · `eval:workflow`, and `eval:quality` is the
  static gate (SKILL.md structure — no model, no cost). Statistics on top of the
  same `results/records.jsonl`: `eval:repeat` (N runs → stability) ·
  `eval:delta` (two labeled repeat runs → version vs version) ·
  `eval:benchmark` (with vs without the artifact → measured lift);
  `eval:compare` says which tests flipped between two runs and `eval:scaffold`
  writes the file trio for a skill or agent that has no evals yet.
  Default backend is the Claude Code **subscription** (no API key, no per-token
  bill); `EVAL_BACKEND=openrouter` runs the same tests on OpenRouter and
  **spends money**, which is what CI does. `eval:agents` and `eval:workflow` on
  OpenRouter need the LiteLLM proxy — `proxy:up` / `proxy:wait` / `proxy:down`.
  Wired to CI in `.github/workflows/evals.yml`; see `evals/README.md`.

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
- you write or change a skill, a subagent or `CLAUDE.md`, or you add an eval
  case for one → `evals/README.md` — that change is what the eval suites grade,
  and `.github/workflows/evals.yml` routes the PR to the suite covering it

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

## Commits

Conventional Commits, as the log already does it: `type(scope): subject`,
lowercase, imperative, no trailing period.

**When the work implements a plan, add two trailers** — a blank line, then:

```
Plan: docs/plans/L05-repo-narrative.md
Steps: S2, S3
```

`Plan:` is the path. `Steps:` is the `S<n>` ids **this commit** carries, not the
plan's whole list. They are the last link of `AC → step → test → commit`, and the
only one a machine can follow after the fact: `spec-creator` numbers the criteria,
`implementation-planner` binds a step and a test to each, and `plan-verifier`
grades the chain — but without a trailer its evidence stops at `path:line` and
the commit column is filled in by hand or not at all.

```bash
git log --format='%h %s%n  %(trailers:key=Steps,valueonly,separator=%x2C)' <range>
```

No plan → no trailers, and that is the whole rule: absence means "this was not
plan work", so do not write `Plan: none`. Nothing enforces this — there is no
`commit-msg` hook and `gates.sh` deliberately stays out of it, because a false
FAIL there teaches people to bypass gates. A commit without trailers degrades
gracefully: it is simply graded by its diff instead.
