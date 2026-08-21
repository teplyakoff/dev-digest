---
name: acceptance-criteria
description: "One definition of a well-formed acceptance criterion, shared by every agent that writes, reviews or grades one. Covers the five EARS patterns and their Ukrainian keywords, the six quality tests a criterion has to survive, how AC-N and NFR-N are numbered, and the four verification kinds a criterion can be bound to. Use when writing acceptance criteria into a DevDigest spec, when reviewing requirements before planning against them, or when grading coverage after the code lands. Does NOT cover where a spec file goes, what sections it carries, or how a plan is structured — those belong to spec-creator, implementation-planner and plan-verifier respectively."
---

# acceptance-criteria

Three agents touch a criterion and none of them owns it. `spec-creator` writes
it, `implementation-planner` reviews it before planning against it, and
`plan-verifier` grades whether it was met. When each carries its own wording of
"well-formed", the three drift, and the drift shows up as an argument about
whether something passed.

This file is the single wording. Read it by path — none of the three agents has
the `Skill` tool, and all three have `Read`.

## A criterion is one testable thing

Six tests. A criterion that fails any of them is not ready to be planned against.

| Test | Fails when | The tell |
|---|---|---|
| **Atomic** | it carries two behaviours | the word "and" joining two verbs; a verdict that would have to be "half met" |
| **Testable** | no observable condition | nothing could be written that fails; "works well", "is fast", "is intuitive" |
| **Behavioural** | it describes implementation | a file path, a function name, a component name inside the criterion |
| **Consistent** | another criterion contradicts it | two criteria that cannot both hold in the same state |
| **Attributable** | nobody can satisfy it here | it needs a module, an input or a permission this repo does not have |
| **Bounded** | its cost is invisible | it silently implies a model call, a migration or a new external input |

"Atomic" is the load-bearing one. `implementation-planner` binds one step per
criterion and `plan-verifier` writes one verdict per criterion, so a criterion
covering three behaviours has nowhere to put two-thirds of its result.

## EARS — the five patterns

*Easy Approach to Requirements Syntax* (Mavin, Wilkinson, Harwood, Novak,
IEEE RE'09, 2009). Its whole job is separating the **condition** from the
**system's reaction** so that both are visible and neither is assumed.

DevDigest spec bodies are Ukrainian, so the keywords are Ukrainian and the modal
is `повинна`.

| Pattern | When it applies | Shape |
|---|---|---|
| **Ubiquitous** | always true, no trigger | Система повинна … |
| **Event-driven** | a discrete trigger | **КОЛИ** ‹подія›, система повинна … |
| **State-driven** | true for the duration of a state | **ПОКИ** ‹стан›, система повинна … |
| **Unwanted behaviour** | an undesirable condition | **ЯКЩО** ‹умова›, **ТОДІ** система повинна … |
| **Optional feature** | only when something is enabled | **ДЕ** ‹опція ввімкнена›, система повинна … |

```
AC-1  Система повинна журналювати кожну спробу автентифікації.
AC-2  КОЛИ користувач надсилає форму входу, система повинна перевірити облікові дані.
AC-3  ПОКИ триває синхронізація, система повинна показувати прогрес.
AC-4  ЯКЩО перевірка тричі не вдалася за 60 секунд, ТОДІ система повинна
      тимчасово заблокувати обліковий запис.
AC-5  ДЕ ввімкнено MFA, система повинна вимагати TOTP-код після пароля.
```

**Picking the pattern is itself a check.** A requirement that fits none of the
five is usually not a requirement yet — it is a goal, a preference, or two
requirements wearing one sentence. Unwanted-behaviour is the pattern most often
missing: a spec with five event-driven criteria and no `ЯКЩО` has almost
certainly not been asked what happens when things fail.

## Numbering

- `AC-1`, `AC-2`, … — functional criteria, numbered within one spec.
- `NFR-1`, `NFR-2`, … — non-functional requirements, numbered separately in the
  same spec, so traceability can reference either.
- Ids are **stable once written**. A criterion that turns out wrong is superseded
  by a new id, never renumbered — plans, tests and conformance tables already
  point at the old one.
- Nobody but the spec renumbers. A plan or a review that finds a criterion
  malformed reports it and routes it back; it never edits the list.

## Non-functional requirements need a threshold

An `NFR` without a number nobody can fail is decoration. Each one states the
category, the threshold and how it would be observed:

- **performance** — a unit and a figure: kB of First Load JS, ms at p95, rows
  before pagination degrades.
- **security** — what is rejected, what is never persisted, what is wrapped.
  A rule, not an aspiration.
- **accessibility** — the interaction that must work without a mouse, the state
  a screen reader must be able to observe.
- **observability** — the event that must be recorded and the field that makes it
  findable afterwards.

## Verification kinds

Every `AC` and `NFR` is bound to exactly one of four, and to a test name that
acts as a handle for whoever writes it later:

| Kind | Means | Naming |
|---|---|---|
| **unit** | pure, no database, no network | a plain `*.test.ts` |
| **integration** | database-backed | **`*.it.test.ts` — mandatory**, the CI suite split keys on the filename |
| **e2e** | a browser journey | `e2e/specs/NN-name.flow.json`, globbed by the runner |
| **manual** | no automated check exists | say so with a reason; never leave the cell blank |

`manual` is a decision and reads as one. A blank cell reads as an oversight, and
the two must not look alike. The test name is a handle, not a promise that the
test exists.

## What this file is not

It does not say where a spec lives, what sections it carries, how a plan is
structured, or what verdict vocabulary a conformance table uses. Those belong to
`spec-creator`, `implementation-planner` and `plan-verifier`, each in its own
file.
