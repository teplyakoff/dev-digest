---
description: Stage 3 of the SDD flow — execute a plan, then verify it in the cheap-rejection order
argument-hint: <plan path>
---

# /sdd-build — plan → code, tests, verdicts

Stage 3 of three. `/sdd-plan` produced the plan this runs.

**Plan:** $ARGUMENTS

No plan path, or a path that does not resolve → stop in one line and ask for
`/sdd-plan`. Do not reconstruct the plan from the request: an implementer that
plans its own work has re-merged the two roles and lost the independent check.

## The order, and why it is not a fan-out

```
implementer → gates.sh --unit → plan-verifier ① → test-writer
                                                      ↓
            architecture-reviewer ∥ security-reviewer ∥ plan-verifier ②
                                                      ↓
                                                  doc-writer
```

Cheapest rejection first. `gates.sh` costs no model tokens; pass ① needs no test
to exist; both run before anything expensive. A `FAIL` or a `NOT MET` goes back
to `implementer` and the sequence resumes from there — do not carry a failing
tree forward into the reviewers.

## 1 — implementer

Launch it with the plan **path** (not its text — it will read the file). Add:

- **"read skills by the plan's anchor, section only; read a whole `SKILL.md`
  only when the anchor does not resolve or the section does not settle the
  question, and say which in the report"**;
- **"the per-step `Verify` is narrow; the package gate runs once, in phase 3"**;
- the plan's execution mode. In **multi-agent** mode, launch the plan's tracks
  per its *Execution* table — parallel tracks must have **disjoint file sets**,
  and a shared file means the tracks are sequential. `implementer` and
  `test-writer` both write, which is what makes that table load-bearing rather
  than decorative.

Read the Implementation Report's *Deviations* and *Failures* sections before
moving on. Those two are the report's reason to exist, and a `PARTIAL` buried
under a summary of successes is the failure the format guards against.

## 2 — the deterministic gate

```bash
.claude/skills/pr-self-review/scripts/gates.sh --unit
```

Exit `0` continue · `1` back to `implementer`, every FAIL is a blocker · `2`
**not** a pass — a required gate could not run, and that reads as INCONCLUSIVE.
`--unit` deliberately excludes `server`'s `*.it.test.ts`; run those only if a
plan step called for them.

`implementer` runs this as its own phase 3, so it is usually already done. Re-run
it yourself if the report is missing it, or if you patched anything after.

## 3 — prepare the diff bundle, once

```bash
.claude/skills/pr-self-review/scripts/collect-diff.sh
```

Save the output and give the **same** bundle to every reviewer below, plus
`git rev-parse HEAD` recorded now as the pass ① head. Two reviewers each
deriving their own change set pay for it twice; measured here, half of ~351 k
tokens once bought nothing because 25 of 47 files were re-read byte-identical.

## 4 — plan-verifier, pass ①

Launch it with the plan path, the bundle, and **"this is pass 1 — phases 1–4
only, defer the acceptance-criteria coverage to pass 2"**. Before the tests
exist, `COVERED` is unreachable and every row would say `CLAIMED`.

**A `NOT MET` or `VIOLATED` row stops the sequence.** Back to `implementer` with
those rows quoted; then re-run from step 2. Finding it here is the whole reason
this pass is early — after `test-writer` and `architecture-reviewer` have run,
the same finding invalidates both.

## 5 — test-writer

Launch it with the behaviours the plan's *Traceability* names, **using the test
names the plan already chose** — those names are the handle `plan-verifier` will
reach for in pass ②, so inventing new ones breaks the chain.

It does not change production code to make a test pass. If it reports that a
behaviour cannot be tested without one, that is a finding for `implementer`, not
something to wave through.

## 6 — architecture-reviewer ∥ security-reviewer ∥ plan-verifier ②

Launch all three **in parallel**, in one message. They run in isolated contexts,
so sequential and parallel cost the same tokens and parallel is faster in wall
clock (measured on two of them: 17 min against 28 min summed). Do not merge any
of them — their independence is the product, and the two that have been measured
returned disjoint finding sets.

Give all three the same prepared bundle from step 3. Then, per agent:

- **`plan-verifier` ②** — **"this is pass 2 — phases 1–5, including
  acceptance-criteria coverage"**, plus **the pass ① report**, so items it
  already graded against untouched files are not regraded from scratch, plus the
  delta range `git diff <pass-1-head>..HEAD`.
- **`security-reviewer`** — the bundle and nothing else. It decides for itself
  whether the diff trips a trigger in `routing.md` §3 or lands in the
  `server-adapters`, `package-config` or `infra` groups, and **returns one line
  declining the pass when nothing does.** That line is a result, not a failure —
  do not re-launch it with an argument for why it should look harder.
- **`architecture-reviewer`** — the bundle and nothing else.

`security-reviewer` reports HIGH and MEDIUM and never LOW. A MEDIUM names exactly
which link in the chain it could not establish, so it is a question for you, not
a blocker — and a HIGH is grounded in a traced path from an attacker-controlled
input, so it is not one you wave through.

## 7 — doc-writer

**Only after the verdicts, never in the fan-out.** Documenting a change that pass
② marks `PARTIAL` produces documentation that is wrong on arrival. If anything
came back `PARTIAL`, `NOT MET`, `UNCOVERED` or as a **HIGH** security finding,
report that to the user and stop — whether to document a change in that state is
their call, and a HIGH is normally a return trip to `implementer` first.

## Report back

One block, in this order: what landed → what did not → what to run next. Include
the conformance counts, the coverage counts, the architectural findings, the
security result — counts, or the line saying nothing triggered — and every open
`[NEEDS CLARIFICATION]` the plan carried forward.

Then tell the user how to commit it. The convention is in the root
[`AGENTS.md`](../../AGENTS.md) — *Commits*: Conventional Commits as usual, plus
`Plan:` and `Steps:` trailers naming the plan path and the `S<n>` ids this commit
carries. Those trailers are the last link of `AC → step → test → commit`, and the
only one a machine can follow after the fact. Give the user the exact trailer
block for what just landed; **you do not run `git commit` yourself.**

## Not this command's job

**`/pr-self-review` is not run from here.** It is ON DEMAND ONLY and it is the
user's gate — `.claude/hooks/pr-guard.sh` reads its stored verdict independently,
so `git push` and `gh pr create` stay blocked until the user runs it themselves.
Committing, pushing, or opening a pull request. Running `cd demo && npm run
record`, which triggers a real, paid review run.
