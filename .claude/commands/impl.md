---
description: Execute an approved plan, then verify it — code, gates, three parallel reviews
argument-hint: <plan path>
---

# /impl — plan → code, verified

**Plan:** $ARGUMENTS

This command starts at the plan. The two stages before it are run by hand and
deliberately are not commands: `spec-creator` writes the spec, then
`implementation-planner` writes the plan to `docs/plans/`. Both stop to put
questions to a human, and wrapping a stop in a command only makes it easier to
skip. Launch them yourself with the Agent tool.

No plan path, or a path that does not resolve → stop in one line and ask for
`implementation-planner`. Do not reconstruct the plan from the request: an
implementer that plans its own work has re-merged the two roles and lost the
independent check.

## The order

```
implementer (code + tests) → gates.sh --unit → collect-diff.sh
                                     ↓
        architecture-reviewer ∥ security-reviewer ∥ plan-verifier
                                     ↓
                              doc-writer (optional)
```

`gates.sh` costs no model tokens and runs first, so no reviewer spends judgement
on a branch that does not compile. A `FAIL` there, or a `NOT MET` from
`plan-verifier`, goes back to `implementer` and the sequence resumes.

**What that flat fan-out costs, stated rather than assumed.** `plan-verifier`
used to run twice, and the early pass was the rejection point: a `NOT MET` step
surfaced *before* anyone paid for the reviewers. Now it surfaces beside them, so
a change that did not follow its plan is reviewed at full price before anyone
notices. That is a deliberate trade — the early pass only earned its keep when
`test-writer` sat downstream of it, and the three reviewers left are cheaper than
that pass plus a test-writing context — but it is a trade, not a free
simplification. When a plan is large, or when the implementer's report already
reads as shaky, buy the rejection point back: run `plan-verifier` alone first
with **"pass 1 — phases 1 through 4"**, and launch the rest only once it comes
back clean. Doing that puts you back in two-pass mode, so the run is not finished
until a **pass ②** has graded acceptance-criteria coverage — pass ① skips phase 5
by definition, and stopping there leaves every `AC` ungraded while the report
looks complete. Launch pass ② with the other two reviewers, handing it the pass ①
report and `git diff <pass-1-head>..HEAD` so it regrades the delta rather than
the branch.

## 1 — implementer

Launch it with the plan **path** (not its text — it reads the file). Add:

- **"single-agent mode: you write the tests named in the plan's *Traceability*
  table yourself, using those exact names"**. There is no `test-writer` in this
  flow. Those names are the handle `plan-verifier` reaches for, so inventing new
  ones breaks the `AC → step → test` chain.
- **"read skills by the plan's anchor, section only; read a whole `SKILL.md`
  only when the anchor does not resolve or the section does not settle the
  question, and say which in the report"**.
- **"the per-step `Verify` is narrow; the package gate runs once, in phase 3"**.

Read the Implementation Report's *Deviations* and *Failures* sections before
moving on. Those two are the report's reason to exist, and a `PARTIAL` buried
under a summary of successes is the failure the format guards against.

**The cost of no `test-writer` is independence, not coverage.** The context that
wrote the code also writes its tests, which is exactly what the two-agent split
existed to prevent. So read the new tests yourself against one question — *would
this test have failed before the change?* — and treat a test that would not as a
finding for `implementer`, not as coverage.

## 2 — the deterministic gate

```bash
.claude/skills/pr-self-review/scripts/gates.sh --unit
```

Exit `0` continue · `1` back to `implementer`, every FAIL is a blocker · `2`
**not** a pass — a required gate could not run, and that reads as unverified.
`--unit` deliberately excludes `server`'s `*.it.test.ts`; run those only if a
plan step called for them. `implementer` runs this as its own phase 3, so it is
usually already done; re-run it if the report is missing it or you patched
anything after.

## 3 — prepare the diff bundle, once

```bash
.claude/skills/pr-self-review/scripts/collect-diff.sh
```

Save the output and hand the **same** bundle to all three reviewers below. Three
agents each deriving their own change set pay for it three times; measured on an
earlier run, half of ~351 k tokens bought nothing because 25 of 47 files were
re-read byte-identical.

## 4 — the three reviewers, in parallel

Launch all three **in one message**. They run in isolated contexts, so
sequential and parallel cost the same tokens and parallel is faster in wall
clock. Do not merge any of them — their independence is the product.

| Agent | Model | Notes for its prompt |
|---|---|---|
| `architecture-reviewer` | **sonnet** (its frontmatter default) | the bundle, nothing else |
| `security-reviewer` | opus | the bundle, nothing else. It decides for itself whether the diff trips a `routing.md` §3 trigger and **returns one line declining the pass when nothing does** — that line is a result, not a failure |
| `plan-verifier` | opus | the plan path, the bundle, **"single pass — phases 1 through 5, including acceptance-criteria coverage"**, and the expected item count from step 5 below |

`architecture-reviewer` runs on sonnet to save tokens. Its guardrails are what
make that safe rather than cheap: it may not invent a rule this repo has not
stated, it may not report a preference as a finding, and §15's sanctioned
exemptions and known pre-existing violations are never findings. Hold it to
those — a finding that cites no `path:line` and no rule by section number is
noise, and on a smaller model you will see more of it. Discard those; do not
argue with them.

**`plan-verifier` stays on opus, and that is deliberate.** The two downgrades
fail differently: a weaker `architecture-reviewer` produces *noisier* output,
which you notice and discard, while a weaker `plan-verifier` produces a *shorter
enumeration*, which reads exactly like a clean conformance table. Downgrade the
noisy one, keep the silent one.

## 5 — the item-count guard

Before launching `plan-verifier`, count the plan's steps:

```bash
grep -cE '^\*\*S[0-9]+|^### S[0-9]+|^- \[ \] S[0-9]+' <plan path>
```

Pass that number in the prompt — *"the plan has N steps; your conformance table
must have a row for every one"* — and check the returned table against it. A
count of `0` means the plan predates the `S<n>` convention: say so and verify the
row set by hand instead of skipping the check.

This is the guard that makes a silently short enumeration visible, and it is the
one failure `plan-verifier` exists to prevent. It costs one `grep`.

## 6 — doc-writer

**Only after the verdicts, and only if the change needs documenting.** If
anything came back `PARTIAL`, `NOT MET`, `UNCOVERED` or as a **HIGH** security
finding, report that and stop — documenting a change in that state produces
documentation that is wrong on arrival, and a HIGH is normally a return trip to
`implementer` first.

## Report back

One block, in this order: what landed → what did not → what to run next. Include
the conformance counts, the coverage counts, the architectural findings, the
security result — counts, or the line saying nothing triggered — and every open
`[NEEDS CLARIFICATION]` the plan carried forward.

Then give the user the commit message. The convention is in the root
[`AGENTS.md`](../../AGENTS.md) — *Commits*: Conventional Commits, plus `Plan:`
and `Steps:` trailers naming the plan path and the `S<n>` ids this commit
carries. Those trailers are the last link of `AC → step → test → commit`.
**You do not run `git commit` yourself.**

## Not this command's job

**`/pr-self-review` is not run from here.** It is ON DEMAND ONLY and it is the
user's gate — `.claude/hooks/pr-guard.sh` reads its stored verdict
independently, so `git push` and `gh pr create` stay blocked until the user runs
it themselves. Committing, pushing, or opening a pull request. Writing or
amending a spec, or a plan. Running `cd demo && npm run record`, which triggers
a real, paid review run.
