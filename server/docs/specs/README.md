# server specs

One file per unit of work, written before the code: the problem, the intended
behaviour, the contract, and how it will be verified.

Naming: `NN-short-slug.md` (e.g. `01-run-cost-badge.md`).

From L05 these files also become review context — the reviewer feeds them into
the prompt's `specs` slot — so write them for a reader who has not seen the
conversation that produced them.

## The shape of a new spec

New specs are written by the `spec-creator` subagent, before the code, against a
fixed template: problem and user · goals/non-goals · user stories · acceptance
criteria in EARS (`AC-1`, `AC-2`, …) · edge cases · design coverage and gaps ·
UX proposals · non-functional requirements · inputs and provenance · untrusted
inputs · open questions. The full contract is
[`.claude/agents/spec-creator.md`](../../../.claude/agents/spec-creator.md).

Two identities, and they are not the same number. The **filename** prefix `NN`
orders files inside this folder. The **`Spec ID: SPEC-NN`** in the header is
repo-global — the two halves of a feature that spans `client/` and `server/`
share one ID and cross-link. Files `01`–`05` predate the header and hold
`SPEC-01`…`SPEC-05` retroactively, so the first written one is `SPEC-06`.

Body language is Ukrainian, section headings as in the template, EARS keywords
`КОЛИ` / `ПОКИ` / `ЯКЩО … ТОДІ` / `ДЕ`. An unanswered question stays in the file
as `[NEEDS CLARIFICATION]` with the default that was used — it is never quietly
decided.
