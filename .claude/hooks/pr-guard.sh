#!/usr/bin/env bash
#
# PreToolUse(Bash) guard: no PR gets opened, updated or merged while the last
# pr-self-review says BLOCKED, INCONCLUSIVE, or nothing at all.
#
# Deliberately does NOT parse the tool payload as JSON. The payload arrives on
# stdin and the only question asked of it is "does it contain one of these
# commands", which grep answers without jq, python, or a JSON escaping edge
# case. A guard with a dependency is a guard that stops guarding the day the
# dependency is missing.
#
# Exit codes are the hook contract: 0 = allow, 2 = block and hand stderr back to
# the agent. Anything the guard cannot answer allows the call — this hook runs
# on EVERY Bash call, so a bug here must not brick the session. The blocking
# decision itself still fails closed: `verdict.sh check` returns non-zero for
# missing, stale, BLOCKED and INCONCLUSIVE alike.
#
# Escape hatches, in order of preference:
#   /pr-self-review                        fix the findings, re-run
#   /pr-self-review --accept-risk "reason" record why, then proceed
#   PSR_SKIP=1 <command>                   one-off, no record kept
#
# The last one is matched in the command TEXT, not in the environment: this hook
# runs as its own process before the command does, so a `VAR=1 cmd` prefix never
# reaches it. An exported PSR_SKIP works too, for whoever wants the gate off for
# a whole session.
#
# Known and accepted: the payload is matched as a whole, so a command that merely
# MENTIONS `gh pr create` — an echo, a heredoc, a doc edit — is blocked too.
# Parsing the JSON properly would need jq, and a guard with a dependency is a
# guard that silently stops guarding. Over-blocking costs one PSR_SKIP=1;
# under-blocking costs an unreviewed pull request.
#
# Also by construction: ONE COMMAND CANNOT BOTH REFRESH THE VERDICT AND PUSH.
# This runs before any of the payload does, so it reads the verdict as it was
# BEFORE a `verdict.sh write` sitting earlier in the same line — a compound
# command that unblocks itself is blocked every time. Write the verdict in one
# call, push in the next. It bites hardest right after a commit: HEAD is part of
# the fingerprint, so a freshly committed tree always needs a new verdict.

set -uo pipefail

[ "${PSR_SKIP:-0}" = "1" ] && exit 0

payload=$(cat 2> /dev/null || true)

printf '%s' "$payload" | grep -q 'PSR_SKIP=1' && exit 0

# `git push` is in the list on purpose: pushing a branch that already has a PR
# updates that PR. Drop the alternative if the team finds it too tight.
GUARDED='gh pr create|gh pr ready|gh pr merge|git push'
printf '%s' "$payload" | grep -qE "$GUARDED" || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2> /dev/null)}"
[ -n "$ROOT" ] || exit 0
CHECK="$ROOT/.claude/skills/pr-self-review/scripts/verdict.sh"
[ -x "$CHECK" ] || exit 0

if reason=$("$CHECK" check 2>&1); then
  exit 0
fi

cat >&2 <<EOF
BLOCKED by pr-self-review.

$reason

Run /pr-self-review, fix what it reports, and try again. If the block is wrong
or accepted deliberately, the user — not you — decides:
  /pr-self-review --accept-risk "<reason>"
EOF
exit 2
