# L03 — evidence

The Intent Layer: a cheap classifier pass that derives what a PR is *for*,
persists it, injects it into the reviewer's prompt, and gates a deterministic
scope filter on how well it was sourced.

Recorded with `cd demo && npm run record:intent` against
[`teplyakoff/dev-digest#4`](https://github.com/teplyakoff/dev-digest/pull/4) —
the same contract-break fixture the L02 homework used, so the two labs' evidence
is comparable. `summary.json` is written by that run and holds the exact record,
run ids and costs the frames show.

Plan: [`docs/plans/L03-intent-layer.md`](../../plans/L03-intent-layer.md) ·
specs: [server](../../../server/docs/specs/05-intent-layer.md) ·
[engine](../../../reviewer-core/docs/specs/02-intent-slot.md) ·
[client](../../../client/docs/specs/05-intent-layer.md).

## The video

`devdigest-intent.mp4` — 16 captioned scenes, 5 min 20 s, one unedited take.
Two of those minutes are the two model calls actually running; the classifier
took **133 s** on this take and the Live Log says so on screen. Nothing is cut,
because how long each pass takes is part of what the recording is evidence for.

## The derivation, inside a real review

| Frame | Shows |
|---|---|
| `01-intent-empty` | the card before anything — intent is derived, never assumed |
| `02-live-log-intent-sources` | what the classifier was given: **kind, ref and size**, never content; and the one source it could not fetch |
| `03-live-log-classifier` | `INTENT CLASSIFIER model: …-0731 (cheap pass)` — the role, not just the slug |
| `04-live-log-derived` | scope counts, sources used, **attempts**, tokens and dollars |
| `05-live-log-review-model` | `REVIEW model: …deepseek-v4-flash (main pass)` — the second call, on the agent's own model |

The two slugs differ by the `-0731` suffix alone. That is exactly why every log
line and trace entry names the **role**: without it, *"the classifier runs on a
separate cheap model"* is not checkable at a glance, and it is an item on the
lab's acceptance list.

## The card

| Frame | Shows |
|---|---|
| `06-intent-card` | summary, `IN SCOPE` × 5, `OUT OF SCOPE` empty — the classifier named nothing as deliberately excluded, and the card says that rather than inventing one |
| `07-intent-provenance` | the footer: which model derived it, from which sources — and, in amber, **`Could not be read: the external link https://claude.com/claude-code was not fetched`** |

That amber line is the whole of the requirement *"an unreachable link must not be
silently replaced by invention."* Without it a thin derivation and a
well-sourced one look identical. The recorder **asserts** it: when the record
carries a `missing_context` entry and the card does not render one, the run
fails rather than filming a card that quietly dropped it.

## One derivation per commit

| Frame | Shows |
|---|---|
| `08-live-log-reused` | a second agent triggered on the same head: `reusing the derivation for b6ce1da … no model call, this run is not billed for it` |

## The trace

| Frame | Shows |
|---|---|
| `09-trace-two-calls` | `derive_intent(deepseek/deepseek-v4-flash-0731)` — *cheap classifier · openrouter · 2 630 in / 8 378 out · $0.002714 · confidence=high* — beside `review_file(all files)` |
| `10-trace-prompt-intent` | the `PR intent — derived (dynamic)` block the reviewer actually read: 678 characters of summary and scope lists. No diff, no fetched file content |
| `11-trace-run-log` | the same two passes, persisted — the log survives the run |
| `12-settings-models` | `PR Review · Intent` is a configured feature model, not a hardcoded slug |

The recorder asserts this pair too, and it is the one claim it will fail on: the
trace must carry a `derive_intent` entry whose meta leads with `cheap
classifier`, a `review_file` entry beside it, a classifier slug that is **not**
the reviewing agent's, and a non-null `prompt_assembly.intent`. A regression that
quietly reviewed on the classifier's model would still have filmed a video that
looks right.

## Staleness and re-derivation

| Frame | Shows |
|---|---|
| `13-intent-stale` | **PR #5** — `Derived against an older commit`, with a real `OUT OF SCOPE` list |
| `14-intent-rederived` | `Re-derive` on PR #4 — one classifier call, no review |

`13-intent-stale` is the **only frame not from this take.** Staleness needs a PR
whose head moved after its intent was derived, and only a push does that — a
recorder cannot manufacture one. It was shot on PR #5 during an earlier take of
the same script, before that PR was re-derived; the state it shows is real, not
staged. The current take films the on-demand half instead, and says so in its own
output.

It is worth reading on its own account: on the L03 PR the classifier read the
description and returned an `OUT OF SCOPE` list naming *"pull frequency and
accept rate tiles (deliberately not implemented)"* and *"trace stats join on
skill name (known, accepted limitation)"* — two things the PR deliberately does
not do, which is precisely the distinction a reviewer with no intent cannot make.

## What this take cost

| | |
|---|---|
| classifier (`derive_intent`) | 2 630 in / 8 378 out · **$0.002714** · 133 s · **2 attempts** |
| review (`General Reviewer`) | **$0.000549** · 1 finding · score 65 |
| second trigger (`Security Reviewer`) | derivation **reused** — not billed for it |

**Two attempts, not one.** OpenRouter's `strict` enforcement varies by provider
and this call sets no `provider.require_parameters`, so a schema miss triggers a
silent repair round. Logging `attempts` is what keeps a three-call run from
reading as a two-call run — the risk was named in the plan before it was seen,
and this take is the first recording in which it actually fired. It is also why
the classifier cost more here than the ~$0.0003 the plan budgeted.

## Two things these frames do not flatter

**The first take was thrown away, and the second was reshot.** Take one died on
a 404: its review run was marked `failed` mid-flight, so the recorder asked for a
trace that had not been persisted yet. Take two filmed the Live Log without
scrolling it — `LiveLogStream` is a fixed-height pane that does not follow its
own tail, so three stills captioned `INTENT CLASSIFIER…` and `REVIEW model…` over
a pane still showing `Loading PR diff…`. Both are fixed in `record-intent.ts`:
candidate traces are now fetched and checked rather than picked by status, and
every log line is scrolled into frame before its screenshot.

**Take one's run was killed by the test suite, not by the product.** `buildApp`
runs the orphan-run reaper on construction, and `server/test/routes-smoke.test.ts`
builds the app against the ambient `DATABASE_URL` — so `pnpm exec vitest run`
marked a live, billed review `failed` from another process. The provider answered
three minutes later, the run persisted 3 findings and its trace, and the row still
reads `failed` with a null duration and no error. Reproduced deterministically
afterwards. It is a real foot-gun in the dev loop and is tracked separately from
this branch.
