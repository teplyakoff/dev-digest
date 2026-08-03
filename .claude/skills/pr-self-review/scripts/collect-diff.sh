#!/usr/bin/env bash
#
# Phase 1 of pr-self-review: everything not on the base branch yet — committed,
# staged, unstaged AND untracked — as one list.
#
#   collect-diff.sh                          # the change set + budget note
#   collect-diff.sh --paths                  # paths only, one per line
#   collect-diff.sh cache-key GROUP PATH...  # stable key for the group cache
#
# Untracked files are included on purpose: "forgot to `git add` the new
# service" is the most common way a change set lies about itself, and it is
# precisely the file nobody reviews.
#
# Output is TSV, not JSON. The consumer is a model reading a report, the
# producer is bash 3.2 — JSON here would buy nothing and cost an escaping bug.

set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
cd "$(psr_root)"

BASE=$(psr_base)

# Per PASS budget, not per change set. A pass much larger than this either
# overflows the window or gets skimmed — both look identical in the report,
# which is the failure worth avoiding.
BUDGET_FILES=15
BUDGET_LINES=1500

cache_key() {
  group=$1
  shift
  {
    echo "$group"
    for p in "$@"; do
      printf '%s %s\n' "$p" "$(git hash-object -- "$p" 2> /dev/null || echo missing)"
    done | sort
  } | psr_sha256 | cut -c1-16
}

if [ "${1:-}" = "cache-key" ]; then
  shift
  [ $# -ge 1 ] || { echo "usage: collect-diff.sh cache-key GROUP PATH..." >&2; exit 2; }
  cache_key "$@"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# No -M: rename detection collapses a rename into one row and makes numstat
# ambiguous. A rename shown as D + A is more honest for review anyway — the new
# path still gets placed against the placement skills.
git diff --name-status "$BASE" > "$TMP/status" || true
git diff --numstat "$BASE" > "$TMP/numstat" || true
git ls-files -o --exclude-standard > "$TMP/untracked" || true

emit() { # status path added
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$(psr_package "$2")" "$3" "$4" "$2"
}

: > "$TMP/rows"

while IFS="$(printf '\t')" read -r st path; do
  [ -n "${path:-}" ] || continue
  echo "$path" | grep -qE "$PSR_EXCLUDE" && continue
  added=$(awk -F'\t' -v p="$path" '$3==p {print $1; exit}' "$TMP/numstat")
  case "${added:-}" in '' | '-') added=0 ;; esac # '-' = binary
  blob="-"
  if [ "$st" != "D" ] && [ -f "$path" ]; then
    blob=$(git hash-object -- "$path" | cut -c1-12)
  fi
  emit "$st" "$path" "$added" "$blob" >> "$TMP/rows"
done < "$TMP/status"

while IFS= read -r path; do
  [ -n "${path:-}" ] || continue
  echo "$path" | grep -qE "$PSR_EXCLUDE" && continue
  added=$(wc -l < "$path" 2> /dev/null | tr -d ' ')
  emit "U" "$path" "${added:-0}" "$(git hash-object -- "$path" | cut -c1-12)" >> "$TMP/rows"
done < "$TMP/untracked"

sort -k2,2 -k5,5 "$TMP/rows" -o "$TMP/rows"

if [ "${1:-}" = "--paths" ]; then
  cut -f5 "$TMP/rows"
  exit 0
fi

files=$(wc -l < "$TMP/rows" | tr -d ' ')
lines=$(awk -F'\t' '{s+=$3} END {print s+0}' "$TMP/rows")

echo "# pr-self-review — change set"
echo "base=$(git rev-parse --short "$BASE")  head=$(git rev-parse --short HEAD)  fingerprint=$(psr_fingerprint | cut -c1-12)"
echo "files=$files  added_lines=$lines"
echo
printf 'STATUS\tPACKAGE\tADDED\tBLOB\tPATH\n'
cat "$TMP/rows"
echo
echo "# budget: $BUDGET_FILES files / $BUDGET_LINES added lines per review pass"

if [ "$files" -eq 0 ]; then
  echo "EMPTY: nothing differs from the base — verdict CLEAN, no review needed."
elif [ "$files" -gt "$BUDGET_FILES" ] || [ "$lines" -gt "$BUDGET_LINES" ]; then
  echo "WARN: the change set exceeds one pass. Split every oversized group by"
  echo "      subdirectory before reviewing, or narrow the run with --only <package>."
fi
