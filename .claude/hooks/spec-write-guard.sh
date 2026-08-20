#!/usr/bin/env bash
#
# PreToolUse(Write|Edit) guard: the `spec-creator` subagent may write ONLY inside
# a package's spec folder — `<package>/docs/specs/*.md`.
#
# Why this exists at all: a `tools` allowlist decides WHICH tools an agent has,
# never WHICH PATHS it may touch. `spec-creator` has `Write`, so without this
# hook "it only creates specs" is prose, not enforcement. The root INSIGHTS.md
# entry of 2026-08-06 is the authority for the mechanism: hooks fire inside
# subagents and the input carries `agent_type` (the frontmatter `name`, not the
# filename), so one global hook can branch on the agent.
#
# Registered in `.claude/settings.json` rather than the agent's own `hooks:`
# frontmatter ON PURPOSE. The frontmatter form is skipped entirely unless the
# workspace-trust dialog was accepted, and a guard that silently stops guarding
# is worse than no guard. The settings.json form has no such precondition.
#
# Exit codes are the hook contract: 0 = allow, 2 = block and hand stderr back to
# the agent.
#
# UNLIKE `pr-guard.sh` THIS ONE USES jq, AND THAT REVERSAL IS DELIBERATE. That
# guard matches the payload as a whole because the only question it asks is
# "does this text contain a command". Here the question is "what is the value of
# `.tool_input.file_path`", and grep cannot answer it safely: a spec whose BODY
# quotes an allowed path would let a write to anywhere else through. Structural
# extraction is the whole point.
#
# jq missing is therefore handled by FAILING CLOSED, but only for a payload that
# mentions this agent at all — every other Write in every other session is
# untouched. Over-blocking costs one manual write; under-blocking costs an agent
# that edits source files while claiming to write documents.

set -uo pipefail

payload="$(cat)"

if ! command -v jq >/dev/null 2>&1; then
  # No structural read available. Only spec-creator is in scope, and for it the
  # safe answer is "no".
  if printf '%s' "$payload" | grep -q 'spec-creator'; then
    echo "spec-write-guard: jq is not installed, so the write path cannot be verified. Blocking this write. Install jq, or write the file yourself." >&2
    exit 2
  fi
  exit 0
fi

agent_type="$(printf '%s' "$payload" | jq -r '.agent_type // ""' 2>/dev/null)"
[ "$agent_type" = "spec-creator" ] || exit 0

path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null)"

if [ -z "$path" ]; then
  echo "spec-write-guard: the tool call carries no file path, so it cannot be checked against the spec folders. Blocked." >&2
  exit 2
fi

case "$path" in
  *..*)
    echo "spec-write-guard: '$path' contains '..'. Write the destination out in full." >&2
    exit 2
    ;;
esac

# Resolve the destination against THIS repository before matching anything.
#
# The earlier version matched `*/docs/specs/*.md` against the raw path, which
# confined the SHAPE of the destination and not its location: a `case` glob's
# `*` matches slashes, so `/tmp/evil/docs/specs/01-x.md` and
# `server/clones/<owner>/<repo>/docs/specs/01-x.md` both passed. The second is
# the one that matters — `server/clones/` holds repositories this product clones
# from arbitrary user-supplied URLs, so it is the one tree here whose contents
# an outsider influences, and a guard that cannot tell it from the project is
# not holding the boundary it exists for.
#
# The root is derived from this script's own location. Not from the process CWD
# (`git rev-parse` there answers for whatever repo the CWD happens to sit in,
# including a clone) and not from an env var alone (which may or may not reach a
# hook's environment). CLAUDE_PROJECT_DIR is accepted as a second candidate only
# so that a symlinked invocation still normalises.
self_root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/../.." 2> /dev/null && pwd -P)"

rel="$path"
for prefix in "$self_root" "${CLAUDE_PROJECT_DIR:-}"; do
  [ -n "$prefix" ] || continue
  case "$rel" in
    "$prefix"/*)
      rel="${rel#"$prefix"/}"
      break
      ;;
  esac
done
rel="${rel#./}"

# An absolute path that matched no prefix stays absolute and falls through to
# BLOCKED below — which is the correct answer for anything outside this repo.
#
# The package prefix is now an explicit allowlist rather than a `*/`, because
# `*` matches slashes and `server/clones/<owner>/<repo>/docs/specs/x.md` is a
# package prefix as far as a glob is concerned. This is the list the BLOCKED
# message below has always promised; it just was not the list being enforced.
case "$rel" in
  server/docs/specs/*.md | client/docs/specs/*.md | reviewer-core/docs/specs/*.md | e2e/docs/specs/*.md | mcp/docs/specs/*.md | demo/docs/specs/*.md)
    exit 0
    ;;
esac

cat >&2 <<MSG
spec-write-guard: BLOCKED.

  attempted: $path
  resolved:  $rel

spec-creator may write only to <package>/docs/specs/<NN>-<slug>.md — one of
server/, client/, reviewer-core/, e2e/, mcp/, demo/. That includes the folder's
own README.md when a package gets its first spec.

Everything else belongs to another owner: plans to docs/plans/ (implementation-planner), code
to implementer, package docs to doc-writer, INSIGHTS.md to /engineering-insights.
Report what you wanted to write and why, in Open questions. Do not route around
this by asking another tool to do it.
MSG
exit 2
