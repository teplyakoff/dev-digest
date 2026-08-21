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
| [spec-creator](spec-creator.md) | opus | **yes**, specs only | Interrogate a request across six categories, read the design for what it omits, write one EARS spec with its verification bound to it |
| [implementation-planner](implementation-planner.md) | opus | **yes**, plans only | Review the requirements, then turn them into a Development Plan someone can execute cold — never into a requirement |
| [implementer](implementer.md) | opus | **yes** | Execute an approved plan, verify its own changes, report what happened |
| [test-writer](test-writer.md) | opus | **yes** | Write the tests that pin a behaviour, in the right package, and run them. **Not in the `/impl` flow** — kept for when tests are worth an independent context |
| [architecture-reviewer](architecture-reviewer.md) | **sonnet** | no | Decide whether the code is in the right ring or the right folder, with grounded findings |
| [security-reviewer](security-reviewer.md) | opus | no | Trace each suspect line back to its input source and report only what an attacker can actually reach |
| [plan-verifier](plan-verifier.md) | opus | no | Check a change set against every item of the plan, and every criterion of the spec behind it |
| [doc-writer](doc-writer.md) | opus | **yes** | Turn an implemented feature or a plan into documentation, in the directory it belongs in |

They compose in one direction:

```
request ─→ spec-creator ─→ questions ─→ you answer ─→ spec-creator ─→ Spec
              │                                     (<pkg>/docs/specs/…)
              └─→ researcher ×N (parallel)       AC · NFR · Traceability
                                                            │
                 ┌──────────────────────────────────────────┘
                 ↓
request ─→ implementation-planner ─→ review + recommendations + mode gate
              │                                     │
              │                                     ↓   you pick the mode
              └─→ researcher (on demand)     Development Plan (docs/plans/…)
                                              S<n> → AC-<n> → test
                                                     │
                                                     ↓
                                    implementer ──────→ code + its own tests
                                                     │
                                                     ↓
                                        gates.sh --unit ─────────→ PASS · FAIL · UNKNOWN
                                                     │             implementer phase 3 —
                                                     │             deterministic, no model
                                                     ↓
                                        collect-diff.sh ─────────→ one bundle, three readers
                                                     │
                    ┌────────────────────────────────┼────────────────────────────────┐
                    ↓                                ↓                                ↓
         architecture-reviewer            security-reviewer                  plan-verifier
              **sonnet**                        opus                             opus
          → grounded findings         → HIGH/MEDIUM, or "nothing      → conformance + AC coverage
                    │                    triggered — no pass run"                     │
                    └────────────────────────────────┼────────────────────────────────┘
                                                     ↓
                                                doc-writer ───────→ docs/… + Doc Report

                                 `test-writer` is out of this flow by choice —
                                 `implementer` writes the plan's tests instead
```

### Why that order

`gates.sh --unit` answers the mechanical half — lint, typecheck, the unit suites
— at **zero model cost**, before any reviewer starts, so no agent spends
judgement on a branch that does not compile. Then one prepared diff, from
[`collect-diff.sh`](../skills/pr-self-review/scripts/collect-diff.sh), goes to
all three reviewers; three agents each deriving their own change set pay for it
three times, and the root [`INSIGHTS.md`](../../INSIGHTS.md) entry of 2026-08-06
measured what that costs: 25 of 47 files re-read byte-identical, roughly half of
~351 k tokens buying nothing.

**The final fan-out is a real one** — three read-only agents over that bundle,
launched in one message. They share no state and cost the same whether run
together or one after another, so parallel is free wall-clock, and merging any
two of them would destroy the independence that is their product.
`security-reviewer` is the only one that may decline: routing decides whether
the diff trips a security trigger at all, and a change that trips none gets one
line saying so rather than a pass with a guaranteed empty result.

**`doc-writer` is last, never in the fan-out.** Documenting a change that
`plan-verifier` is about to mark `PARTIAL` produces documentation that is wrong
on arrival.

The rework edge is the one arrow the diagram leaves out: a `FAIL` from
`gates.sh`, or a `NOT MET` from `plan-verifier`, goes back to `implementer` and
the sequence resumes from there.

### Two deliberate economies, and what each costs

**`test-writer` is out of the flow; `implementer` writes the plan's tests.**
That is the `single-agent` mode `implementation-planner` already offers, and it
saves a whole agent context. What it costs is stated in that same mode table:
*the context that wrote the code also tests it* — which is precisely what the
two-agent split existed to prevent. The mitigation is not another agent, it is
one question asked of the new tests by whoever reads the report: *would this
have failed before the change?* `test-writer` remains in the set, unchanged, for
work where an independent test context is worth paying for.

Dropping it also collapses `plan-verifier` back to **one pass**. The two-pass
split existed because `COVERED` needs the named test to exist, so grading
coverage before `test-writer` ran produced a column of `CLAIMED`. With the tests
arriving in the same step as the code, that dependency is gone and phases 1–5
run once — see *Phase 0a* in [plan-verifier.md](plan-verifier.md), which keeps
the two-pass mode for when tests do arrive separately.

**`architecture-reviewer` runs on sonnet; `security-reviewer` and
`plan-verifier` stay on opus.** The root `INSIGHTS.md` entry of 2026-08-06 warns
that cheap models buy little here, because `gates.sh` already does the
mechanical work for free and what remains in the agents is judgement. The
exception is decided by **how each one fails**:

| Agent | Failure mode when weakened | Visible? |
|---|---|---|
| `architecture-reviewer` | more unfounded findings | yes — you read them and discard them |
| `plan-verifier` | a shorter enumeration | **no** — a short conformance table reads exactly like a clean one |
| `security-reviewer` | a missed traced input | no — and its own file says an unfounded finding costs more here than a missed one |

Downgrade the noisy one, keep the silent ones. What makes the sonnet pass safe
rather than merely cheap is that `architecture-reviewer` already carries the
guardrails a smaller model needs: it may not invent a rule this repo has not
stated, a preference is a `Nit:` that never blocks, and §15's sanctioned
exemptions and known pre-existing violations are never findings.

`plan-verifier` gets a mechanical guard regardless of model, and it is the one
the same `INSIGHTS.md` entry asks for: `/impl` counts the plan's `S<n>` steps
with a `grep`, passes the number in, and checks the returned table against it. A
silently short enumeration is the one failure that agent exists to prevent, and
one `grep` is what makes it visible.

**This order is executable, not just documented.** [`/impl <plan path>`](../commands/impl.md)
runs everything from `implementer` down — see [COMMANDS.md](../COMMANDS.md).
`spec-creator` and `implementation-planner` are **not** commands and are launched
by hand: both stop to put a question to a human, and a command wrapping a stop
only makes the stop easier to skip.

The `AC` ids are the thread: `spec-creator` numbers them,
`implementation-planner` binds a step and a test name to each, `plan-verifier`
grades `AC → step → test → commit` after the code lands. Each agent treats the
artefact upstream of it as fixed — the one rule that keeps the chain from quietly
rewriting its own requirements.

**The last link is carried by the commit, not by an agent.** None of these nine
commits anything, deliberately, so `commit` is the one hop with no author in this
table. The root [`AGENTS.md`](../../AGENTS.md) — *Commits* — closes it with two
trailers, `Plan:` and `Steps:`, which is what lets `plan-verifier` follow the
chain backwards instead of filling that column in by hand. Nothing enforces them;
a commit without them is graded by its diff, as before.

`implementation-planner` and `spec-creator` may both call `researcher`, and both
may fan out several at once. Nothing else spawns anything — `implementer`,
`test-writer`, `architecture-reviewer`, `security-reviewer`, `plan-verifier` and
`doc-writer` all omit `Agent`, which blocks spawning entirely.

**Spawning crosses a boundary that nothing enforces.** `researcher` carries
`Bash`; `spec-creator` deliberately does not. Both parents have their writes
confined by a hook keyed on `agent_type` — and a subagent runs under its **own**
`agent_type`, so neither guard reaches inside it and neither can see who spawned
whom. `researcher` spawned from `implementation-planner` is therefore not
confined to `docs/plans/`; it is confined by nothing but its own prompt. Both
parents carry the explicit rule — delegate a question, never an action — and it
is prose, not enforcement. Read it as a known hole with a documented owner, not
as a guarantee.

**Two agents are invoked twice on purpose**, for the same reason: a subagent gets
one isolated context and returns one final message, so an agent that must put a
question to a human has to stop and be called again.

- `spec-creator` — pass A returns a question set and writes nothing; pass B takes
  the answers plus that report and writes the file.
- `implementation-planner` — pass A returns the requirements review, its
  recommendations and the single-agent/multi-agent gate; pass B takes the chosen
  mode and writes the plan. It skips the stop when the invocation already names
  the mode and nothing blocking came up.

In both cases the pass A block is the only carrier between the two — context does
not survive — so anything the first pass paid for (a design bundle read, an
`INSIGHTS.md` sweep) is in that block or bought again at a slightly different
answer.

**`plan-verifier` can also be invoked twice, for a different reason** — not a
dialogue but a dependency: its phase 5 cannot be graded until the tests exist.
That case no longer arises in the `/impl` flow, where `implementer` writes the
tests, so its default is a single pass. It still arises whenever `test-writer`
runs separately, and then the carrier rule applies and harder: hand pass ② the
pass ① report along with the delta range, or it regrades from scratch — a
verdict it cannot see is a verdict it may not inherit.

## Permissions and artifacts

| Agent | tools | skills | in | out | persisted by |
|---|---|---|---|---|---|
| researcher | `Read, Grep, Glob, Bash, WebSearch, WebFetch` | — | a specific question + mode | research report | the caller, if worth keeping |
| spec-creator | `Read, Grep, Glob, Write, Agent(researcher)` — **no `Bash`** | `engineering-insights` (preloaded); **reads** `acceptance-criteria/SKILL.md` by path always, `security/SKILL.md` when the feature earns it | a feature request (+ a design bundle); pass B also takes the pass A report and the answers | pass A: question set + delegated findings · pass B: Spec Report + the spec | the working tree, `<package>/docs/specs/` only |
| implementation-planner | `Read, Write, Grep, Glob, Bash, Agent(researcher)` | `engineering-insights` (preloaded); **reads** `acceptance-criteria/SKILL.md` by path | a feature request or bug report, optionally a spec; pass B also takes the gate block and the chosen mode | pass A: requirements review + recommendations + the mode gate · pass B: the plan on disk, plus a three-line final message (path · mode · open-decision count) | the working tree, `docs/plans/` only |
| implementer | `Read, Edit, Write, Grep, Glob, Bash, Skill` | — (loads on demand, by path) | an approved plan, by path or inline | Implementation Report + the changes | the working tree |
| test-writer | `Read, Edit, Write, Grep, Glob, Bash, Skill` | — (loads on demand, by path) | a behaviour to pin + its package | Test Report + the test files | the working tree |
| architecture-reviewer | `Read, Grep, Glob, Bash` | — (**reads** `SKILL.md` files by path) | a change set | grounded findings (final message) | the caller |
| security-reviewer | `Read, Grep, Glob, Bash` | — (**reads** `security/SKILL.md` sections by path) | a change set | HIGH/MEDIUM findings, or one line declining the pass (final message) | the caller |
| plan-verifier | `Read, Grep, Glob, Bash` | — (**reads** `acceptance-criteria/SKILL.md` by path) | a plan **and** a change set, plus the spec the plan cites, plus the plan's expected step count; two-pass mode additionally takes the pass ① report and a delta range | conformance table + AC coverage table (final message) | the caller |
| doc-writer | `Read, Edit, Write, Grep, Glob, Bash, Skill` | — (loads on demand, by path) | an implemented feature, or a plan/report to convert | Doc Report + the doc files | the working tree |

Models are `opus` except `researcher` and `architecture-reviewer`, which run on
`sonnet`. The Agent tool's `model` parameter overrides the frontmatter per call,
so a one-off escalation costs nothing structural — see *Two deliberate economies*.

The table is agent-per-row rather than metric-per-row: at nine agents the
transposed shape needs a column per agent and stops being readable.

Every allowlist is written out in full on purpose. Omitting `tools` inherits
**everything**, including every MCP tool in the session — often 200+ here, none
of them relevant to this repo.

## Three mechanics that surprise people

- **An agent has no `SKILL.md` and is not routed by `pr-self-review`.** It is
  absent from every cache key, so editing `.claude/agents/**` invalidates
  nothing. Changing one is still *reviewed* — `.claude/**` lands in the `infra`
  group — but that is the file being reviewed, not the file being a review input.

- **"Read-only" here is a promise, not a guarantee.** `researcher`,
  `architecture-reviewer`, `security-reviewer` and `plan-verifier` leave `Write`
  and `Edit` out of
  their allowlists, but a `tools` allowlist cannot make `Bash` read-only — `>`,
  `sed -i` and `git commit` are still reachable. All four carry an explicit deny
  list instead, in a `## Bash` section. Enforcing it properly needs a
  `PreToolUse` hook, and none of the four has one — a deliberate choice, not a
  missing capability: a hook can be declared in an agent's own frontmatter, or
  scoped globally by reading `agent_type` from the hook input. **`pr-guard.sh` is
  not that hook** — it is the pull-request gate, and mistaking it for a read-only
  enforcer is the easy wrong inference. Do not describe any of the four as
  guaranteed read-only.

  **Two agents write under a hook instead**, and both are the proof the choice
  above was a choice. [`spec-write-guard.sh`](../hooks/spec-write-guard.sh)
  confines `spec-creator` to `<package>/docs/specs/*.md`;
  [`plan-write-guard.sh`](../hooks/plan-write-guard.sh) confines
  `implementation-planner` to `docs/plans/*.md`. Both branch on `agent_type`,
  both are registered on the same `Write|Edit` matcher in `settings.json`, and
  three details are load-bearing:

  - They live in `settings.json`, **not** in an agent's `hooks:` frontmatter,
    because the frontmatter form is skipped outright unless the workspace-trust
    dialog was accepted, and a guard that silently stops guarding is worse than
    none.
  - They use `jq` where `pr-guard.sh` deliberately refuses to. The question here
    is the *value* of `.tool_input.file_path`, and a `grep` over the whole
    payload would pass a write to a source file whose content merely quotes an
    allowed path — which a spec and a plan both do constantly. Same repo,
    opposite call, because the questions are different shapes.
  - **A hook on `Write|Edit` does not reach `Bash`.** `spec-creator` has no
    `Bash` at all, so its confinement is complete. `implementation-planner` keeps
    `Bash`, so its confinement is complete only for the `Write` tool, and a shell
    redirect remains closed by prose in its `## Bash` section. Two halves, one
    enforced — do not describe that agent as sandboxed.

  Why the planner got `Write` at all: `plan-verifier` demands the plan **by
  path**, and a plan returned only as a final message reached it through a human
  re-paste. That is where plans got truncated, and a truncated plan grades as
  perfectly conformant against itself.

- **Whether an agent has the `Skill` tool is decided per agent, and the decision
  is load-bearing.** `implementer`, `test-writer` and `doc-writer` have it,
  because applying this repo's skills is their job. `researcher`,
  `implementation-planner`, `architecture-reviewer` and `plan-verifier` do not —
  a subagent whose allowlist
  omits `Skill` cannot invoke any skill in `.claude/skills/`, silently, with no
  error. `implementation-planner` reaches skill content the other way, through
  the `skills:` frontmatter field, which preloads at startup and works
  independently of the tool. `architecture-reviewer` needs two skills in one
  pass, so it `Read`s the `SKILL.md` files by path — the mechanism
  `pr-self-review/SKILL.md` already uses for the same reason. Every agent cites
  skills **by path**, never by bare name: a session here carries ~100 plugin
  skills, and `vercel:react-best-practices` is not `react-best-practices`.

Longer versions of all three, plus the harness behaviours still unverified, are
in the root [`INSIGHTS.md`](../../INSIGHTS.md).

## What grounds the rules

`researcher` predates this table; every agent after it was written against the
sources below. Cited so a future edit can tell a deliberate rule from an
inherited habit.

### spec-creator

| Rule | Source |
|---|---|
| Two passes, because a subagent cannot hold a dialogue | [sub-agents](https://code.claude.com/docs/en/sub-agents) — fresh isolated context, only the final message returns. The six categories are a conversation; one pass would turn them into a list of assumptions |
| Pass B requires the pass A report, or it stops | same — context does not survive between invocations, so the report is the only carrier of the design analysis |
| The six clarification categories | DevDigest working checklist, not a standard: data & loading · display & sorting · interactions · state & persistence · feedback · edge cases |
| EARS for every acceptance criterion, five patterns | Mavin, Wilkinson, Harwood, Novak, *Easy Approach to Requirements Syntax*, [IEEE RE'09](https://doi.org/10.1109/RE.2009.9) |
| One `AC` = one testable thing | [implementation-planner.md](implementation-planner.md) binds `S<n> → AC-<n> → test` and [plan-verifier.md](plan-verifier.md) grades that matrix one row at a time — a criterion covering three behaviours cannot be graded |
| EARS, the quality tests and the numbering live in one skill, read by path by all three | [acceptance-criteria](../skills/acceptance-criteria/SKILL.md) — the three had already drifted into three wordings of "well-formed", and drift shows up as an argument about whether a row passed |
| `[NEEDS CLARIFICATION]` rather than a silent default | [pr-self-review](../skills/pr-self-review/SKILL.md) — "Fail closed… never resolve missing information as 'no findings'" |
| UX improvements are proposals, never criteria | scope discipline: a spec that absorbs suggestions as requirements stops being the thing the caller approved |
| Design read for *missing* states, not for fidelity | the same gap [routing.md](../skills/pr-self-review/routing.md) §5 names — a per-artefact pass structurally cannot see what is absent |
| A design/request contradiction is never resolved by the agent | [plan-verifier.md](plan-verifier.md) — verification never renegotiates the artefact; the same rule applied one stage earlier |
| Writes confined by a hook, not by prose | [sub-agents](https://code.claude.com/docs/en/sub-agents) `db-reader` example · root [INSIGHTS.md](../../INSIGHTS.md) 2026-08-06 — `agent_type` is available in hook input; the frontmatter form needs workspace trust |
| No `Bash` | a `tools` allowlist cannot make `Bash` safe — the same fact the read-only bullet above is built on |
| Package spec folder, `NN-slug.md`, written before the code | [server/docs/specs/README.md](../../server/docs/specs/README.md) · the existing `01`–`05` files in `client/` and `server/` |
| Repo-global `SPEC-NN` over per-package numbering | a cross-package feature is two files and one decision — `05-intent-layer` exists in both `client/` and `server/` |
| The spec is untrusted input to the reviewer | `INJECTION_GUARD` and the `specs` slot, `reviewer-core/src/prompt.ts:213` — each chunk is delimiter-wrapped, so text copied into a spec gets read again by a model |
| Does not author plans, and hands off to `implementation-planner` | [implementation-planner.md](implementation-planner.md) owns `docs/plans/`; a spec that names files has become a plan |
| `doc-writer` no longer authors specs | [doc-writer.md](doc-writer.md) — its routing table now sends new specs here and keeps only status edits |
| `Agent(researcher)`, fanned out, one question per brief | [sub-agents](https://code.claude.com/docs/en/sub-agents) — parenthesised allowlist narrows what may be spawned; root [INSIGHTS.md](../../INSIGHTS.md) records five running in parallel here |
| Delegation is for questions, never actions | `researcher` has `Bash` and this agent does not; a subagent runs under its own `agent_type`, so neither the hook nor the missing shell reaches inside it |
| `INSIGHTS.md` is read scoped to the packages in play, never swept | [entry-quality.md](../skills/engineering-insights/references/entry-quality.md) routing table — an entry from an unrelated package is a constraint that does not apply |
| A spec that contradicts an existing spec is a phase 1 finding | two live specs disagreeing are found by whoever implements the second, and by then both are load-bearing |
| `NFR-N` carries a threshold that can be failed; accessibility is written or flagged | a word-boundary sweep of all eleven specs finds zero accessibility requirements and the repo has no a11y skill — silence there reads as "checked" |
| `## Traceability` binds each `AC`/`NFR` to unit · integration · e2e · manual | it is the spec's half of `AC → step → test → commit`; `*.it.test.ts` is mandatory for DB-backed rows because the CI suite split keys on the filename ([TESTING.md](../../TESTING.md)) |
| Size is reported past ~12 KB | the file is re-read into every review as a `specs` chunk (`reviewer-core/src/prompt.ts:213`) — length is a recurring cost, not a one-off |
| `SPEC-NN` allocation reports the highest seen | the grep is not an allocator and nothing locks it; two sessions can read the same highest |
| A cross-package feature is written as both files in one pass | half a spec reads exactly like a whole one, and the caller cannot see the missing half |

### implementation-planner

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
| A spec, when one exists, is the requirement source and is never renegotiated | [spec-creator.md](spec-creator.md) owns the `AC` list; the same verification/validation split [plan-verifier.md](plan-verifier.md) rests on, applied one stage earlier |
| Plans *how*, never *what* — no write under `*/docs/specs/`, no drafted `AC`, no answered `[NEEDS CLARIFICATION]` | the rename to `implementation-planner` is the point: requirement authorship moved to [spec-creator.md](spec-creator.md), and a plan that repairs a requirement forks it where nothing downstream can tell the forks apart |
| Requirement-level findings are reported and routed, never repaired in a step | bidirectional traceability, ISO/IEC/IEEE 29148 — the defect belongs to the artefact that has it |
| Recommendations are numbered `R-N` proposals; the plan follows the requirements until one is accepted | the same rule that keeps `spec-creator`'s `UX-N` out of the `AC` list — a suggestion absorbed silently is scope creep with a rationale |
| The single-agent/multi-agent gate is asked, not assumed | the mode changes the plan's shape, not just its execution; parallel tracks must have disjoint file sets because `implementer` and `test-writer` both write |
| A request with no outcome is refused to `spec-creator`, not planned anyway | [plan-verifier.md](plan-verifier.md) phase 0 refuses to reconstruct a plan from a diff, for the same circularity reason |
| Every `AC` maps to a step, or to *Out of scope* with a reason | bidirectional traceability, ISO/IEC/IEEE 29148 — an uncovered requirement and an orphaned step are different defects |
| Step ids stay `S<n>`, not the `T<n>` of the source illustration | the 32 `### S<n>` headings already in `docs/plans/`, and the row keys [plan-verifier.md](plan-verifier.md) reads. Two id schemes in one repo cost more than matching an example |
| Every skill citation carries a resolving anchor — `§N`, or the heading verbatim | a bare path makes [implementer.md](implementer.md) read 408–603 lines per skill per step; the section was already read here to write the binding rule. Only `onion-architecture` and `frontend-architecture` are numbered, so the anchor form is per skill, not universal |
| Writes the plan itself, confined to `docs/plans/*.md` by a hook | [plan-write-guard.sh](../hooks/plan-write-guard.sh), same mechanism as `spec-write-guard.sh`. [plan-verifier.md](plan-verifier.md) needs the plan by path, and a human re-paste of a 20 k-token document is where plans got truncated — a truncated plan grades as conformant against itself |
| The final message is three lines, not a second copy of the plan | the plan is on disk; re-sending it is the duplication root [INSIGHTS.md](../../INSIGHTS.md) 2026-08-06 names — context re-sent every turn is the driver, not document length |
| Does not spawn `researcher` for what a spec or a supplied brief already establishes | root [INSIGHTS.md](../../INSIGHTS.md) 2026-08-06 — ~101 k tokens, 8 % of a feature's budget, billed inside the planner's own run so it never shows in a notification |
| A blocking `[NEEDS CLARIFICATION]` produces *Out of scope*, never a step | a step built on a guess is graded against the guess by every pass downstream; [spec-creator.md](spec-creator.md) marks each open question `blocking` precisely so this call can be made mechanically |
| *Traceability* is never trimmed to the covered rows | the table's only job is exposing the criterion nobody built; a table that omits it asserts the opposite |

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
| Phase 3 is one `gates.sh --unit` run, not a per-package command table | the script already picks the manager per package and collapses a passing suite to one line — measured, 51 lines of `server` vitest output become 1. `--full` is the pre-PR mode and pulls the testcontainers |
| Skills are read by **section**, using the plan's anchor | root [INSIGHTS.md](../../INSIGHTS.md) 2026-08-06 — the driver is tool calls × context re-sent, not document length. The four skills this agent reaches for most are 408–603 lines, and `implementation-planner` already read the binding section to write the contract |
| A step's `Verify` is narrow; the whole-package gate runs once | N steps in one package used to mean N+1 suite runs, each streaming a full reporter into context |

### test-writer

| Rule | Source |
|---|---|
| `Skill` in the allowlist | [sub-agents](https://code.claude.com/docs/en/sub-agents) — omitting `Skill` is how you *prevent* skill invocation; root [INSIGHTS.md](../../INSIGHTS.md) records that it fails silently |
| Client test placement, 1–3 flow tests per component, `screen` + `userEvent` | [react-testing-library](../skills/react-testing-library/SKILL.md) §Test File Conventions · [frontend-architecture](../skills/frontend-architecture/SKILL.md) §14 |
| The ring decides the technique; only ring 3 gets a database | [onion-architecture](../skills/onion-architecture/SKILL.md) §12 |
| `*.it.test.ts` is mandatory for DB-backed tests | [server/AGENTS.md](../../server/AGENTS.md) · [TESTING.md](../../TESTING.md) — the CI suite split depends on the filename |
| `pnpm exec vitest run …` rather than a committed script | [TESTING.md](../../TESTING.md) — `server/package.json` commits only a bare `test`, so there is no `test:unit` lane to call. The older justification, `skip-worktree`, no longer holds: `git ls-files -v` reports `H` |
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
| Runs on **sonnet** | its failure mode when weakened is *noise*, which the reader discards, unlike the two silent ones — see *Two deliberate economies*. Its existing guardrails are what make that safe: no invented rules, preferences are `Nit:`, §15 exemptions are never findings |

### security-reviewer

| Rule | Source |
|---|---|
| Trace the input before flagging the pattern | [security](../skills/security/SKILL.md) — *Core Philosophy*: `fetch(process.env.API_URL)` is safe, `fetch(req.query.url)` is not |
| HIGH and MEDIUM only; LOW is never reported | same file's confidence table. A theoretical finding costs more than a missed one here, because nothing downstream filters this agent |
| The skill's stack is Express + MongoDB + JWT; this repo is Fastify + Drizzle + Postgres with **no auth layer** | the skill is a general-purpose OWASP file, not a repo document. Verified: `server/src/app.ts` registers helmet, cors and rate-limit and no authentication hook exists — so A01/A07 mostly describe code that is not here |
| "No auth on this endpoint" is not a finding | local-first, single user, one developer's own repos — [AGENTS.md](../../AGENTS.md). A finding must show something crossing *out* of that boundary |
| Prompt injection is the first surface, not the tenth | `INJECTION_GUARD`, `reviewer-core/src/prompt.ts:25`, and the `specs` slot at `:213` — the product's own core threat, and the one the skill's *Agentic AI Security* section actually covers |
| The PAT-in-URL leak is called out by name | `server/src/modules/repos/helpers.ts` — `withGitHubToken` sets the token as the URL password, so it leaks by being printed, not by being stolen |
| `spawn(rg, [...])` argv form is **not** command injection | `server/src/adapters/codeindex/ripgrep.ts:60` — no shell. Flagging it is the false positive that would discredit the pass; the real risks are flag injection and an unbounded root |
| Declines the pass when nothing triggers | [routing.md](../skills/pr-self-review/routing.md) §3 and §1 decide it. A security pass over a CSS change is a cost with a guaranteed empty result |
| *Surfaces checked and clear* may never be dropped | a report with no findings and no list of what was examined is indistinguishable from one where nothing was examined |
| Never executes the code under review | a finding is proven by the traced path; running it is an exploit, not a review |
| `## Bash` backstop wording | as `architecture-reviewer` |

### plan-verifier

| Rule | Source |
|---|---|
| This is verification, not validation — never renegotiate the plan | [IEEE 1012](https://standards.ieee.org/ieee/1012/5609/) · Boehm, *Verifying and Validating Software Requirements and Design Specifications*, IEEE Software 1(1), 1984 |
| One row, one verdict, in plan order, from a fixed enum | the shape of a `implementation-planner` plan ([implementation-planner.md](implementation-planner.md)) · [G-Eval](https://arxiv.org/abs/2303.16634) — itemised form-filling beats a holistic score |
| An unverifiable item is `UNVERIFIABLE`, never `MET` | [pr-self-review](../skills/pr-self-review/SKILL.md) — "Fail closed… never resolve missing information as 'no findings'" · [Anthropic, Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — give the model a way out |
| Grade each item in isolation; volume is not evidence | [MT-Bench (Zheng et al., 2023)](https://arxiv.org/abs/2306.05685) — measured position and verbosity bias in LLM judges |
| The reverse pass — unrequested changes are the other half of conformance | bidirectional traceability, ISO/IEC/IEEE 29148; an orphaned change and an uncovered requirement are different defects |
| Never substitutes general review advice | the stated failure mode; also why it has no `Skill` tool. [best-practices](https://code.claude.com/docs/en/best-practices) — "Report gaps, not style preferences" |
| Refuses to reconstruct the plan from the diff | [implementer.md](implementer.md) phase 0 — an agent that plans its own work has lost the independent check |
| The §5 companion pass | [routing.md](../skills/pr-self-review/routing.md) §5 — "a per-file pass structurally cannot see a *missing* file" |
| Coverage is graded from the **spec's** `AC` list, never the plan's table | the same circularity as reconstructing a plan from the diff, one level up: a criterion the plan forgot cannot be missing from a list derived from the plan |
| `CLAIMED` is separate from `COVERED` | a matrix whose test column is aspirational reads exactly like a satisfied one; [Anthropic, Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — give the model a way out |
| A spec's `[NEEDS CLARIFICATION]` gets no row | it is not a criterion, and resolving it is a product call — [spec-creator.md](spec-creator.md) |
| An unreadable cited spec makes coverage `UNVERIFIABLE`, not skipped | fail closed, [pr-self-review](../skills/pr-self-review/SKILL.md) |
| `## Bash` backstop wording | as `architecture-reviewer` |
| Commit `Steps:` trailers are corroborating evidence, never substitutive | root [AGENTS.md](../../AGENTS.md) — *Commits*. A trailer is an author's claim about their own work, which *Non-negotiables 6* already discounts; what it buys is the reverse direction, making the `commit` column machine-followable |
| One pass by default; two only when `test-writer` runs separately | `COVERED` requires the named test to exist and pass, so phase 5 before the tests are written yields only `CLAIMED`. In the `/impl` flow `implementer` writes them, so the dependency is gone and phases 1–5 run once |
| Stays on **opus**, with a mechanical step-count guard | root [INSIGHTS.md](../../INSIGHTS.md) 2026-08-06 — a weakened verifier fails *silently*: a short enumeration reads exactly like a clean conformance table. That entry asks for the count assertion by name, and [`/impl`](../commands/impl.md) supplies it with one `grep` |
| Pass ② takes the delta and the pass ① report, not the branch base | root [INSIGHTS.md](../../INSIGHTS.md) 2026-08-06 — 25 of 47 files re-read byte-identical, ~half of ~351 k tokens. A verdict pass ② cannot see is one it may not inherit |

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
