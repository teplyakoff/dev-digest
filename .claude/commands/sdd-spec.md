---
description: Stage 1 of the SDD flow — interrogate a feature request and write its spec
argument-hint: <feature request> [design bundle path]
---

# /sdd-spec — request → spec

Stage 1 of three. `/sdd-plan` and `/sdd-build` follow.

**Request:** $ARGUMENTS

`spec-creator` runs in two passes because a subagent cannot hold a dialogue: it
gets one isolated context and returns one final message. Pass A asks, you answer,
pass B writes. Your job here is to carry the answers — and the pass A report —
across that gap without losing anything.

## Pass A — the question set

Launch `spec-creator` with the request above. Include in the prompt, verbatim:

- the request as the user wrote it, plus any design bundle path they named;
- **"return the question set only — write no file"**;
- **"scope the `INSIGHTS.md` read to the packages you name, never sweep all of
  them"** — an entry from an unrelated package is a constraint that does not
  apply;
- **"fan out `researcher` in parallel, one question per brief, and name the mode
  (REPO or EXTERNAL) in each"** — a brief carrying three questions comes back
  with the first answered well and the rest thin.

If the user already handed you research — a repo map, a verified-facts list, an
external survey — paste it in and add **"do not spawn a researcher; the briefs
below are your research."**

Then **stop.** Present the question set to the user exactly as returned: at most
12 questions, each with its default and its `blocking` / `non-blocking` mark. Do
not answer any of them yourself, do not summarise them into a shorter list, and
do not proceed on "looks fine" — silence is a usable answer only because every
question carries its default, and that only works if the user saw the defaults.

**Keep the whole pass A report.** It is the only carrier to pass B.

## Pass B — the spec

When the answers come back, launch `spec-creator` again with:

1. the answers, mapped to their question numbers;
2. **the complete pass A report, pasted in** — its context is gone, and
   re-deriving the design analysis produces a different one;
3. the request and the design bundle path again.

If the user answered without you having a pass A report, say so and stop. That is
the agent's own phase 0 rule, and reconstructing the findings silently discards
the design work.

## Report back

- the spec path(s) — a cross-package feature is **two files in one pass**, one
  `Spec ID`, and half a spec reads exactly like a whole one;
- the allocated `SPEC-NN` **and the highest seen** — the grep is not an
  allocator and nothing locks it, so this line is what lets a human catch a
  collision at review time;
- every `[NEEDS CLARIFICATION]` still open, blocking ones first — `/sdd-plan`
  will refuse to build steps on those;
- the file size if it passed ~12 KB: specs are re-read into every review as
  `specs` chunks (`reviewer-core/src/prompt.ts:213`), so length is a recurring
  cost, not a one-off.

Then hand the user `/sdd-plan <spec path>`.

## Not this command's job

Approving the spec — `Status:` stays `draft`, and `approved` is a human's word.
Planning, coding, or documenting anything.
