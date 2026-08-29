# Retro report format

One report per run. Short, measured, and every section actionable. If a section
has nothing in it, write one line saying so — an absent section reads as an
oversight, a stated "nothing here" reads as a check that ran.

## 1. Shape of the run

Two or three sentences: how many agents, in what topology (pipeline, fan-out,
fan-out-then-join, nested), and what the run produced. Name the topology
explicitly — most runs that feel parallel are not.

## 2. Cost

Straight from the collector. Report **output tokens** as the work measure and
**cache read** as the context measure; do not sum `input_tokens` and call it
context — it is per-call billing.

| | value |
|---|---|
| Agents | n |
| Output tokens, total | n |
| Subagent share of output | % |
| Active time | m |
| Largest single agent | name, tokens, % of total |

One line on whether the spend went where the value was. An agent holding 40 % of
the output for a report nobody used is the finding.

## 3. Order and concurrency

The launch table, then one line of judgement: what genuinely overlapped, what
only looked concurrent, and what could have overlapped but did not because it
was launched too late or blocked on a barrier that was not needed.

## 4. Per-agent, four columns

| agent | hard | easy | missed |
|---|---|---|---|

Each cell grounded — a tool call, a quote, a `path:line`. "Struggled with the
schema" is not a cell; "seven greps for the tokenizer before finding it at
`adapters/tokenizer/index.ts:31`" is.

## 5. Duplication

The collector's file list, plus duplication it cannot see: two agents reaching
the same conclusion independently, a parent re-deriving a child's answer, a
question the user answered twice. For each, name what should have been passed
down instead.

## 6. Failures, refusals and gaps

Every errored tool call, every "could not establish", every fact that arrived
from outside the run — from the user, from a later agent, from a verifier. This
section is the highest-yield one and the easiest to leave empty out of politeness.

## 7. Changes for next time

Ranked, each naming a file or a launch decision:

1. **Brief changes** — `.claude/agents/<name>.md`, the sentence to add.
2. **Orchestration changes** — which agents, in what order, handed what up front.
3. **Tooling changes** — a tool that was missing, refused, or reached for and
   absent.

Anything that cannot be phrased as one of those three is an observation, not a
recommendation, and belongs in the prose above or nowhere.

## 8. Handoff

One line per destination: what went to `engineering-insights`, what became a
brief edit, what stays as a note.

## 9. Ledger row

Only when the report is written to a file (Phase 3). Append one row to
`docs/results/ledger.md`, built from the same numbers as section 2 and 6 above
— never re-typed from memory:

| Date | Lab/run | Session | Topology | Agents | Output tokens | Subagent share | Active time | Failures/gaps | Report |
|---|---|---|---|---|---|---|---|---|---|

- **Date** — the date the retro was run, `YYYY-MM-DD`.
- **Lab/run** — the `<lab>` segment of the report path.
- **Session** — the `<session-short>` segment of the report path.
- **Topology** — from section 1.
- **Agents / Output tokens / Subagent share / Active time** — straight from the
  section 2 table.
- **Failures/gaps** — the count of items listed in section 6.
- **Report** — a relative link to the file just written, e.g.
  `[l06/workflow-retro-a1b2c3.md](l06/workflow-retro-a1b2c3.md)`.

If `docs/results/ledger.md` does not exist yet, create it with the header row
above before appending.
