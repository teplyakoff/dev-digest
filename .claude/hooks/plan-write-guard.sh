#!/usr/bin/env bash
#
# PreToolUse(Write|Edit) guard: the `implementation-planner` subagent may write
# ONLY inside `docs/plans/` — the repo-root plans folder, and nothing else.
#
# Why the agent has `Write` at all: its artifact is the plan, and the plan is
# what `plan-verifier` later demands BY PATH. Handing the plan back as a final
# message meant a human retyped or re-pasted a 20 k-token document into a file,
# which is where plans got truncated. `spec-creator` already writes its own
# artifact under a hook; this is the same trade, one stage later.
#
# Why a guard is still required: a `tools` allowlist decides WHICH tools an agent
# has, never WHICH PATHS it may touch. Without this hook, "it only writes plans"
# is prose. The root INSIGHTS.md entry of 2026-08-06 is the authority for the
# mechanism — hooks fire inside subagents and the input carries `agent_type` (the
# frontmatter `name`, not the filename), so one global hook can branch on it.
#
# Registered in `.claude/settings.json` rather than the agent's own `hooks:`
# frontmatter ON PURPOSE, for the same reason as `spec-write-guard.sh`: the
# frontmatter form is skipped entirely unless the workspace-trust dialog was
# accepted, and a guard that silently stops guarding is worse than no guard.
#
# Exit codes are the hook contract: 0 = allow, 2 = block and hand stderr back to
# the agent.
#
# THIS GUARD DOES NOT MAKE THE AGENT SAFE ON ITS OWN. `implementation-planner`
# keeps `Bash`, and `Bash` reaches `>`, `tee` and `sed -i`, none of which are
# `Write` or `Edit` and none of which this hook sees. The agent's own `## Bash`
# section is what holds that half, and it is prose. Two halves, one enforced.
#
# Like `spec-write-guard.sh` and UNLIKE `pr-guard.sh`, this uses jq: the question
# is "what is the VALUE of `.tool_input.file_path`", and a grep over the whole
# payload would let a write anywhere through as long as the file's BODY quoted an
# allowed path — and a plan's body quotes paths constantly. Structural extraction
# is the whole point.
#
# jq missing therefore FAILS CLOSED, but only for a payload that mentions this
# agent at all; every other Write in every other session is untouched.
#
# A third agent needing this would justify one table-driven guard instead of a
# third near-copy. Two does not: each file states its own path rule where the
# rule is enforced, and neither can silently widen the other.

set -uo pipefail

payload="$(cat)"

if ! command -v jq > /dev/null 2>&1; then
  if printf '%s' "$payload" | grep -q 'implementation-planner'; then
    echo "plan-write-guard: jq is not installed, so the write path cannot be verified. Blocking this write. Install jq, or write the file yourself." >&2
    exit 2
  fi
  exit 0
fi

agent_type="$(printf '%s' "$payload" | jq -r '.agent_type // ""' 2> /dev/null)"
[ "$agent_type" = "implementation-planner" ] || exit 0

path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2> /dev/null)"

if [ -z "$path" ]; then
  echo "plan-write-guard: the tool call carries no file path, so it cannot be checked against docs/plans/. Blocked." >&2
  exit 2
fi

case "$path" in
  *..*)
    echo "plan-write-guard: '$path' contains '..'. Write the destination out in full." >&2
    exit 2
    ;;
esac

# Normalise to a repo-relative path before matching. An absolute path is the
# normal case — agents resolve paths against the project root — and matching
# `*/docs/plans/*.md` instead would silently bless `server/docs/plans/x.md`,
# a folder this repo does not have and should not acquire by accident.
rel="$path"
root="$(git rev-parse --show-toplevel 2> /dev/null || true)"
if [ -n "$root" ]; then
  case "$rel" in
    "$root"/*) rel="${rel#"$root"/}" ;;
  esac
fi
rel="${rel#./}"

case "$rel" in
  docs/plans/*.md)
    exit 0
    ;;
esac

cat >&2 <<MSG
plan-write-guard: BLOCKED.

  attempted: $path
  resolved:  $rel

implementation-planner may write only to docs/plans/<name>.md — the repo-root
plans folder. The existing files are L<NN>-<slug>.md, one per lesson.

Everything else belongs to another owner: specs to <package>/docs/specs/
(spec-creator), code to implementer, package docs to doc-writer, INSIGHTS.md to
/engineering-insights. A requirement you wanted to change is a finding for
spec-creator, not a file you edit.

Report what you wanted to write and why, in Open decisions. Do not route around
this by asking another tool — or a subagent — to do it.
MSG
exit 2
