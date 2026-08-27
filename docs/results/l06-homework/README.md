# L06 homework — Eval Pipeline (SPEC-08)

Evidence for the eval pipeline: eval cases born from real findings, a batch run
over an agent's whole set, mechanical scoring, and two runs compared prompt
against prompt.

Spec: [`server/docs/specs/08-eval-pipeline.md`](../../../server/docs/specs/08-eval-pipeline.md) ·
[`client/docs/specs/08-eval-pipeline.md`](../../../client/docs/specs/08-eval-pipeline.md) ·
[`reviewer-core/docs/specs/03-eval-scorer.md`](../../../reviewer-core/docs/specs/03-eval-scorer.md)
— three files, one `Spec ID: SPEC-08`.
Plan: [`docs/plans/L06-eval-pipeline.md`](../../plans/L06-eval-pipeline.md).

## The experiment

One variable changed: the agent's system prompt. Same twelve-case set, same
agent, same provider and model (`openrouter` / `deepseek/deepseek-v4-flash`),
so the two batches are comparable by NFR-6 — the batch rows carry that fact
rather than asking a reader to take it on trust.

| | batch A (v1) | batch B (v2) | delta |
|---|---|---|---|
| **recall** | 42.9% | 14.3% | **−28.6 pp** |
| **precision** | 13.0% | 8.3% | **−4.7 pp** |
| **citation accuracy** | 100.0% | 85.7% | **−14.3 pp** |
| cases passed | — | 3 / 12 | |
| cost | $0.00698 | $0.00918 | +$0.00220 |

**The change.** One section of the prompt, the *Quality bar*, gained a hard cap:

```
- **Report at most the THREE most defensible findings in the whole diff.** If a
  reviewer could reasonably disagree that it is a real defect introduced by THIS
  diff, omit it entirely. A short, correct list beats a long one.
```

**The result contradicted the prediction, and that is the point.** The change was
made expecting precision to *rise* — fewer findings, less noise, and five
`must_not_flag` cases punishing exactly that noise. Precision **fell**, along
with recall and citation accuracy. Capping the list did not make the agent more
selective about *which* findings to keep; it made it keep three roughly
arbitrary ones, so it lost the expected findings without shedding the false
positives. An intuition about prompt wording was wrong, and the harness is what
established that rather than an opinion. That is the whole argument for having
one.

The regression banner fired on its own, deterministically and with no model call:

> Regression against the previous batch: recall 42.9% → 14.3% (−28.6 pp);
> precision 13.0% → 8.3% (−4.7 pp).

The agent's prompt was **restored byte-identical** afterwards (it is now v3 with
v1's text). The comparison survives that restore, because a batch stores its own
prompt snapshot — `prompt_diff_available` is still true against v1 → v2. That
immutability is what makes "old prompt vs new" a measurement rather than an
anecdote.

## The gold set

Twelve cases, every one created through the real one-click path
(`POST /findings/:id/eval-case`) from the twelve decided findings on the seeded
`acme/payments-api#482`:

- **7 `must_find`**, from accepted findings — a hardcoded Stripe key, an
  unvalidated `x-forwarded-for`, a skipped webhook signature check, a full
  header set written to the log, an N+1 query, and two unbounded maps.
- **5 `must_not_flag`**, from dismissed findings — hardcoded thresholds, a
  duplicated `preHandler`, an untested 429 branch, an unused export, and an
  undocumented response field.

Both directions are present by construction, which is what lets precision move
at all: a `must_not_flag` case contributes nothing to the recall denominator and
throws every finding it provokes into the precision denominator as a false
positive.

## An accidental proof, worth keeping

The first attempted batch ran against an expired key and every case errored.
The dashboard rendered it correctly, and that is the invariant this whole
feature is organised around:

```
current.recall            null      <- unknown, NOT 0
current.precision         null
current.citation_accuracy null
current.partial           true      <- at least one case errored
delta                     null      <- absence, not "moved by zero"
alert                     ""        <- no regression banner on an unmeasured batch
latest_batch              partial   0 / 12 completed
```

A batch that measured nothing reports **unknown**. Had the `?? 0` coercion
survived anywhere in the chain, that batch would have rendered `0%` recall and
read as a catastrophically broken agent instead of an unmeasured run. It is
still in the run history as the third row, showing em dashes.

Note also that `GET /settings/secrets-status` reported `openrouter: true`
throughout — it checks that a key is *present*, not that it works.

## What is here

| File | What it proves |
|---|---|
| `verify-l06.txt` | **NFR-8.** Four lanes green, and each one *shown to go red* — one planted failure per lane, exactly one FAIL, the other three lanes still running, exit 1, and an md5-verified restore. |

## Still to capture

The screencast and its stills. `cd demo && npm run record:evals` — it prices the
take in its preflight and refuses to open a browser if the API is down or the
case set is empty. `DEMO_EVAL_PROMPT_DROP` names the instruction to remove.

Per [`docs/results/README.md`](../README.md): downscale stills to 1280 px
(`sips -Z 1280`) before committing, and re-recording **replaces** a file rather
than adding a second one.
