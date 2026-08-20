# Commands

Slash commands, living in `.claude/commands/`. A command is a **prompt the user
invokes by name** — it runs in the main context, unlike an
[agent](agents/README.md), which is a separate context that returns one
artifact, and unlike a [skill](skills/README.md), which is knowledge loaded on
demand.

## The set

| Command | Stage | Hands you |
|---|---|---|
| [`/sdd-spec`](commands/sdd-spec.md) | request → spec | `<package>/docs/specs/NN-slug.md`, `SPEC-NN`, the open questions |
| [`/sdd-plan`](commands/sdd-plan.md) | spec → plan | `docs/plans/<name>.md`, the execution mode |
| [`/sdd-build`](commands/sdd-build.md) | plan → code, tests, verdicts | the change set, two conformance passes, the architectural findings |

They chain: each one ends by naming the next with the argument it needs.

## What these three are for

The eight agents already knew their own jobs. What lived nowhere was the **order
they run in and the flags that keep them affordable** — which meant both were
re-decided from memory every session, and drifted. These files are where that
now lives:

- the sequence after `implementer` is **not** a fan-out. `test-writer` writes
  files, so `architecture-reviewer` cannot grade beside it; `plan-verifier` runs
  twice because its phase 5 needs the tests to exist; `doc-writer` is last
  because documenting a `PARTIAL` change ships documentation that is wrong on
  arrival. The full argument is in [agents/README.md](agents/README.md) —
  *Why that order, and not a fan-out*.
- the token discipline is stated once, at the point it applies: do not spawn a
  `researcher` for what a spec already cites, read skills by anchor rather than
  whole, verify narrowly per step and gate once per package, and hand every
  reviewer the **same** prepared diff scoped to the unreviewed delta.

Every number cited in them comes from the root [`INSIGHTS.md`](../INSIGHTS.md)
entries of 2026-08-06, which measured what skipping each one costs.

## Two things they deliberately do not do

- **Neither runs `/pr-self-review`.** That skill is ON DEMAND ONLY and owns the
  verdict `.claude/hooks/pr-guard.sh` reads before letting `git push` or
  `gh pr create` through. A command that ran it for you would be pre-approving
  the user's own gate.
- **None of them approves anything.** A spec's `Status:` stays `draft`, an `R-N`
  recommendation stays a proposal, and the single-agent/multi-agent choice is put
  to the user rather than assumed. Each stop is a decision that changes what gets
  built, not a courtesy round-trip.

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
