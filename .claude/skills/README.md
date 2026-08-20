# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Which ring backend code goes in — dependency rule, ports and adapters, composition root, services vs repositories vs transport |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [frontend-architecture](frontend-architecture/SKILL.md) | Frontend | Where code goes — folder structure, component splitting, constants, utils, business logic, App Router boundaries |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [acceptance-criteria](acceptance-criteria/SKILL.md) | Shared | One definition of a well-formed criterion — EARS patterns, the six quality tests, `AC-N`/`NFR-N` numbering, the four verification kinds |
| [engineering-insights](engineering-insights/SKILL.md) | Shared | Reads a package's `INSIGHTS.md` at session start; appends what was learned at the end |
| [pr-self-review](pr-self-review/SKILL.md) | Shared | Gates a pull request on the local diff — runs the CI gates, routes the change set to the skills above, blocks `gh pr create` on a critical finding |

## The one skill that runs the others

`pr-self-review` is the only entry above that is not a knowledge file. It is a
workflow: it decides which of the skills in this table apply to a given diff and
enforces the result through `.claude/hooks/pr-guard.sh`, a `PreToolUse` hook
registered in `.claude/settings.json`.

Two consequences worth knowing before it surprises you:

- `gh pr create`, `gh pr ready`, `gh pr merge` and `git push` are blocked while
  the last review is missing, stale, `BLOCKED` or `INCONCLUSIVE`. Prefix a
  command with `PSR_SKIP=1` for a one-off bypass, or drop the `hooks` block from
  `.claude/settings.json` to turn the gate off entirely.
- Editing any skill in this table invalidates the cached findings of every group
  reviewed against it — the cache key covers the skill files too.

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands — see [`.claude/COMMANDS.md`](../COMMANDS.md) |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration — see [`.claude/agents/README.md`](../agents/README.md) |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
