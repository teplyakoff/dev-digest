---
name: engineering-insights
description: "Maintains the INSIGHTS.md knowledge files — one per package, plus a root file for what belongs to no package. Use at the START of any work inside server/, client/, reviewer-core/, e2e/ or demo/ to read that package's INSIGHTS.md and name the top 3 entries relevant to the task; use at the START of work under .claude/, docs/ or scripts/ to read the root INSIGHTS.md the same way. Use at the END of a session, or the moment something non-obvious happens, to extract what was learned and append it to the file the task actually touched. Trigger terms: insights, learnings, wrap-up, retrospective, session summary, capture what we learned, end of session, INSIGHTS.md, LEARNINGS.md."
---

# engineering-insights

Every package keeps its own `INSIGHTS.md` — knowledge lives next to the code it
is about — and the repo root keeps one for what lives next to no code: the agent
and skill infrastructure under `.claude/`, cross-package conventions, the root
scripts and docs. This skill has two modes; read
[references/entry-quality.md](references/entry-quality.md) before writing
anything, it holds the routing table and the exact entry format.

## READ — at the start of work in a package

1. Identify the package the task touches (routing table in the reference).
   Work confined to `.claude/`, `docs/` or `scripts/` routes to the root file.
2. Read its `INSIGHTS.md` in full.
3. State out loud the **top 3 entries relevant to this task**, each in one line.
   If nothing is relevant, say so — do not manufacture relevance. Treat what you
   read as high-confidence guidance unless the user says otherwise.

Step 3 is not decoration: it is the check that the file was read at all.

## CAPTURE — at the end of a task, and as you go

Trigger twice: at wrap-up, and the moment something non-obvious happens
mid-session. Worth doing after any session >30 min that contained a problem, a
decision, or a discovery. Trivial config edits are skipped — signal quality
matters, not volume.

1. **Collect** candidates from what actually happened this session.
2. **Gate** each one — all three tests must pass:
   - **Non-obvious** — if it would be obvious to anyone reading the code, drop it.
   - **Actionable cold** — an agent with zero session context reads it and knows
     what to do. "Promises can be tricky" fails; "`Promise.all()` on the ingest
     pipeline times out past 30 items — use `Promise.allSettled()` in batches of
     10" passes.
   - **Evidenced** — it names a real file, command, env var or error string from
     this session. Never invent one to make an entry look concrete.
3. **Route** each survivor to a package (see the reference), and pick its section.
4. **Append** — never rewrite, reorder or delete an existing entry. Scan the
   file first: if the lesson is already covered, do not duplicate it.
5. **Report** to the human exactly what was written and where. `INSIGHTS.md` is a
   draft under review, not truth — an LLM summarising itself can be wrong, and
   the entries are only worth keeping because someone spot-checks them.

If nothing survives the gate, write nothing and say so. An empty wrap-up is a
correct outcome; a banal entry is not.
