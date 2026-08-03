#!/usr/bin/env bash
#
# The verdict token — the one piece of state the PreToolUse hook reads.
#
#   verdict.sh write BLOCKED --blockers 2 --report .devdigest/…/x.md
#   verdict.sh write PASS_WITH_NOTES --report …
#   verdict.sh write BLOCKED --override "hotfix, ring violation tracked in DD-411"
#   verdict.sh check      # exit 0 = free to open the PR, 1 = blocked (reason on stderr)
#   verdict.sh show
#
# Lives in .git/devdigest/verdict, not in the working tree: it is per-clone
# state, it must never be committed, and `git clean` must never wipe it.
#
# Format is key=value lines, not JSON, so the hook can parse it with grep and
# stay dependency-free. A hook that dies because jq is missing is a hook that
# silently stops guarding anything.

set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
cd "$(psr_root)"

STATE_DIR="$(git rev-parse --git-dir)/devdigest"
STATE="$STATE_DIR/verdict"
LOG=".devdigest/pr-self-review/log.jsonl"

read_key() { [ -f "$STATE" ] && grep "^$1=" "$STATE" | head -1 | cut -d= -f2-; }

sanitize() { printf '%s' "$1" | tr -d '"\\' | tr '\n\t' '  '; }

cmd_write() {
  verdict="${1:-}"
  shift 2> /dev/null || true
  case "$verdict" in
    CLEAN | PASS_WITH_NOTES | BLOCKED | INCONCLUSIVE) ;;
    *) echo "usage: verdict.sh write CLEAN|PASS_WITH_NOTES|BLOCKED|INCONCLUSIVE [...]" >&2; exit 2 ;;
  esac

  blockers=0 report="" override=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --blockers) blockers="${2:-0}"; shift ;;
      --report) report="${2:-}"; shift ;;
      --override) override="$(sanitize "${2:-}")"; shift ;;
      *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
    shift
  done

  if [ -n "$override" ] && [ "${#override}" -lt 10 ]; then
    echo "error: --override needs a real reason, not '$override'" >&2
    exit 2
  fi

  mkdir -p "$STATE_DIR" "$(dirname "$LOG")"
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  head=$(git rev-parse HEAD)
  fp=$(psr_fingerprint)

  # Written whole, then moved into place: a half-written verdict read by the
  # hook mid-write would be indistinguishable from a stale one.
  {
    echo "verdict=$verdict"
    echo "head=$head"
    echo "fingerprint=$fp"
    echo "blockers=$blockers"
    echo "report=$report"
    echo "override=$override"
    echo "generated=$now"
  } > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"

  printf '{"at":"%s","verdict":"%s","head":"%s","blockers":%s,"override":"%s","report":"%s"}\n' \
    "$now" "$verdict" "$(git rev-parse --short HEAD)" "${blockers:-0}" "$override" "$report" >> "$LOG"

  echo "verdict=$verdict  head=$(git rev-parse --short HEAD)  fingerprint=$(echo "$fp" | cut -c1-12)"
  [ -n "$override" ] && echo "override recorded: $override"
  return 0
}

cmd_check() {
  if [ ! -f "$STATE" ]; then
    echo "pr-self-review has not run on this branch yet." >&2
    return 1
  fi

  want_head=$(read_key head)
  want_fp=$(read_key fingerprint)
  verdict=$(read_key verdict)
  override=$(read_key override)
  report=$(read_key report)

  if [ "$want_head" != "$(git rev-parse HEAD)" ] || [ "$want_fp" != "$(psr_fingerprint)" ]; then
    echo "The last pr-self-review is stale — the tree changed since it ran." >&2
    return 1
  fi

  case "$verdict" in
    CLEAN | PASS_WITH_NOTES)
      return 0
      ;;
    BLOCKED | INCONCLUSIVE)
      if [ -n "$override" ]; then
        echo "note: $verdict overridden — $override" >&2
        return 0
      fi
      echo "pr-self-review verdict: $verdict ($(read_key blockers) blocker(s))." >&2
      [ -n "$report" ] && echo "Report: $report" >&2
      return 1
      ;;
    *)
      echo "Unreadable verdict file — re-run pr-self-review." >&2
      return 1
      ;;
  esac
}

case "${1:-}" in
  write) shift; cmd_write "$@" ;;
  check) cmd_check ;;
  show) [ -f "$STATE" ] && cat "$STATE" || { echo "no verdict yet" >&2; exit 1; } ;;
  fingerprint) psr_fingerprint ;;
  *) echo "usage: verdict.sh write|check|show|fingerprint" >&2; exit 2 ;;
esac
