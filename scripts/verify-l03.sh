#!/usr/bin/env bash
#
# verify:l03 — Smart Diff classification, in one run.
#
#   bash scripts/verify-l03.sh
#   cd server && pnpm verify:l03      # thin alias, same script
#
# WHY THIS EXISTS
#
# Smart Diff sorts a PR's files into Core logic / Wiring / Boilerplate from path
# patterns alone — no model call, no network, no DB. That makes it the one part
# of the feature that is fully checkable without opening the UI, and clicking
# through PRs to see whether a lock-file landed in Boilerplate is not
# verification.
#
# WHY A SHELL SCRIPT AND NOT ONE PACKAGE'S npm SCRIPT
#
# The guarantee spans two packages on purpose:
#   server/ — which ROLE a path gets, and the ORDER files come back in
#   client/ — which groups start EXPANDED and which start COLLAPSED
# Nothing on the server expresses "Boilerplate is always collapsed": the
# SmartDiff contract has no `collapsed` field and the service returns no
# open/closed state. A script living inside server/package.json could not reach
# that half, and would pass while the most visible acceptance criterion was
# unbuilt.
#
# DB-FREE ON PURPOSE. `smart-diff.it.test.ts` is deliberately NOT run here. This
# must stay runnable with Docker stopped, or it stops being the thing you run
# first.
#
# NOT A CI GATE. `.github/workflows/server-unit.yml` already runs both server
# files (it runs everything that is not `*.it.test.ts`), and `client.yml`
# already runs the viewer test. Adding a workflow for this script would run the
# same three files a second time and create a second path list to keep in sync.
# Same posture as scripts/e2e.sh — see its header.

# NOTE: `-u` and `-o pipefail`, but deliberately NOT `-e`. With `-e` a server
# failure aborts before the client lane runs, so you fix one thing, rerun, and
# only then discover the second. This script's whole job is to show green/red
# for BOTH lanes, every time. The exit status below is still non-zero if either
# lane failed.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "── verify:l03 · Smart Diff classification ──────────────────────────"

# The positional args are vitest FILENAME FILTERS, not paths. `smart-diff-classify`
# matches test/smart-diff-classify.test.ts and does NOT match smart-diff.it.test.ts,
# which is what keeps this lane Docker-free. On the client the same trick avoids
# the literal `[repoId]` in the route path, which is fragile in both the shell and
# the filter; `SmartDiffViewer` is unambiguous and survives a folder move.
echo
echo "[1/2] server — role assignment + group ordering"
( cd "$ROOT/server" && pnpm exec vitest run smart-diff-classify smart-diff-service )
server_status=$?

echo
echo "[2/2] client — group expand/collapse policy"
( cd "$ROOT/client" && pnpm exec vitest run SmartDiffViewer )
client_status=$?

echo
echo "── result ──────────────────────────────────────────────────────────"
if [[ $server_status -eq 0 ]]; then echo "  PASS  server  classification + ordering"
else                                echo "  FAIL  server  classification + ordering"; fi
if [[ $client_status -eq 0 ]]; then echo "  PASS  client  expand/collapse policy"
else                                echo "  FAIL  client  expand/collapse policy"; fi

if [[ $server_status -ne 0 || $client_status -ne 0 ]]; then
  echo
  echo "verify:l03 FAILED" >&2
  exit 1
fi

echo
echo "verify:l03 PASSED"
