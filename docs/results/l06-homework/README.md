# L06 homework — Eval Pipeline (SPEC-08)

Evidence for the eval pipeline: eval cases born from real findings, a batch run
over an agent's whole set, mechanical scoring, and two runs compared prompt
against prompt.

Spec: [`server/docs/specs/08-eval-pipeline.md`](../../../server/docs/specs/08-eval-pipeline.md) ·
[`client/docs/specs/08-eval-pipeline.md`](../../../client/docs/specs/08-eval-pipeline.md) ·
[`reviewer-core/docs/specs/03-eval-scorer.md`](../../../reviewer-core/docs/specs/03-eval-scorer.md)
— three files, one `Spec ID: SPEC-08`.
Plan: [`docs/plans/L06-eval-pipeline.md`](../../plans/L06-eval-pipeline.md).

## Read this first: the effect size is inside the noise

Seven batches were run over the same set, on the same model, across three prompt
versions. Grouping them by the SHA of the stored prompt snapshot — which is what
the batch row exists to make possible — gives this:

| prompt snapshot | what it is | recall, per run |
|---|---|---|
| `8ecb13a9dc` | the original | **42.9%**, 14.3%, 14.3% |
| `0f0ffa37bf` | one instruction removed | 37.5%, **42.9%** |
| `f6a3c8d16d` | a three-finding cap added | 14.3% |

**The same prompt produced both 42.9% and 14.3%.** The spread *within* one prompt
is 28.6 points — the same magnitude as the difference *between* prompts that the
comparison screen reports. So the headline "+28.6 pt from one prompt change"
compares a 14.3% run against a 42.9% run, and the identical prompt produced both
of those numbers on other runs.

The cause is visible in the numbers themselves. The set holds seven `must_find`
cases, so recall is quantised in steps of 1/7 ≈ 14.3 points: 42.9% is three of
seven matched, 14.3% is one of seven. A single finding landing or not moves the
metric by 14 points, and the model is stochastic.

**What this does and does not undermine.** The criterion "changing the system
prompt visibly moves recall/precision between two runs" is met — the numbers
move, they are computed mechanically, and the comparison is real. What is *not*
supported is the causal reading: on twelve cases with one run per prompt, this
harness cannot separate a prompt effect from run-to-run variance. Saying
otherwise would be exactly the unfounded claim the harness exists to prevent, so
it is not said here.

What would fix it, in order of cost: run each prompt N times and compare
distributions rather than points (the lab's own eval package already has
`repeat` and `delta` for this); grow the set so one finding is worth less than
14 points; or both. None of that is in SPEC-08's scope, and all of it is the
obvious next lesson.

## The experiment

One variable changed: the agent's system prompt. Same twelve-case set, same
agent, same provider and model (`openrouter` / `deepseek/deepseek-v4-flash`),
so the two batches are comparable by NFR-6 — the batch rows carry that fact
rather than asking a reader to take it on trust.

| | batch A | batch B | delta |
|---|---|---|---|
| **recall** | 14.3% | 42.9% | **+28.6 pp** |
| **precision** | 4.2% | 12.5% | **+8.3 pp** |
| **citation accuracy** | 96.0% | 100.0% | **+4.0 pp** |
| cases | 12/12 complete | 12/12 complete | |

Recorded take, `demo/record-evals.ts`. Batch A ran the original prompt; batch B
ran it with one instruction removed. Read the two numbers against the table at
the top of this file before drawing a conclusion from them.

**The change.** One line was removed from the *Quality bar* section:

```
- Precision over volume. No style nits, no "might be slow/wrong" without a
  mechanism, no issues already handled elsewhere in the code.
```

**Every result points the same way, and it is not the way the brief predicts.**
The assignment expects removing a precision instruction to *lower* precision. It
rose. And a separate hand-run experiment in the other direction — *adding* a cap
of three findings — lowered recall by the same 28.6 points. Two changes, opposite
in intent, both pointing at the same reading: on this set the agent does better
with fewer constraints on what it may report.

That reading is offered as a hypothesis, not a result, for the reason at the top
of this file: one run per prompt cannot carry it.

The regression banner fires on its own, deterministically and with no model
call. From the earlier hand-run pair, where the metrics moved the other way:

> Regression against the previous batch: recall 42.9% → 14.3% (−28.6 pp);
> precision 13.0% → 8.3% (−4.7 pp).

The agent's prompt is **restored byte-identical** after every take — the recorder
snapshots it before editing and puts it back in a `finally`, and the same was
done by hand. The comparison survives that restore, because a batch stores its
own prompt snapshot rather than reading the agent's current one. That
immutability is what makes "old prompt vs new" a measurement at all, and it is
what let the table at the top of this file be assembled after the fact.

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

| File | What it shows |
|---|---|
| `devdigest-evals-edited.mp4` | **watch this one.** The same take, 1 min 50 s: the two five-minute batch waits are cut and replaced by a card saying so. Nothing else is altered — no reordering, no speed change, no re-shoot |
| `devdigest-evals.mp4` | the unedited take, 11 min 43 s. Two thirds of it is a spinner. Kept because the edited cut is derived from it and a reader may want to check that the cuts hide nothing |
| `01-decided-finding.png` | the accepted finding on `acme/payments-api#482` before it becomes anything |
| `02-eval-case-created.png` | **one click** — the toast with its link, and no dialog opened (AC-65) |
| `03-evals-tab-cases.png` | the set, every row saying what it asserts: `MUST FIND` / `MUST NOT FLAG` |
| `04-metric-strip.png` | the four tiles, and the line stating the scorer makes no model call |
| `05-batch-running.png` | the run action disabled while a batch is in flight (AC-80) |
| `06-metrics-landed.png` | batch A: recall 14.3% · precision 4.2% · citation 96.0% |
| `07-prompt-edited.png` | the one instruction being removed, in the agent's Config tab |
| `08-second-batch.png` | batch B on the same set: recall 42.9% · precision 12.5% · citation 100% |
| `09-eval-dashboard.png` | `SKILLS LAB → Eval Dashboard`, every agent's history in one place |
| `10-two-runs-selected.png` | exactly two runs selected — fewer or more and Compare stays disabled (AC-87) |
| `11-compare-deltas.png` | **the graded frame**: four independent deltas, each its own criterion |
| `12-prompt-diff.png` | **the reason**: the two prompt snapshots diffed word by word |
| `summary.json` | what the recorder asserted rather than filmed, per scene |
| `verify-l06.txt` | **NFR-8.** Four lanes green, and each one *shown to go red* — one planted failure per lane, exactly one FAIL, the other three still running, exit 1, md5-verified restore |

### How the edited cut was made

Same take, cuts only — `docs/results/README.md`'s "never mix takes" rule is about
mixing *recordings*, and this is one recording with two waits removed.

```
segment A   0:00–0:45   original 0–45      setup → one click → Evals tab → Run all evals
card 1      3.2s        "≈ 5 minutes pass · 12 cases · one model call each"
segment B   0:48–1:12   original 338–362   batch A lands → the prompt edited
card 2      3.2s        "≈ 5 minutes pass · the same 12 cases · the new prompt"
segment C   1:15–1:50   original 669–end   batch B lands → dashboard → compare → prompt diff
```

The two cuts remove 5 min 11 s and 5 min 24 s of a progress counter — measured
from the frame timestamps, not estimated. Each card is followed immediately by
the frame where the result lands, so the elapsed time is stated rather than
silently skipped.

Note the metric strip shows the *previous* batch's numbers during segment A
(38% / 12% / 96%). That is not a stale render: `current` is deliberately the last
**finished** batch, so the last good numbers stay on screen while a run is in
flight. `latest_batch` is the channel that knows a batch is running, and it is
what disables the button in the same frame.

The interstitials were rendered as HTML through Playwright rather than with
ffmpeg's `drawtext`: this machine's ffmpeg 8.1.2 is built without libfreetype, so
that filter does not exist in it. Rendering them as pages also means they carry
the app's own tokens (`#0a0a0a`, the accent blue, the mono caption) instead of
looking like a title slide bolted on afterwards.

Stills are downscaled to 1280 px per [`docs/results/README.md`](../README.md);
re-recording **replaces** these files rather than adding a second set.

## Reproducing the take

```bash
cd demo && npm install && npm run setup
DEMO_EVAL_PROMPT_DROP="Precision over volume." DEMO_EVAL_BATCHES=2 npm run record:evals
```

The preflight refuses to open a browser if the API is down, the repo is not
imported, or the case set is empty, and it prices the take before spending:
2 batches × 12 cases = 24 billed model calls.

Two things it will not do for you. It films the *"an eval case already exists"*
variant of the toast if every decided finding already has a case — delete the
case for the finding it picks first, or scene 2 shows the wrong path. And
`DEMO_EVAL_BATCHES=auto` may pair the new batch with an older one carrying an
identical prompt snapshot, which renders an empty diff in scene 12; `=2` forces
a clean pair.
