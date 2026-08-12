# Routing — which skills run on which files

One table, one job: turn a change set into review **groups**. A group is one
model pass — one set of files, one set of skills, one set of findings.

A file may land in several groups. A file in no group is not reviewed, and that
is a decision, not an oversight.

## 1. Groups

| Group | Paths | Skills | May block? |
|---|---|---|---|
| `client-app` | `client/src/app/**` | [next-best-practices](../next-best-practices/SKILL.md), [frontend-architecture](../frontend-architecture/SKILL.md) | yes |
| `client-ui` | `client/src/**` minus `app/` and tests | [frontend-architecture](../frontend-architecture/SKILL.md), [react-best-practices](../react-best-practices/SKILL.md) | yes |
| `client-tests` | `client/**/*.test.ts(x)`, `client/test/**` | [react-testing-library](../react-testing-library/SKILL.md) | no — HIGH ceiling |
| `server-transport` | `server/src/**/routes.ts`, `server/src/platform/**` | [fastify-best-practices](../fastify-best-practices/SKILL.md), [onion-architecture](../onion-architecture/SKILL.md) | yes |
| `server-domain` | `server/src/modules/**` (services, pipelines, job handlers) | [onion-architecture](../onion-architecture/SKILL.md) | yes |
| `server-data` | `server/src/**/repository*.ts`, `server/src/db/**` minus schema and migrations | [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md), [onion-architecture](../onion-architecture/SKILL.md) | yes |
| `server-schema` | `server/src/db/schema*.ts`, `server/src/db/migrations/*.sql` | [postgresql-table-design](../postgresql-table-design/SKILL.md), [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md) | yes |
| `contracts` | `*/src/vendor/shared/**`, `**/contracts*.ts` | [zod](../zod/SKILL.md) | yes |
| `engine` | `reviewer-core/src/**` | [onion-architecture](../onion-architecture/SKILL.md) §ring 0, [typescript-expert](../typescript-expert/SKILL.md) | yes |
| `server-adapters` | `server/src/adapters/**` | [onion-architecture](../onion-architecture/SKILL.md) §4, [security](../security/SKILL.md) | yes |
| `server-tests` | `server/test/**` | [onion-architecture](../onion-architecture/SKILL.md) §12 | no — HIGH ceiling |
| `mcp` | `mcp/src/**` | [onion-architecture](../onion-architecture/SKILL.md) §9/§10, [typescript-expert](../typescript-expert/SKILL.md) | yes |
| `mcp-tests` | `mcp/test/**` | [onion-architecture](../onion-architecture/SKILL.md) §12 | no — HIGH ceiling |
| `package-config` | `*/eslint.config.*`, `*/next.config.*`, `*/vitest.config.*`, `*/tsconfig*.json`, `*/package.json` | the package's own skill ([next-best-practices](../next-best-practices/SKILL.md) or [fastify-best-practices](../fastify-best-practices/SKILL.md)), [security](../security/SKILL.md) | yes |
| `security-sweep` | every changed source file matching a trigger in §3 | [security](../security/SKILL.md) | yes |
| `infra` | `.github/**`, `scripts/*.sh`, `*/bin/**`, `docker-compose.yml`, `.claude/**`, `.mcp.json` | [security](../security/SKILL.md) | yes |
| `light` | `e2e/**`, `demo/**` | — read the diff, report obvious breakage only | no — HIGH ceiling |
| — skipped — | `docs/**`, `*.md`, `**/INSIGHTS.md`, lockfiles, `_assets/**`, `**/migrations/meta/**`, generated output | — | — |

`package-config` earns a group of its own because those files decide what the
other checks even do: an ESLint rule dropped from `server/eslint.config.js` or
`eslint: { ignoreDuringBuilds }` flipped in `next.config.mjs` silently disarms a
whole gate, and the diff that does it looks like three tidy lines.

The `mcp` group exists because `mcp/src/**` matched no row at all when the
package landed, and a file in no group is reviewed by nothing. It is a stdio
transport adapter over the REST API, so the rules that apply are
`onion-architecture` §9 (*"jobs, streams and CLIs are transport too"* — a tool
handler is a route handler) and §10 (adapters translate errors; library errors
never travel inward). **Never `frontend-architecture`.**

`mcp-tests` exists for the same reason and takes §12 (test doubles are
production code, assert on recorded output rather than call counts), mirroring
`server-tests`. Two neighbouring paths are covered by widening `infra` rather
than by rows of their own: `*/bin/**`, because a package launcher is an
executable script that no `src` group matches, and `.mcp.json`, because a
committed server registration is a supply-chain surface for every clone. This
does **not** settle `reviewer-core/test/**`, which is still in no group — that
one is recorded as an open question in the root `INSIGHTS.md` and belongs to
its own change.

**The boundary between the two placement skills is not negotiable.**
`frontend-architecture` never runs on `server/` or `reviewer-core/`;
`onion-architecture` never runs on `client/`. They answer the same question
("where does this belong") with different, incompatible answers — running both
on one file produces two contradictory blockers and destroys trust in the gate.

## 2. Splitting oversized groups

`collect-diff.sh` prints the budget: **15 files or 1500 added lines per pass**.
Over it, split the group by subdirectory and name the parts
(`client-ui/pulls`, `client-ui/settings`). Never "review the first 15 and note
the rest" — a truncated pass reads exactly like a clean one in the report.

## 3. Content triggers — skills that ignore paths

Some skills are selected by what the added lines contain, not where they live.
Grep the added lines, not whole files.

| Trigger in an added line | Add | Ceiling |
|---|---|---|
| `process.env`, `fetch(`, `child_process`, `exec`, `readFile`, `req.query`, `req.body`, `req.params`, `dangerouslySetInnerHTML`, `eval(`, upload/auth/token/password handling | `security-sweep` | may block |
| `: any`, `as any`, `@ts-ignore`, `@ts-expect-error`, a new generic parameter | [typescript-expert](../typescript-expert/SKILL.md) | NOTE |
| a new ```mermaid block | [mermaid-diagram](../mermaid-diagram/SKILL.md) | NOTE |
| a changed system prompt under `docs/agent-prompts/` | that directory's `README.md` rules | HIGH |

## 4. Change kind changes the depth

| Status | How to review |
|---|---|
| `A` / `U` (new file, untracked) | Full skill set for the group. **Placement first** — a new file in the wrong folder is the finding; everything else is downstream of it |
| `M` (modified) | Only the skills relevant to the changed lines. Do not audit the rest of the file |
| `D` (deleted) | No skill pass. Look for what it left behind: orphaned imports, dead routes, tests for something that no longer exists |
| `U` also | Flag it: the file is not staged. "Forgot to `git add`" reaches the PR as a broken build |

## 5. Companion checks — what the diff should also contain

A per-file pass structurally cannot see a *missing* file. Run this table over
the whole change set, once. (The deterministic half of it — schema without
migration, vendored copies out of sync — is already enforced in `gates.sh`;
these are the ones that need judgement.)

| Change set contains | Expect it to also contain | If absent |
|---|---|---|
| a new or changed repository, or a migration | a touched `*.it.test.ts` (DB-backed, per AGENTS.md) | HIGH |
| a new route | validation, an auth path, and a test | HIGH |
| a new service or repository | its wiring in the composition root | HIGH |
| a changed Zod contract | both vendored copies **and** the client call sites updated | BLOCKER |
| a new review path in `reviewer-core` | `INJECTION_GUARD` applied to it | BLOCKER |
| changed finding/scoring code | grounding still drops uncited findings, score still recomputed from survivors | BLOCKER |
| a deleted test | a reason, in the change set or from the user | HIGH |
| a new secret or credential read | `SecretsProvider`, not a bare `process.env` in a use case | HIGH |

The last four are repo invariants from [AGENTS.md](../../../AGENTS.md). They are
not style preferences and they are not negotiable in a review pass.
