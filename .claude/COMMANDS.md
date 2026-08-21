# Commands

Slash commands, living in `.claude/commands/`. A command is a **prompt the user
invokes by name** — it runs in the main context, unlike an
[agent](agents/README.md), which is a separate context that returns one artifact,
and unlike a [skill](skills/README.md), which is knowledge loaded on demand.

## The set

| Command | Stage | Hands you |
|---|---|---|
| [`/impl`](commands/impl.md) | plan → code, verified | the change set, one conformance pass, architectural and security findings, the commit message |

One command, and that is the whole set on purpose.

## Why only the last stage is a command

The SDD flow has three stages. The first two are run **by hand**, with the Agent
tool:

1. `spec-creator` — two passes: a question set across six clarification
   categories, then the spec at `<package>/docs/specs/NN-slug.md`.
2. `implementation-planner` — two passes: a requirements review with the
   single-agent/multi-agent gate, then the plan at `docs/plans/<name>.md`.
3. `/impl <plan path>` — everything downstream of an approved plan.

Stages 1 and 2 both **stop to put a question to a human**: a question set that
needs answers, a set of `R-N` recommendations that need accepting or declining, a
mode that needs choosing. Wrapping a stop inside a command does not make it
easier to answer — it makes it easier to skip, because a command reads as
something you fire and wait for. They were commands briefly and are not any more.

Stage 3 has no such stop until the reviews come back, so it is exactly the part
worth automating: a fixed order, a fixed set of flags, and four agents whose
launch parameters are otherwise re-decided from memory every session.

## What `/impl` encodes

- **The order.** `implementer` → `gates.sh --unit` (no model tokens, so nothing
  expensive runs against a branch that does not compile) → one prepared diff →
  three reviewers in parallel → `doc-writer`, only if the verdicts are clean.
- **The models.** `architecture-reviewer` runs on **sonnet**;
  `security-reviewer` and `plan-verifier` stay on **opus**. The two downgrades
  fail differently, and that asymmetry is the whole argument: a weaker
  architecture pass is *noisier* and you discard the noise, while a weaker
  conformance pass is *shorter* and a short enumeration reads exactly like a
  clean table.
- **The item-count guard.** One `grep` for the plan's `S<n>` steps, passed into
  `plan-verifier` and checked against the table it returns. This is what makes a
  silently short enumeration visible, and it is cheap enough to keep whatever
  model that agent runs on.
- **No `test-writer`.** `implementer` writes the plan's tests itself, under the
  names the plan's *Traceability* table already chose. That saves a whole agent
  context; what it costs is independence, so `/impl` tells you to read the new
  tests against one question — *would this have failed before the change?*
- **The token discipline** from the root [`INSIGHTS.md`](../INSIGHTS.md) entries
  of 2026-08-06: read skills by anchor rather than whole, verify narrowly per
  step and gate once per package, and hand every reviewer the same prepared diff.

## Two things it deliberately does not do

- **It does not run `/pr-self-review`.** That skill is ON DEMAND ONLY and owns
  the verdict `.claude/hooks/pr-guard.sh` reads before letting `git push` or
  `gh pr create` through. A command that ran it would be pre-approving the user's
  own gate.
- **It does not commit.** It hands you the message, including the `Plan:` and
  `Steps:` trailers, and stops.

## Adding a command

1. One file, `<name>.md` — the filename is the command name.
2. Frontmatter: `description` (shown in the command list) and `argument-hint`.
   `$ARGUMENTS` interpolates everything the user typed; `$1`…`$9` take
   positional slices.
3. Write it as instructions to the agent that will run it, not as documentation
   about it. The reader is the model, in this session's context.
4. Add a row to *The set* above.

Subdirectories namespace a command — `.claude/commands/x/y.md` becomes `/x:y`.
Project commands there override user-level ones of the same name in
`~/.claude/commands/`.

**Every `.md` in `.claude/commands/` becomes a command, with no exceptions for
documentation.** That is why this map lives at `.claude/COMMANDS.md` and not in
the folder it describes: a `README.md` there registers a phantom `/README`,
listed in the command palette, invocable, and doing nothing. `.claude/skills/`
does not have this problem — a skill is a *directory* with a `SKILL.md`, so a
loose README beside them is inert. The two folders look symmetrical and are not.
