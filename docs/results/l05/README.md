# L05 lab — evidence

**Project Context**: markdown documents this repo's agents can be given to read
— imported out of the clone, attached to agents and to skills, and folded into a
real review's prompt with the run saying how many it loaded.

Recorded with `cd demo && npm run record:context`; `summary.json` is written by
that run and holds the documents, the counters it asserted and the run's own log
line.

Spec: [`server/docs/specs/06-project-context.md`](../../../server/docs/specs/06-project-context.md)
· [`client/docs/specs/06-project-context.md`](../../../client/docs/specs/06-project-context.md).
Plan: [`docs/plans/L06-project-context.md`](../../plans/L06-project-context.md).

The homework half — the PR Why + Risk Brief card — is a separate take in
[`docs/results/l05-homework/`](../l05-homework/README.md).

**One real review run** on `teplyakoff/dev-digest#4` (7 files) — `$0.0013`.
Everything before it is free: the store makes no model call at all.

## Frames

| # | What it shows |
|---|---|
| 01 | **Project Context** in the sidebar's Workspace section |
| 02 | **Import from repo** — every `.md` file in the project, 194 of them, read out of the clone rather than typed by anyone |
| 03 | Three imported; clicking one shows its text in the panel beside the list |
| 04 | The counter each row carries: **no agents** — nothing reads this document yet |
| 05 | Attached to Security Reviewer → **1 agent**, live, with no reload |
| 06 | And to General Reviewer → **2 agents** |
| 07 | Two more documents go onto the **skill** `secret-handling`; their rows start counting agents nobody attached them to |
| 08 | The run's own log: **`Project context: 3/3 document(s) loaded`**, right under `Loaded 2 skill(s)` |
| 09 | **Prompt assembly** — the three documents by name, with what each one cost |

## What the recorder ASSERTS, not just films

| Claim | This take |
|---|---|
| A fresh document reaches nobody | `0` |
| Attaching to an agent moves the counter | `1` |
| Attaching to a second one moves it again | `2` |
| A document on a **skill** reaches the agents that link it, without being attached to them | true |
| The run loads exactly the three the agent carries | `Project context: 3/3 document(s) loaded` |

The last row is the one the video cannot make on its own. **One document sits on
the agent; two ride along on its skill** — and the number the run reports is
their sum, deduplicated. A counter that only knew about direct attachments would
say `1` here and the run would still load three.

Every take cleans up after itself: the three imported documents and every
attachment are removed in `finally`, including after a failure. Without it a
second take would open with the counters already at `1` and film nothing moving.

## Why the counter counts what it counts

`agents` on a document row is **how many agents would receive it**, not how many
attachment rows point at it: direct attachments, plus agents whose **enabled**
skills carry it, each agent once (SPEC-06 AC-51, AC-52).

Two things fall out of that definition, and both are deliberate:

- **A disabled skill contributes nothing.** `specsForAgent` filters on that flag
  before it reads a single body, so a count that ignored it would promise text
  the run does not send.
- **The number cannot disagree with the run.** It is the same set the prompt's
  `specs` slot is built from, read from the document's side — which is why
  frame 07's counters and frame 08's `3/3` are the same fact seen twice.

## What is deliberately NOT here

- **A Context tab on the agent or skill page.** Attaching is done from the
  document's own page, where the "Attach to" panel lists agents and skills; the
  reverse view was not built.
- **Chunking, embeddings or an index state.** `code_chunks` stays empty — an
  explicit non-goal of SPEC-06, and a status line reporting either would
  advertise a feature nobody wrote.
- **A second agent in the run.** One is enough to show the sum, and each extra
  agent is another billed pass.
