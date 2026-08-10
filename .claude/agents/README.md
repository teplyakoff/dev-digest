# Agents

Subagents, invoked through the Task tool, living in `.claude/agents/`. Not
skills — a skill is knowledge the main agent loads; an agent is a **separate
context** that does a job and hands back one artifact.

This file is the map. Each agent's own file is the contract — read it before
changing behaviour, not this one.

## The set

| Agent | Model | Writes files? | One job |
|---|---|---|---|
| [researcher](researcher.md) | sonnet | no | Answer one question — REPO (how this codebase works, why it changed) or EXTERNAL (what upstream docs actually say) |
| [planner](planner.md) | opus | no | Turn a request into a Development Plan someone can execute cold |
| [implementer](implementer.md) | opus | **yes** | Execute an approved plan, verify its own changes, report what happened |
| [test-writer](test-writer.md) | opus | **yes** | Write the tests that pin a behaviour, in the right package, and run them |
| [architecture-reviewer](architecture-reviewer.md) | opus | no | Decide whether the code is in the right ring or the right folder, with grounded findings |
| [plan-verifier](plan-verifier.md) | opus | no | Check a change set against every item of the plan it was meant to satisfy |
| [doc-writer](doc-writer.md) | opus | **yes** | Turn an implemented feature or a plan into documentation, in the directory it belongs in |

They compose in one direction:

```
request ─→ planner ──→ Development Plan ──→ implementer ──→ code + report
              │         (docs/plans/…)                          │
              └─→ researcher (on demand)                        │
                                                                ├─→ test-writer ───────────→ tests + Test Report
                                                                ├─→ architecture-reviewer ─→ grounded findings
                                                                ├─→ plan-verifier ─────────→ conformance table
                                                                └─→ doc-writer ────────────→ docs/… + Doc Report

                                             a security-review agent is still not built
```

`planner` may call `researcher`. Nothing else spawns anything — `implementer`,
`test-writer`, `architecture-reviewer`, `plan-verifier` and `doc-writer` all omit
`Agent`, which blocks spawning entirely.

## Permissions and artifacts

| Agent | tools | skills | in | out | persisted by |
|---|---|---|---|---|---|
| researcher | `Read, Grep, Glob, Bash, WebSearch, WebFetch` | — | a specific question + mode | research report | the caller, if worth keeping |
| planner | `Read, Grep, Glob, Bash, Agent(researcher)` | `engineering-insights` (preloaded) | a feature request or bug report | Development Plan (final message) | the caller → `docs/plans/L<NN>-<slug>.md` |
| implementer | `Read, Edit, Write, Grep, Glob, Bash, Skill` | — (loads on demand, by path) | an approved plan, by path or inline | Implementation Report + the changes | the working tree |
| test-writer | `Read, Edit, Write, Grep, Glob, Bash, Skill` | — (loads on demand, by path) | a behaviour to pin + its package | Test Report + the test files | the working tree |
| architecture-reviewer | `Read, Grep, Glob, Bash` | — (**reads** `SKILL.md` files by path) | a change set | grounded findings (final message) | the caller |
| plan-verifier | `Read, Grep, Glob, Bash` | — | a plan **and** a change set | conformance table (final message) | the caller |
| doc-writer | `Read, Edit, Write, Grep, Glob, Bash, Skill` | — (loads on demand, by path) | an implemented feature, or a plan/report to convert | Doc Report + the doc files | the working tree |

The table is agent-per-row rather than metric-per-row: at seven agents the
transposed shape needs a column per agent and stops being readable.

Every allowlist is written out in full on purpose. Omitting `tools` inherits
**everything**, including every MCP tool in the session — often 200+ here, none
of them relevant to this repo.

## Three mechanics that surprise people

- **An agent has no `SKILL.md` and is not routed by `pr-self-review`.** It is
  absent from every cache key, so editing `.claude/agents/**` invalidates
  nothing. Changing one is still *reviewed* — `.claude/**` lands in the `infra`
  group — but that is the file being reviewed, not the file being a review input.

- **"Read-only" here is a promise, not a guarantee.** `researcher`, `planner`,
  `architecture-reviewer` and `plan-verifier` leave `Write` and `Edit` out of
  their allowlists, but a `tools` allowlist cannot make `Bash` read-only — `>`,
  `sed -i` and `git commit` are still reachable. All four carry an explicit deny
  list instead, in a `## Bash` section. Enforcing it properly needs a
  `PreToolUse` hook, and none of the four has one — a deliberate choice, not a
  missing capability: a hook can be declared in an agent's own frontmatter, or
  scoped globally by reading `agent_type` from the hook input. **`pr-guard.sh` is
  not that hook** — it is the pull-request gate, and mistaking it for a read-only
  enforcer is the easy wrong inference. Do not describe any of the four as
  guaranteed read-only.

- **Whether an agent has the `Skill` tool is decided per agent, and the decision
  is load-bearing.** `implementer`, `test-writer` and `doc-writer` have it,
  because applying this repo's skills is their job. `researcher`, `planner`,
  `architecture-reviewer` and `plan-verifier` do not — a subagent whose allowlist
  omits `Skill` cannot invoke any skill in `.claude/skills/`, silently, with no
  error. `planner` reaches skill content the other way, through the `skills:`
  frontmatter field, which preloads at startup and works independently of the
  tool. `architecture-reviewer` needs two skills in one pass, so it `Read`s the
  `SKILL.md` files by path — the mechanism `pr-self-review/SKILL.md` already uses
  for the same reason. Every agent cites skills **by path**, never by bare name:
  a session here carries ~100 plugin skills, and `vercel:react-best-practices` is
  not `react-best-practices`.

Longer versions of all three, plus the harness behaviours still unverified, are
in the root [`INSIGHTS.md`](../../INSIGHTS.md).

## What grounds the rules

`researcher` predates this table; every agent after it was written against the
sources below. Cited so a future edit can tell a deliberate rule from an
inherited habit.

### planner

| Rule | Source |
|---|---|
| The plan must be self-contained; the report template is mandatory | [sub-agents](https://code.claude.com/docs/en/sub-agents) — a subagent gets a fresh isolated context and returns only its final message |
| Steps name files · *Out of scope* · *End-to-end verification* are required sections | [best-practices](https://code.claude.com/docs/en/best-practices) — "self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step" |
| Skill content arrives via `skills:`, not the `Skill` tool | [sub-agents](https://code.claude.com/docs/en/sub-agents) — "controls which skills are preloaded, **not** which skills the subagent can access" |
| `Agent(researcher)` rather than a wider tool surface | [sub-agents](https://code.claude.com/docs/en/sub-agents) — parenthesised allowlist narrows which subagents may be spawned |
| `## Bash` is labelled a backstop, not enforcement | [sub-agents](https://code.claude.com/docs/en/sub-agents) — the `db-reader` example enforces read-only with a `PreToolUse` hook |
| Description in third person, ending in a negative trigger | [skill best-practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — "Always write in third person"; applied to agent descriptions by analogy |
| Skill contract is built from the routing table, and never assigns both placement skills to one file | [routing.md](../skills/pr-self-review/routing.md) §1 |
| *Companion changes* is a required section | [routing.md](../skills/pr-self-review/routing.md) §5 — "a per-file pass structurally cannot see a *missing* file" |
| Top-3 `INSIGHTS.md` entries per package in scope | [AGENTS.md](../../AGENTS.md) — session loop |
| Phase 0 · mandatory *Open decisions* · calibration | [researcher.md](researcher.md) — house style, followed deliberately |
| Repo content is untrusted data | `INJECTION_GUARD` in `reviewer-core/src/prompt.ts`, per [AGENTS.md](../../AGENTS.md) |
| Skills cited by path | plugin-namespace collisions — root [INSIGHTS.md](../../INSIGHTS.md) |

### implementer

| Rule | Source |
|---|---|
| `Skill` in the allowlist | [sub-agents](https://code.claude.com/docs/en/sub-agents) — "omit `Skill` from the `tools` list" is how you *prevent* skill invocation |
| Report grounded in `path:line` | repo invariant — a finding that cites nothing is dropped, per [AGENTS.md](../../AGENTS.md) |
| An unverifiable step is `PARTIAL`, never `DONE` | [pr-self-review](../skills/pr-self-review/SKILL.md) — "Fail closed… never resolve missing information as 'no findings'" |
| Does not run `/pr-self-review` | [pr-self-review](../skills/pr-self-review/SKILL.md) — its own description: ON DEMAND ONLY |
| Does not review its own work | [best-practices](https://code.claude.com/docs/en/best-practices) — a reviewer in fresh context "won't be biased toward code it just wrote" |
| Does not commit, push or open a PR | [pr-guard.sh](../hooks/pr-guard.sh) blocks these anyway; the agent states it rather than discovering it |
| Per-package manager and commands | [AGENTS.md](../../AGENTS.md) layout table · [TESTING.md](../../TESTING.md) |
| Frozen paths, `vendor-shared.sh` flow, applied migrations | [AGENTS.md](../../AGENTS.md) — *Do not touch* |
| `*.it.test.ts` naming | [server/AGENTS.md](../../server/AGENTS.md) — the CI suite split depends on it |
| Code being edited is untrusted data | `INJECTION_GUARD`, as above |

### test-writer

| Rule | Source |
|---|---|
| `Skill` in the allowlist | [sub-agents](https://code.claude.com/docs/en/sub-agents) — omitting `Skill` is how you *prevent* skill invocation; root [INSIGHTS.md](../../INSIGHTS.md) records that it fails silently |
| Client test placement, 1–3 flow tests per component, `screen` + `userEvent` | [react-testing-library](../skills/react-testing-library/SKILL.md) §Test File Conventions · [frontend-architecture](../skills/frontend-architecture/SKILL.md) §14 |
| The ring decides the technique; only ring 3 gets a database | [onion-architecture](../skills/onion-architecture/SKILL.md) §12 |
| `*.it.test.ts` is mandatory for DB-backed tests | [server/AGENTS.md](../../server/AGENTS.md) · [TESTING.md](../../TESTING.md) — the CI suite split depends on the filename |
| `pnpm exec vitest run …` rather than a committed script | [TESTING.md](../../TESTING.md) — `server/package.json` is `skip-worktree` |
| Typological, not exhaustive; coverage is never the target | [TESTING.md](../../TESTING.md) — "if a test wouldn't catch a class of regression we care about, we don't write it" · [Fowler, TestCoverage](https://martinfowler.com/bliki/TestCoverage.html) |
| Behaviour-sensitive, structure-insensitive | [Kent Beck, Test Desiderata](https://testdesiderata.com/) |
| Real dependency > fake > stub > interaction mock | [Software Engineering at Google, ch. 13](https://abseil.io/resources/swe-book/html/ch13.html) — mock-heavy tests "rarely finding bugs" |
| Never edits production code to make a test pass | house rule — the same independent-check split that keeps `implementer` from reviewing its own work |
| Browser journeys are out of scope | [e2e/AGENTS.md](../../e2e/AGENTS.md) · [client/AGENTS.md](../../client/AGENTS.md) |

### architecture-reviewer

| Rule | Source |
|---|---|
| No `Skill`; reads the two `SKILL.md` files by path | [pr-self-review](../skills/pr-self-review/SKILL.md) phase 5 — "Read the group's skill files directly (Read, not the Skill tool — a pass usually needs two of them at once)" |
| Never both placement skills on one file | [routing.md](../skills/pr-self-review/routing.md) §1 |
| §15 / §14 are the authority, but the package `AGENTS.md` outranks them | [onion-architecture](../skills/onion-architecture/SKILL.md) §15 · [frontend-architecture](../skills/frontend-architecture/SKILL.md) §14 |
| Sanctioned exemptions are never findings; known violations are pre-existing | [onion-architecture](../skills/onion-architecture/SKILL.md) §15 |
| Every finding grounded in `path:line`, or dropped | repo invariant, [AGENTS.md](../../AGENTS.md) |
| Adapter substitution and simple data crossing a boundary are not violations | [Cockburn, Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) · [Martin, The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) |
| A preference with no codified rule is a `Nit:` and never blocks | [Google eng-practices](https://google.github.io/eng-practices/review/reviewer/standard.html) — style-guide matters are the style guide's authority, not the reviewer's |
| Cross-package checks neither skill owns | [routing.md](../skills/pr-self-review/routing.md) §5 |
| `## Bash` is a backstop; `pr-guard.sh` is a PR gate, not a read-only enforcer | [sub-agents](https://code.claude.com/docs/en/sub-agents) `db-reader` example · [.claude/settings.json](../settings.json) · [pr-self-review](../skills/pr-self-review/SKILL.md) |
| Not a replacement for `/pr-self-review` | [pr-self-review](../skills/pr-self-review/SKILL.md) — that skill owns the verdict and the hook |

### plan-verifier

| Rule | Source |
|---|---|
| This is verification, not validation — never renegotiate the plan | [IEEE 1012](https://standards.ieee.org/ieee/1012/5609/) · Boehm, *Verifying and Validating Software Requirements and Design Specifications*, IEEE Software 1(1), 1984 |
| One row, one verdict, in plan order, from a fixed enum | the shape of a `planner` plan ([planner.md](planner.md)) · [G-Eval](https://arxiv.org/abs/2303.16634) — itemised form-filling beats a holistic score |
| An unverifiable item is `UNVERIFIABLE`, never `MET` | [pr-self-review](../skills/pr-self-review/SKILL.md) — "Fail closed… never resolve missing information as 'no findings'" · [Anthropic, Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — give the model a way out |
| Grade each item in isolation; volume is not evidence | [MT-Bench (Zheng et al., 2023)](https://arxiv.org/abs/2306.05685) — measured position and verbosity bias in LLM judges |
| The reverse pass — unrequested changes are the other half of conformance | bidirectional traceability, ISO/IEC/IEEE 29148; an orphaned change and an uncovered requirement are different defects |
| Never substitutes general review advice | the stated failure mode; also why it has no `Skill` tool. [best-practices](https://code.claude.com/docs/en/best-practices) — "Report gaps, not style preferences" |
| Refuses to reconstruct the plan from the diff | [implementer.md](implementer.md) phase 0 — an agent that plans its own work has lost the independent check |
| The §5 companion pass | [routing.md](../skills/pr-self-review/routing.md) §5 — "a per-file pass structurally cannot see a *missing* file" |
| `## Bash` backstop wording | as `architecture-reviewer` |

### doc-writer

| Rule | Source |
|---|---|
| `Skill` in the allowlist, for `mermaid-diagram` by path | root [INSIGHTS.md](../../INSIGHTS.md) — omitting `Skill` disables skills silently; plugin skills collide by topic |
| Classify before routing; never mix document types on one page | [Diátaxis](https://diataxis.fr/) |
| The routing table | [docs/agent-prompts/README.md](../../docs/agent-prompts/README.md) · [docs/skills/README.md](../../docs/skills/README.md) · [docs/results/README.md](../../docs/results/README.md) · [server/docs/specs/README.md](../../server/docs/specs/README.md) · [server/docs/README.md](../../server/docs/README.md) |
| A plan becoming docs sheds its alternatives; they belong in an ADR | [Nygard, Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) · [Diátaxis](https://diataxis.fr/explanation/) — rationale is Explanation, not How-to |
| Never edits a `CLAUDE.md` | [AGENTS.md](../../AGENTS.md) — every one is a symlink to the `AGENTS.md` beside it |
| Never edits an `INSIGHTS.md` | [AGENTS.md](../../AGENTS.md) session loop · [engineering-insights](../skills/engineering-insights/SKILL.md) owns that file |
| Never restates what another file owns | [server/AGENTS.md](../../server/AGENTS.md) · [client/AGENTS.md](../../client/AGENTS.md) · [server/docs/README.md](../../server/docs/README.md) |
| No time-anchored language | [Google style guide — Timeless documentation](https://developers.google.com/style/timeless-documentation) |
| Every behavioural claim verified against the code | [DocAgent (ACL 2025)](https://arxiv.org/abs/2504.08725) — incompleteness and factual error are the named failure axes |
| Agent-prompt conventions are hard rules | [docs/agent-prompts/README.md](../../docs/agent-prompts/README.md) — no JSON shape in prose, three required blocks, the checklist |
| Diagrams clarify, they do not decorate; context + container, never hand-maintained code level | [mermaid-diagram](../skills/mermaid-diagram/SKILL.md) · [C4 model](https://c4model.com/) |
| The Mermaid render is never validated here | [GitHub docs — creating diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) — GitHub renders a pinned version that can lag upstream syntax |
| `docs/**` is skipped by the review gate, so routing is final here | [routing.md](../skills/pr-self-review/routing.md) §1 |

## Adding an agent

1. One file, `<name>.md`, frontmatter then prose. Only `name` and `description`
   are required — write `tools` anyway.
2. Description in third person, under 1024 characters, ending with what the agent
   is **not** for. That last clause is what stops it being invoked by mistake.
3. Decide `Skill` explicitly. Silence means no skills, silently.
4. End the prose with the output template. The caller sees the final message and
   nothing else, so anything not in the template is lost.
5. Add a row to *The set* and *Permissions and artifacts* above.

Project agents here override user-level ones of the same name in
`~/.claude/agents/`.
