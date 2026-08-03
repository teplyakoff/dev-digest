#!/usr/bin/env bash
#
# Phase 2 of pr-self-review: the deterministic gates. No model, no judgement —
# every FAIL here is a fact, and every one of them is a BLOCKER.
#
#   gates.sh                 # greps + lint + typecheck on touched packages
#   gates.sh --fast          # greps only (no install needed)
#   gates.sh --full          # + vitest on touched packages
#   gates.sh --only server   # restrict to one package
#
# Exit codes
#   0  every gate passed
#   1  at least one FAIL          → BLOCKED
#   2  a required gate could not run → INCONCLUSIVE
#
# 2 exists because of the failure mode that makes gates worthless: a gate that
# could not run is not a gate that passed. Missing node_modules must not read as
# a clean bill of health, so it gets its own exit code and the skill maps it to
# INCONCLUSIVE, which blocks exactly like BLOCKED does.
#
# Precision over recall, deliberately. Anything that needs "well, it depends" —
# generic hardcoded-secret heuristics, naming, dead code — belongs in the model
# passes, where a human-readable justification comes with it. A false FAIL here
# is worse than a miss: it teaches people to pass --accept-risk reflexively.

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
cd "$(psr_root)"

MODE=normal
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) MODE=fast ;;
    --full) MODE=full ;;
    --only) ONLY="${2:-}"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

BASE=$(psr_base)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
LOGDIR=.devdigest/pr-self-review/logs

FAILED=0
UNKNOWN=0

gate() { # name status detail
  printf 'GATE  %-24s %-7s %s\n' "$1" "$2" "${3:-}"
  case "$2" in
    FAIL) FAILED=$((FAILED + 1)) ;;
    UNKNOWN) UNKNOWN=$((UNKNOWN + 1)) ;;
  esac
}

# ---------------------------------------------------------------- change set

# Package names never contain spaces, so an unquoted pathspec is safe here and
# keeps every git call below readable.
PATHSPEC=""
[ -n "$ONLY" ] && PATHSPEC="-- $ONLY"

{
  git diff --name-only "$BASE" $PATHSPEC
  git ls-files -o --exclude-standard $PATHSPEC
} 2> /dev/null | grep -vE "$PSR_EXCLUDE" | sort -u > "$TMP/changed"

touched() { grep -qE "$1" "$TMP/changed"; }

if [ ! -s "$TMP/changed" ]; then
  echo "GATE  (change set)          SKIP    nothing to gate"
  exit 0
fi

# Every added line, tagged with the file it landed in. One `git diff` pass plus
# the untracked files, which no diff can see.
{
  git diff -U0 "$BASE" $PATHSPEC | awk '
    /^\+\+\+ b\// { p = substr($0, 7); next }
    /^\+\+\+ /    { p = "";            next }
    /^\+/         { if (p != "") print p "\t" substr($0, 2) }
  '
  git ls-files -o --exclude-standard $PATHSPEC | while IFS= read -r f; do
    [ -f "$f" ] || continue
    [ "$(wc -c < "$f" | tr -d ' ')" -gt 512000 ] && continue
    grep -Iq . "$f" 2> /dev/null || continue # binary
    awk -v p="$f" '{print p "\t" $0}' "$f"
  done
} 2> /dev/null | grep -vE "$PSR_EXCLUDE" > "$TMP/added" || true

# Lines are `path<TAB>content`, so patterns may anchor on the path with ^.
#
# Two traps, both silent — the pattern simply never matches and the gate reports
# a cheerful PASS:
#   * never add -n; the line-number prefix breaks every ^ anchor
#   * never write \t in a pattern; BSD grep -E reads it as a literal `t`, so the
#     separator has to be a real tab, hence $TAB
TAB=$(printf '\t')
added_hits() { grep -E "$1" "$TMP/added" | grep -vE "${2:-^$}" | head -5; }

# ------------------------------------------------------------------- secrets
# Provider-prefixed patterns only. These have no legitimate reason to appear in
# a diff, which is what makes them safe to block on. AGENTS.md: secrets live in
# ~/.devdigest/secrets.json and never touch the DB or git.

SECRETS='sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
if hits=$(added_hits "$SECRETS") && [ -n "$hits" ]; then
  gate secrets FAIL "credential material in the diff"
  echo "$hits" | sed 's/^/        /'
else
  gate secrets PASS
fi

if touched '(^|/)\.env(\.|$)|(^|/)secrets\.json$' && ! touched '\.env\.example$'; then
  gate secret-files FAIL "$(grep -E '(^|/)\.env(\.|$)|(^|/)secrets\.json$' "$TMP/changed" | tr '\n' ' ')"
else
  gate secret-files PASS
fi

# ------------------------------------------------------------- package hygiene
# Five packages, two managers (AGENTS.md layout table). Running the wrong one
# writes a second lockfile that nothing installs from and CI never sees.

WRONG_LOCK=""
for p in server client; do
  [ -f "$p/package-lock.json" ] && WRONG_LOCK="$WRONG_LOCK $p/package-lock.json(npm in a pnpm package)"
done
for p in reviewer-core e2e demo; do
  [ -f "$p/pnpm-lock.yaml" ] && WRONG_LOCK="$WRONG_LOCK $p/pnpm-lock.yaml(pnpm in an npm package)"
done
[ -n "$(git ls-files '*yarn.lock')" ] && WRONG_LOCK="$WRONG_LOCK yarn.lock"
if [ -n "$WRONG_LOCK" ]; then
  gate package-manager FAIL "$WRONG_LOCK"
else
  gate package-manager PASS
fi

LOCK_DRIFT=""
for p in server client reviewer-core e2e demo; do
  touched "^$p/package\.json$" || continue
  # A dependency edit looks like a version-ish value. `version`, `engines` and
  # `packageManager` change without touching the lockfile, so they are exempt.
  git diff -U0 "$BASE" -- "$p/package.json" \
    | grep -E '^[+-] *"' \
    | grep -vE '"(version|engines|packageManager|name|description|scripts)"' \
    | grep -qE '": *"[\^~>=<]?[0-9]' || continue
  lock=$([ "$(psr_pm "$p")" = pnpm ] && echo "$p/pnpm-lock.yaml" || echo "$p/package-lock.json")
  touched "^$lock$" || LOCK_DRIFT="$LOCK_DRIFT $lock"
done
if [ -n "$LOCK_DRIFT" ]; then
  gate lockfile-sync FAIL "deps changed, lockfile did not:$LOCK_DRIFT"
else
  gate lockfile-sync PASS
fi

# ------------------------------------------------------------ debug leftovers
# Source trees only. seed.ts, migrate.ts, scripts/ and demo/ are CLIs — console
# output is their job.

DEBUG='console\.(log|debug)\(|debugger;|(it|test|describe)\.only\(|fdescribe\(|xit\(|\.skip\('
if hits=$(added_hits "^(server|client|reviewer-core)/src/[^$TAB]*$TAB.*($DEBUG)" "/(seed|migrate)\.ts$TAB") && [ -n "$hits" ]; then
  gate debug-leftovers FAIL "console/debugger/only/skip in shipped source"
  echo "$hits" | sed 's/^/        /'
else
  gate debug-leftovers PASS
fi

# Executable surfaces only. The same string in AGENTS.md is the rule being
# documented, and in this directory it is the rule being implemented — a scanner
# that flags its own pattern and the docs describing it is a scanner nobody
# keeps.
DESTRUCTIVE="^[^$TAB]*(\.(sh|ya?ml)|package\.json|Makefile)$TAB.*docker[ -]compose +down +.*-v"
if hits=$(added_hits "$DESTRUCTIVE" '^\.claude/skills/pr-self-review/') && [ -n "$hits" ]; then
  gate destructive-commands FAIL "'docker compose down -v' drops devdigest_pgdata"
  echo "$hits" | sed 's/^/        /'
else
  gate destructive-commands PASS
fi

# ------------------------------------------------------------------- commits

BAD_SUBJECTS=$(git log --no-merges --format=%s "$BASE"..HEAD \
  | grep -vE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: .{3,}$' || true)
WIP=$(git log --no-merges --format=%s "$BASE"..HEAD | grep -iE '^(wip|fixup!|squash!)' || true)
if [ -n "$BAD_SUBJECTS$WIP" ]; then
  gate commit-subjects FAIL "not conventional / WIP"
  printf '%s\n' "$BAD_SUBJECTS$WIP" | sed 's/^/        /'
else
  gate commit-subjects PASS
fi

# ------------------------------------------------------- vendored contracts
# Direction is not negotiable: server is the source, client is the copy. An
# edit to the copy is silently lost on the next re-vendor — see
# scripts/vendor-shared.sh.

# The legitimate flow touches BOTH copies — edit the server, re-vendor, commit
# the pair — so "the client copy changed" is not by itself a violation. Drift is
# the only observable one, and it catches editing the copy alone, because then
# the two cannot match.
if touched 'src/vendor/shared/'; then
  if ./scripts/vendor-shared.sh --check > "$TMP/vendor.log" 2>&1; then
    gate vendor-sync PASS
  elif touched '^client/src/vendor/' && ! touched '^server/src/vendor/'; then
    gate vendor-sync FAIL "only the client copy changed — edit server/src/vendor/shared, then ./scripts/vendor-shared.sh"
  else
    gate vendor-sync FAIL "copies differ — ./scripts/vendor-shared.sh && commit both"
  fi
else
  gate vendor-sync PASS "not touched"
fi

# --------------------------------------------------------------- agents docs
# A CLAUDE.md committed as a regular file silently unloads every instruction in
# the repo — the guard the agents-md workflow exists for, run locally.

SYMLINK_BAD=""
while IFS= read -r f; do
  case "$f" in
    *CLAUDE.md)
      mode=$(git ls-files -s -- "$f" | awk '{print $1}')
      [ "$mode" = "120000" ] || SYMLINK_BAD="$SYMLINK_BAD $f($mode)"
      ;;
  esac
done < "$TMP/changed"
if [ -n "$SYMLINK_BAD" ]; then
  gate agents-symlinks FAIL "committed as a regular file:$SYMLINK_BAD"
else
  gate agents-symlinks PASS
fi

# ---------------------------------------------------------------- migrations

# `.sql` only. Drizzle rewrites migrations/meta/_journal.json on every
# `db:generate` — that file changing is what adding a migration looks like.
MIG=server/src/db/migrations
REWRITTEN=$(git diff --name-status "$BASE" -- "$MIG" | grep '\.sql$' | grep -vE '^A' | awk '{print $2}' || true)
if [ -n "$REWRITTEN" ]; then
  gate migrations-immutable FAIL "already-applied migration modified: $(echo "$REWRITTEN" | tr '\n' ' ')"
else
  gate migrations-immutable PASS
fi

NEW_MIG=$({ git diff --name-status "$BASE" -- "$MIG" | grep -E '^A' | awk '{print $2}'; git ls-files -o --exclude-standard -- "$MIG"; } 2> /dev/null | grep '\.sql$' || true)
if touched '^server/src/db/schema' && [ -z "$NEW_MIG" ]; then
  gate schema-has-migration FAIL "schema changed with no new migration — pnpm db:generate"
else
  gate schema-has-migration PASS
fi

# ------------------------------------------------------------ lint, typecheck
# These mirror the CI lanes one-for-one (.github/workflows/lint.yml). A FAIL
# here is a red X on the PR that has not happened yet.

pkg_script() { # package script label
  p=$1
  script=$2
  label=$3
  touched "^$p/" || { gate "$label" SKIP "not touched"; return; }
  if [ ! -d "$p/node_modules" ]; then
    # e2e and demo are the "light" groups in routing.md — they cannot produce a
    # blocker, so their missing deps must not produce an INCONCLUSIVE either.
    # Neither is installed by ./scripts/dev.sh, and a gate that is inconclusive
    # on every normal machine is a gate people learn to ignore.
    case "$p" in
      e2e | demo) gate "$label" SKIP "no $p/node_modules (light group)" ;;
      *) gate "$label" UNKNOWN "no $p/node_modules — $(psr_pm "$p") install" ;;
    esac
    return
  fi
  if [ "$script" = typecheck ] && [ "$p" = server ] && [ ! -d reviewer-core/node_modules ]; then
    # server's typecheck follows the path alias into reviewer-core's raw source.
    gate "$label" UNKNOWN "needs reviewer-core/node_modules"
    return
  fi
  # Failing logs outlive the run: $TMP is wiped by the EXIT trap, so pointing at
  # a path inside it would hand the reader a file that no longer exists.
  mkdir -p "$LOGDIR"
  log="$LOGDIR/$(echo "$label" | tr ':' '-').log"
  if (cd "$p" && "$(psr_pm "$p")" run "$script") > "$log" 2>&1; then
    gate "$label" PASS
    rm -f "$log"
  else
    gate "$label" FAIL "$(grep -cE '(error|✖|problem)' "$log" | tr -d ' ') error line(s) — $log"
    tail -12 "$log" | sed 's/^/        /'
  fi
}

if [ "$MODE" = fast ]; then
  gate lint SKIP "--fast"
  gate typecheck SKIP "--fast"
else
  for p in server client reviewer-core; do pkg_script "$p" lint "lint:$p"; done
  for p in server client reviewer-core e2e demo; do pkg_script "$p" typecheck "typecheck:$p"; done
fi

if [ "$MODE" = full ]; then
  for p in server client reviewer-core; do pkg_script "$p" test "test:$p"; done
fi

# ------------------------------------------------------------------- verdict

echo
if [ "$FAILED" -gt 0 ]; then
  echo "RESULT  FAIL     $FAILED gate(s) failed — every one is a BLOCKER"
  exit 1
elif [ "$UNKNOWN" -gt 0 ]; then
  echo "RESULT  UNKNOWN  $UNKNOWN required gate(s) could not run — INCONCLUSIVE"
  exit 2
else
  echo "RESULT  PASS     all deterministic gates passed"
  exit 0
fi
