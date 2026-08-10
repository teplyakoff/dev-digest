# 05 — Intent Layer (server)

Owns: the `intent` module — source collection, one cheap classifier call,
server-computed provenance, persistence — plus the executor wiring that derives
once per review trigger and the `derive_intent` trace entry.

Plan: [`docs/plans/L03-intent-layer.md`](../../../docs/plans/L03-intent-layer.md).
Client: [`client/docs/specs/05-intent-layer.md`](../../../client/docs/specs/05-intent-layer.md).
Engine: [`reviewer-core/docs/specs/02-intent-slot.md`](../../../reviewer-core/docs/specs/02-intent-slot.md).

## Problem

The reviewer reads a diff with no idea what the PR was *for*. Every finding is
therefore judged against "is this code good", never against "is this what the
author set out to do" — so a deliberate deferral reads as an omission, and a
pre-existing wart in a touched file reads as this PR's fault.

`pr_intent`, `Intent`, `upsertIntent`/`getIntent`, the `review_intent`
feature-model slot and an `INJECTION_GUARD` that already names "derived
intent/scope" all shipped with the starter. None of it had a caller. This is the
wiring.

### The decision the whole module rests on

**The model proposes; code decides.** The classifier returns exactly four fields
— `{summary, in_scope, out_of_scope, confidence}`. It is never asked where its
answer came from, because a model asked to report its own sources invents one
that sounds right.

`sources[]` and `missing_context[]` are computed by the server from what it
actually managed to collect. A hallucinated source is not merely unlikely, it is
**unrepresentable**: `pipeline/schema.ts` has nowhere to put one. This is the
Conventions Extractor's "no snippet field" trick applied to provenance, and it is
what makes the requirement *"an unreachable link must not be silently replaced by
invention"* a property of the schema rather than a hope about the prompt.

## Schema

One migration, generated with `pnpm db:generate`:

- `0015_intent_layer.sql` — renames `pr_intent.intent` → `summary` and adds ten
  columns plus `pr_intent_confidence_ck`.

Every statement in it is safe **only because the table was empty** (verified:
`select count(*) from pr_intent` = 0 before generating). `head_sha`, `provider`
and `model` are `NOT NULL` with no default, which a populated table could not
accept; `derived_at`'s `now()` is a volatile default on `ADD COLUMN NOT NULL`, so
Postgres rewrites the table — zero rows, zero rewrite.

`confidence` is `text` + CHECK rather than a PG enum, matching
`findings_severity_ck`. **The CHECK and the `IntentConfidence` Zod enum are one
edit in two places.**

No new index: `pr_id` is the primary key and every read is by PR. No
`workspace_id`: the table never had one, so the PR lookup **is** the tenancy
boundary — `IntentService.requirePull` resolves
`reviewRepo.getPull(workspaceId, prId)` before the repository is touched, and
nothing may query `pr_intent` on a bare `prId` from a request.

## Contracts

`vendor/shared/contracts/` (edit the server copy, run
`./scripts/vendor-shared.sh`, commit both):

- `brief.ts` — `Intent.intent` → `Intent.summary`, ending `PrBrief.intent.intent`.
- `review-api.ts` — `IntentConfidence`, `IntentSourceKind`, `IntentSourceStatus`,
  `IntentSource`, the extended `PrIntentRecord`, and `PrIntentView`. Every
  provenance field is on the **record**, never on `Intent` — that is the
  model/server split made structural.
- `trace.ts` — `PromptAssembly.intent`, **nullish**, because every trace
  persisted before L03 has no such key.
- `platform.ts` — `review_intent` defaults to `openrouter` /
  `deepseek/deepseek-v4-flash-0731`.

`contracts/findings.ts` is **not** changed. There is no persisted per-finding
`scope`; see the engine spec.

## API

| Method | Path | Response |
|---|---|---|
| `GET` | `/pulls/:id/intent` | `PrIntentView` — `{intent: null}` before the first derivation |
| `POST` | `/pulls/:id/intent` | `PrIntentView` — re-derive, synchronous, `rateLimit 10/min` |

Synchronous for the reasons `conventions/service.ts` records: bounded input, a
cheap model, its own `timeoutMs`, and one spinner beats a poll loop. A repo with
no clone still derives — it records every `repo_file` as unavailable, which is a
thinner answer rather than a failure, so it is not a 409.

## What the classifier sees

| Source | Cap | On failure |
|---|---|---|
| PR title | — | never fails; the only guaranteed input |
| PR description | 4 000 chars | absent → `pr_body` unavailable + confidence floored |
| Linked issue | 1, title + 2 000 chars | `status:'unavailable'` + a `missing_context` line |
| In-repo plan/spec | 2 files, 20 kB, **8 read attempts** | same |
| Changed files | 60 files, 8 hunk headers each | empty diff → `missing_context` |
| External URLs | — | **recorded, never fetched** |

**Change bodies are never sent.** The model sees paths and hunk *headers*,
rendered from the four integers on `DiffHunk`. Nothing reads `diff.raw`,
`pr_files.patch`, or the contents of `hunk.newLineNumbers`.
`test/intent-prompt.test.ts` asserts that every body line of a fixture diff is
absent from the prompt while every `@@` header is present.

### Path safety, in three layers

`SourceReader.read` already refuses absolute paths, `..` escapes and symlinks out
of the clone. On top of that, because the candidate path is attacker-controlled
PR text and the clone is the **target repo's**:

- an **extension allowlist** — `.md`, `.mdx`, `.txt`, `.rst`;
- a **denylist** — any dot-segment, and `env|secret|credential|token|key|\.pem`;
- a **read-attempt cap** of 8.

Layer two is the one that matters: without it a PR body reading *"see .env for
context"* puts the target repo's secrets into a model request and into the
persisted run trace. `REPO_PATH_PATTERN` deliberately matches bare dotfiles so
the denylist has something to **reject and report** — matching nothing at all
would be safe but silent, and the card could not say the read was refused.

## Confidence, and what it may do

The model reports `confidence`; the server may only lower it. No substantive
source beyond the title → `low`, whatever was claimed. A **material gap** caps a
claimed `high` at `medium`.

The scope filter is armed only when **all three** hold: a substantive source
beyond the title, **no material gap**, and the floored confidence is not `low`.
Thin sources disarm it; no amount of model confidence can arm it. Leaving it off
costs noise, turning it on wrongly costs a suppressed defect.

### What counts as a material gap — and why it is not `missing_context`

A material gap is something the collector **set out to read and could not**:
a `linked_issue` or a `repo_file` with `status: 'unavailable'`. An unfetched
`link` is not one. We never intended to fetch it, and its presence in the prose
says nothing about whether the intent is well grounded.

Both rules originally keyed on `missing_context.length === 0`, which made the
scope filter **dead code**. Measured against three real PRs of this repo: all
three disarmed, and on two of them the only gap was an unfetched link — one being
`https://claude.com/claude-code`, the footer every Claude Code-authored PR
carries. A bound that is always engaged is not a bound, it is an off switch.
After the change the same three PRs discriminate correctly: the one naming a
document it could not read stays disarmed; the two whose only gaps were URLs arm.

`missing_context` itself is unchanged — it is the transparency record the card
renders, and every unfetched link still appears there. It is simply not the right
input to a suppression decision.

**Accepted residual risk:** a spec hosted on an external wiki *is* a real intent
source, and its absence no longer disarms the filter. We cannot distinguish that
link from a footer without fetching it, and fetching is out of scope (SSRF). The
remaining bounds contain the exposure — a substantive source is still required, a
CRITICAL finding always survives, `secret_leak`/`lethal_trifecta` are never
droppable, and every drop is logged.

## Logging

Through the fanned-out `RunLogger`, so every line lands in every queued run's
Live Log and in each run's persisted `run_traces.log`. It logs the
**composition** — kind, ref, size — never content.

```
tool    Deriving PR intent…
info    Intent sources: pr_title · pr-body(340t) · changed-files(420t) — 2 168 tokens est.
info    Intent: 1 source(s) unavailable — link https://wiki.internal/x (external links are not fetched)
tool    INTENT CLASSIFIER model: openrouter/deepseek/deepseek-v4-flash-0731 (cheap pass)
result  Intent derived (confidence=medium, 1 attempt) — 2 in scope, 1 out of scope, …
…
tool    REVIEW model: openrouter/deepseek/deepseek-v4-flash (main pass)
```

**The ROLE labels are load-bearing, not decoration.** The classifier default
differs from the seeded reviewer agents' model by the `-0731` suffix alone, so
two near-identical slugs in a log do not let a reader verify at a glance that the
classifier ran on a separate cheap model — which is on this feature's acceptance
list. The same reasoning puts `cheap classifier` first in the `derive_intent`
tool call's `meta`.

`attempts` is logged because OpenRouter's `strict` enforcement varies by provider
and this call sets no `require_parameters`: a schema miss triggers a silent
second request, and without the count a three-call run reads as a two-call run.

## Wiring

`container.intent` (onion §11 — the executor must not import a sibling module),
and `container.loadPrDiff`, which promotes `modules/reviews/diff-loader.ts` to
the composition root now that a second feature needs a PR's diff.

Derivation sits between the diff load and the agent loop, in its **own**
try/catch — the diff load's catch calls `failAll`, and a review must never fail
because intent derivation failed. One derivation is shared by every agent queued
in the trigger; `deriveIfStale` re-derives only when `head_sha` moved.

`deriveIfStale` returns `{ record, reused }`, not a bare record, and `reused` is
load-bearing rather than informational. The row keeps the tokens and dollars of
whichever run first derived it, so a later run that reuses it would otherwise
publish a `derive_intent` trace entry billing itself for a model call it never
made — and anyone summing that entry across a PR's traces would multiply one
classifier call by the number of reviews. When `reused` is true the entry reads
`reused — billed to an earlier run` and prints no figures. This is the same
"do not bill from this row" rule `INSIGHTS.md` records for cancelled runs.

`loadDiff`'s two row parameters are **structural** (`DiffPullRef`, `RepoRef`),
not ORM rows. They were `typeof repos.$inferSelect` and `PullRow`, which meant a
ring-2 caller reached through `container.loadPrDiff` depended on an ORM row
shape *without importing `db/schema`* — so `eslint.config.js`'s ring-2 ban
structurally could not fire on it. Narrowing restored the rule's reach and
retired the `eslint-disable no-restricted-imports` that file used to carry,
which is exactly what its own standing instruction asked the next person
changing the signature to do.

## Testing

- `test/intent-sources.test.ts` — the denylist, the allowlist, the attempt cap,
  the unfetched link, the confidence floor, the arming rule. No Docker.
- `test/intent-prompt.test.ts` — the "no change bodies" guarantee, made
  mechanical, plus the imported (not copied) `INJECTION_GUARD`.
- `test/intent.it.test.ts` — every column round-trips, provenance is the
  server's, `deriveIfStale` re-derives on a moved head only, cross-workspace
  404s. Docker.

**A trap this change walked into, recorded so the next person does not.**
`reviews.it.test.ts` injected mocks only for the agent's own provider. Once the
review path also resolved `openrouter` (the classifier) and GitHub (the body says
"Closes #471"), the un-injected ports fell through to `server/.env`'s **real
keys** and made live, billed requests on every test in the file — visible only as
a 10 s `waitForPrRuns` timeout, never as an error. `appWith` now injects every
external port, exhaustively rather than minimally.
