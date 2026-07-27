# reviewer-core specs

One file per unit of work, written before the code: the problem, the intended
behaviour, the contract, and how it will be verified.

Naming: `NN-short-slug.md` (e.g. `01-severity-filter.md`).

A spec that changes prompt assembly or the grounding gate must say what it does
to the two safety invariants (untrusted content stays wrapped; findings without a
real diff citation stay dropped) — those are not negotiable by default.
