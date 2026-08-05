# Severity — one scale, and what is allowed to block

The skills speak different languages. `onion-architecture`,
`frontend-architecture` and `react-best-practices` grade CRITICAL/HIGH/MEDIUM.
`security` grades *confidence*, not severity — HIGH there means "I traced the
input and it is attacker-controlled", which is a different claim entirely. The
rest have no scale at all.

Everything is translated into one scale before anything is reported.

## 1. The scale

| Level | Meaning | Effect |
|---|---|---|
| **BLOCKER** | On the closed list in §3. Nothing else may be one | verdict `BLOCKED` |
| **HIGH** | Real, worth fixing before merge, not worth blocking on | verdict `PASS_WITH_NOTES` |
| **MEDIUM** | Worth fixing eventually | reported |
| **NOTE** | Observation, style, taste | reported, capped |

## 2. Translation

| Source | Maps to |
|---|---|
| `onion-architecture` / `frontend-architecture` CRITICAL | BLOCKER *if on the closed list*, else HIGH |
| any skill's HIGH | HIGH |
| any skill's MEDIUM | MEDIUM |
| `security` HIGH confidence (pattern + attacker-controlled input confirmed) | BLOCKER |
| `security` MEDIUM confidence (input source unclear) | HIGH — "verify this by hand" |
| `security` LOW confidence | dropped, per that skill's own rule |
| a skill with no scale — `zod`, `drizzle-orm-patterns`, `fastify-best-practices`, `next-best-practices`, `typescript-expert`, `react-testing-library` | **HIGH ceiling.** These are mechanics references, not gates. They never block |
| a failed gate in `gates.sh` | BLOCKER, always |

## 3. The closed BLOCKER list

Six entries. A finding that is not one of these is not a BLOCKER, no matter how
strongly the pass feels about it. The list is closed so that "what blocks a
merge" is a property of the repo, not of a model's mood on a given run.

1. **A deterministic gate failed** (`gates.sh` exit 1). CI is already red; the
   PR just hasn't been opened yet.
2. **A repo invariant from [AGENTS.md](../../../AGENTS.md) is broken** —
   grounding bypassed · a new review path without `INJECTION_GUARD` · a secret
   reaching the DB or git · an already-applied migration edited · a direct edit
   to `*/src/vendor/**` · `docker compose down -v` added to a script.
3. **`onion-architecture` dependency-rule violation** — ring 0 or 1 importing
   outward, a use case importing a framework, an ORM or an SDK. The part ESLint
   does not already catch.
4. **`reviewer-core` ring-0 impurity** — any I/O in the engine. That package's
   whole contract is being runnable without infrastructure.
5. **`frontend-architecture` CRITICAL placement** — the kind that compounds:
   `'use client'` pushed to a layout root, data access owned by the wrong layer,
   a component that only a route may own placed where every route imports it.
6. **`security` at HIGH confidence** — a vulnerable pattern *and* a traced,
   attacker-controlled input. Both halves, or it is HIGH.

## 4. Grounding — mandatory

The same rule the product itself runs on. A finding must cite `path:line` where
the line is **an added or changed line in this change set**. A finding that
cannot be pinned to one is **dropped**, not downgraded. The verdict is computed
from the survivors only.

This is the one rule that keeps a review pass from drifting into plausible
prose about code nobody touched.

## 5. Pre-existing violations do not block

A finding blocks only if this change set **introduced or extended** it.

- The file already violated the rule and the diff did not make it worse → NOTE,
  section "pre-existing, not introduced here".
- The diff added a second instance of an existing violation → it counts. Two is
  a pattern being established.
- The diff moved violating code without changing it → NOTE.

Same principle as `client/eslint-suppressions.json`: old code is not a blocker,
and new code cannot join it. Without this rule the first PR that touches a
legacy file produces twenty blockers and the gate gets switched off within a
week — which costs more than every bug it would ever have caught.

## 6. Deduplication and caps

`frontend-architecture` and `react-best-practices` will both fire on the same
component; `onion-architecture` and `drizzle-orm-patterns` will both fire on the
same repository. Before reporting:

- **Dedup key** = `path:line` + what the rule is actually about (not its
  wording). Keep the **highest** severity, list every skill that raised it.
- **Caps**: 10 findings per group, 30 per run. BLOCKERs are never capped —
  NOTEs are dropped first, then MEDIUMs, and the report says how many were cut.

A 200-item report is a report nobody reads, which scores the same as no review.

## 7. Verdicts

| Verdict | When |
|---|---|
| `CLEAN` | no findings above NOTE, all gates passed |
| `PASS_WITH_NOTES` | findings exist, none is a BLOCKER |
| `BLOCKED` | ≥ 1 BLOCKER |
| `INCONCLUSIVE` | a required gate could not run (`gates.sh` exit 2), a pass failed or timed out, or the change set exceeded the budget and was not fully split |

**`INCONCLUSIVE` blocks exactly like `BLOCKED`.** A review that did not finish
is not a review that passed, and the cheapest way to defeat any gate is to make
its failure mode look like success.
