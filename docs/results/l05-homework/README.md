# L05 homework — evidence

**PR Why + Risk Brief**: one structured call turns the intent row, the blast
summary, stored diff stats, the linked issue and the project-context store into
`{ what, why, risk_level, risks[], review_focus[] }` — with every citation
grounded on a real file, the input bounded to 8 000 tokens, and the result
cached on the PR's head sha.

Recorded with `cd demo && npm run record:brief`; `summary.json` is written by
that run and holds the exact brief the frames show, its cost and its assertions.

Spec: [`server/docs/specs/07-pr-brief.md`](../../../server/docs/specs/07-pr-brief.md)
· [`client/docs/specs/07-pr-brief.md`](../../../client/docs/specs/07-pr-brief.md).
Plan: [`docs/plans/L05-pr-brief.md`](../../plans/L05-pr-brief.md).
Cross-model review of that plan: [`plan-cross-model-review.md`](plan-cross-model-review.md).

**This recording spends real money** — two builds, `$0.0089` for the one on
camera. 94 seconds, six frames, one unedited take against
`teplyakoff/dev-digest#1` (92 changed files, indexed, intent already derived).

## Frames

| # | What it shows |
|---|---|
| 01 | Overview with **no brief yet** — a call to action, not an empty box and not an error. The row was deleted before the take so the state is real |
| 02 | One click later: **MEDIUM RISK** as a coloured word, what the PR changes and why in two short paragraphs, then the risks — each with the files it is about, in mono |
| 03 | **Review focus** — five files to read first, each a real button with the reason beside it |
| 04 | Activating the first one lands on **Files changed**, that file's card open, its header and `+75 −0` in frame under the sticky chrome. A path, never a `path:line` |
| 05 | Re-opened: the card is served from the stored row. Nothing on screen distinguishes this from a fresh build — which is why the recorder checks the numbers instead |
| 06 | **Rebuild brief** forces a build on an unchanged head; `derived_at` moves |

## What the recorder ASSERTS, not just films

Three claims survive a plausible-looking regression, so they are checks rather
than scenes. Each one fails the take loudly.

| Claim | How it is checked | This take |
|---|---|---|
| Risks and review focus cite **real** files | the allowlist is rebuilt from this PR's own `GET /pulls/:id/blast` — changed files, symbol files, caller files, endpoint files — and every citation is looked up in it | **12 risk references, 5 focus paths, all inside an allowlist of 108 files** |
| Review focus carries **no line numbers** | every focus path is matched against `:\d+$` | none carry one |
| Re-opening the same PR state spends **nothing** | `GET` after the build must return `reused: true`, `model_calls: 0`, and an unmoved `derived_at` | `model_calls: 0`, `derived_at` unchanged |

A hallucinated path renders exactly like a real one, and a cached card looks
exactly like a rebuilt one. Both are acceptance criteria of this lab, and
neither is visible on camera.

## The number that matters

| | |
|---|---|
| Input | **7 501 tokens**, counted before the call, against a budget of 8 000 |
| Output | 603 tokens |
| Cost | `$0.008882` |
| Repair rounds | `attempts: 1` — the schema came back right the first time |
| Dropped to fit | `context-docs:07-pr-brief.md` |

That last row is the feature's honesty on display. The project-context store
holds one real document — this feature's own spec, 63 KB — and it weighs
**20 584 tokens, two and a half times the entire budget**. So drop level 1 fires,
the whole document is left out, and the brief says so in `dropped_blocks` rather
than quietly truncating it. On this repo the brief is built **without project
context, every time**, and the card names the block it lost.

## What is deliberately NOT here

- **A review running.** The brief takes no findings, no verdict and no score as
  input, and works on a PR with zero runs — that independence is a criterion
  (AC-30, AC-31), so filming a review would show a different feature.
- **Diff hunk bodies.** They never reach the model: the input carries paths and
  `+/−` counts, and the type collecting them has nowhere to put a `patch`.
- **A `path:line` deep link.** Blast line numbers are computed against the
  indexed sha, not the PR head, so a line link verifies by hand on a demo PR and
  lands on the wrong line the moment a file moves. The brief ships paths.

## Reproducing

The recorder needs the dev stack up, the repo indexed, and — for frame 01 — no
brief row on the target PR. Nothing in the product deletes one:

```bash
docker exec devdigest-postgres psql -U devdigest -d devdigest \
  -c "delete from pr_brief where pr_id = '<pr uuid>';"
```

The `risk_brief` feature model defaults to `openai/gpt-4.1`. On an installation
that runs on OpenRouter, point it at the same model through the configured
provider in **Settings → Models** (`feature_models.risk_brief =
{provider: openrouter, model: openai/gpt-4.1}`); otherwise the build fails
loudly with `OPENAI_API_KEY is not configured` — and leaves no partial row,
which is AC-29 doing its job.
