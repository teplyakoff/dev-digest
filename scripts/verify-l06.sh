#!/usr/bin/env bash
#
# verify:l06 — the eval pipeline, in one run.
#
#   bash scripts/verify-l06.sh
#   cd server && pnpm verify:l06      # thin alias, same script
#
# WHY THIS EXISTS
#
# An eval pipeline grades an agent. Nothing grades the grader — so the parts of
# it that are decidable without a model call, without Postgres and without a
# browser are the parts worth pinning, and they are spread across three packages
# by construction: the scorer is pure arithmetic in the engine, the batch's
# aggregates are DTO shaping in the server, and "unknown is not 0%" is only
# actually true once a human sees an em dash. Clicking through the Evals tab to
# check that a null recall did not render as 100% is not verification.
#
# WHY A SHELL SCRIPT AND NOT ONE PACKAGE'S npm SCRIPT
#
# The guarantee spans three packages AND two package managers:
#   reviewer-core/ — **npm**
#   server/        — **pnpm**
#   client/        — **pnpm**
# No single package.json script can reach across that. Picking the wrong manager
# per package is the quiet failure here, so each lane below hard-codes its own.
#
# WHY THESE FOUR LANES — what each proves that the others structurally CANNOT
#
#   1. reviewer-core · test/eval-score.test.ts
#      The scorer: micro-average (not a mean of per-case metrics), the `0/0` →
#      `null` rule as a third value beside 0 and 1, and AC-3's differential —
#      the scorer must reach the SAME overlap verdict as grounding on every
#      range pair. That differential can only be asserted here, because
#      `grounding.ts` lives in the engine and neither the server nor the client
#      imports it. The other three lanes consume the scorer's numbers as already
#      computed and would stay green against a scorer that macro-averaged.
#
#   2. server · test/evals-aggregate.test.ts
#      The same "unknown is not zero" rule one level up: summing case costs
#      across a batch, and the shape of what goes on the wire — the `partial`
#      flag riding on every aggregate response, the snapshot fields the whole
#      comparison rests on, `errored` kept distinct from `failed`. A per-case
#      scorer can be perfect while the batch total reports `0` for an unknown
#      cost. That claim lives entirely in this layer: the engine has no DTO, and
#      the client can only render what this code already decided to send.
#      Hermetic — its DB-backed siblings are `evals-*.it.test.ts` and are
#      deliberately NOT run here (see DB-FREE below).
#
#   3. client · src/components/evals/EvalMetricStrip/EvalMetricStrip.test.tsx
#      The render-side half of the unknown rule. A `null` recall that travels
#      correctly all the way to the browser and then paints `0%` is a wrong
#      number shown to a human, and NO server test can catch it — by then the
#      DTO is already correct. Also the only place the four-tile shape and "no
#      previous batch ⇒ no delta badge at all" are expressible.
#
#   4. client · src/components/evals/RunCompare/RunCompare.test.tsx
#      The only lane whose subject is a RELATION between two runs rather than
#      one run: the four deltas one criterion each, the prompt diff's three
#      states with no blank fourth, the not-comparable flag across differing
#      provider/model, and the absence of any promote-this-version action. That
#      last one is an assertion about something that must NOT be on the screen,
#      which nothing server-side can make.
#
# ONE TEST FILE PER LANE, NOT ONE FEATURE PER LANE
#
# Each filter below resolves to EXACTLY ONE file. Verify with, e.g.
#   cd client && pnpm exec vitest list --filesOnly RunCompare
# The trade-off is real and is accepted on purpose: a lane matching one file
# matches fewer files than a feature-shaped filter would, so a test file added
# later is NOT picked up automatically and must be added to a filter — or given
# its own lane — deliberately. What it buys is that this script can be PROVEN to
# go red: one file to plant a failing `it()` into, one file to restore, one
# `md5` to compare, per lane. A script whose lane silently matched zero files
# would print exactly the same PASS line, and root INSIGHTS.md is blunt about
# it: a verification script that cannot be shown to go red is not evidence.
#
# NEVER ADD `--passWithNoTests`. It is the one flag that would turn the
# zero-match failure back into a silent PASS: without it, a filter that matches
# nothing exits 1 with "No test files found", which is the behaviour this script
# relies on as its second line of defence. (reviewer-core's own `test` script
# does pass that flag — which is exactly why the lane below calls `vitest`
# directly instead of `npm test`.)
#
# DB-FREE ON PURPOSE. No `*.it.test.ts` is reachable from any filter here. The
# positional args to `vitest run` are FILENAME FILTERS, not paths: `evals-aggregate`
# matches test/evals-aggregate.test.ts and cannot match evals-batch.it.test.ts,
# evals-compare.it.test.ts, evals-create.it.test.ts or evals-tenancy.it.test.ts.
# That DB-backed lane already runs elsewhere and costs ~14 s with a warm
# container; this script must stay runnable with Docker stopped, or it stops
# being the thing you run first.
#
# NOT A CI GATE. `.github/workflows/server-unit.yml` already runs every server
# file that is not `*.it.test.ts`, and `client.yml` already runs the client
# ones. A workflow for this script would run the same four files a second time
# and create a second path list to keep in sync. Same posture — and same reason
# — as scripts/verify-l03.sh and scripts/e2e.sh; see their headers.

# NOTE: `-u` and `-o pipefail`, but deliberately NOT `-e`. With `-e` the first
# failing lane aborts the run, so you fix one thing, rerun, and only then
# discover the second — and with four lanes that is four round trips. This
# script's whole job is to show green/red for ALL FOUR lanes, every time. The
# exit status below is still non-zero if any lane failed.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "── verify:l06 · the eval pipeline ──────────────────────────────────"

echo
echo "[1/4] reviewer-core (npm) — the scorer: micro-average, 0/0 → unknown, AC-3 differential"
( cd "$ROOT/reviewer-core" && npm exec -- vitest run eval-score.test )
engine_status=$?

echo
echo "[2/4] server (pnpm) — batch aggregates + wire DTO, hermetic"
( cd "$ROOT/server" && pnpm exec vitest run evals-aggregate )
server_status=$?

echo
echo "[3/4] client (pnpm) — the metric strip: unknown renders as an em dash, never 0%"
( cd "$ROOT/client" && pnpm exec vitest run EvalMetricStrip )
strip_status=$?

echo
echo "[4/4] client (pnpm) — run comparison: deltas, prompt diff, comparability"
( cd "$ROOT/client" && pnpm exec vitest run RunCompare )
compare_status=$?

echo
echo "── result ──────────────────────────────────────────────────────────"
if [[ $engine_status  -eq 0 ]]; then echo "  PASS  reviewer-core  scorer arithmetic"
else                                 echo "  FAIL  reviewer-core  scorer arithmetic"; fi
if [[ $server_status  -eq 0 ]]; then echo "  PASS  server        batch aggregates + DTO"
else                                 echo "  FAIL  server        batch aggregates + DTO"; fi
if [[ $strip_status   -eq 0 ]]; then echo "  PASS  client        metric strip / unknown"
else                                 echo "  FAIL  client        metric strip / unknown"; fi
if [[ $compare_status -eq 0 ]]; then echo "  PASS  client        run comparison"
else                                 echo "  FAIL  client        run comparison"; fi

if [[ $engine_status -ne 0 || $server_status -ne 0 || $strip_status -ne 0 || $compare_status -ne 0 ]]; then
  echo
  echo "verify:l06 FAILED" >&2
  exit 1
fi

echo
echo "verify:l06 PASSED"
