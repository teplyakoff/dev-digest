---
description: Stage 2 of the SDD flow — review the requirements, pick the execution mode, write the plan
argument-hint: <spec path | feature request>
---

# /sdd-plan — spec → plan

Stage 2 of three. `/sdd-spec` precedes it, `/sdd-build` follows.

**Input:** $ARGUMENTS

`implementation-planner` also runs in two passes: pass A reviews the requirements
and puts the single-agent/multi-agent gate to you, pass B writes the plan to
`docs/plans/`. It skips the stop when the invocation already names the mode and
nothing blocking came up — so if the user has already said "multi-agent", say so
in the prompt and let it plan in one pass.

## Pass A — review, recommendations, mode gate

Launch `implementation-planner` with the input above. Include, verbatim:

- the spec path if there is one, or the request if there is not — no spec is
  normal, and most work here predates the format;
- **"do not spawn a `researcher` for anything the spec already cites"** — a run
  costs ~100 k tokens, is billed inside the planner's own run where you never see
  it, and a spec's `## Inputs and provenance` plus its `path:line` citations are
  finished research;
- any brief the user supplied, plus **"the briefs below are your research"**;
- the execution mode, **if the user has already chosen one**.

Then **stop** and show the user the returned block as-is: the requirements
review, the numbered `R-N` recommendations, and the mode gate with its
recommendation. Three things you do not do here — accept an `R-N` on the user's
behalf, answer a blocking question for them, or pick the mode yourself. All three
change what gets built.

## Pass B — the plan

Launch it again with the chosen mode, the accepted `R-N` list (or "none
accepted"), and **the complete pass A block pasted in** — the `INSIGHTS.md` top
three, the spec id and status, the packages and managers. That context is gone
otherwise, and the next pass reaches slightly different conclusions.

It writes the plan itself, to `docs/plans/<name>.md`, and
`.claude/hooks/plan-write-guard.sh` confines it there. Its final message is three
lines: path, mode, open-decision count. If it reports a **blocked** write, relay
the guard's message and stop — a plan reported as written and absent from disk
is the worst outcome available.

## Check before you hand it on

Read the plan on disk — not the agent's summary of it — and confirm:

- **every step names its files, its skills with a resolving anchor (`§N` or the
  heading verbatim), an observable done-condition and an exact `Verify`
  command.** A `Verify` that runs a whole suite is a defect: the per-step check
  is narrow, and the whole-package gate runs once at the end;
- **`Traceability` lists every `AC` in the spec**, including the ones no step
  covers. A table trimmed to the covered rows asserts the opposite of what it
  found;
- **blocking `[NEEDS CLARIFICATION]` items produced *Out of scope* entries, not
  steps.** A step built on an unresolved blocking question is graded against the
  guess by every pass downstream;
- **`Out of scope`, `Open decisions` and `Execution` are present.** Those three
  are never dropped.

Then hand the user `/sdd-build docs/plans/<name>.md`.

## Not this command's job

Touching the spec. A requirement that is wrong, compound or untestable is a
finding routed to `spec-creator` — never repaired inside a plan step, because a
plan that repairs a requirement forks it where nothing downstream can tell the
forks apart. Writing code. Running the test suites.
