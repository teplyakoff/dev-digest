#!/usr/bin/env bash
#
# Shared helpers for pr-self-review. Sourced by the scripts beside this file,
# never executed directly.
#
# The function that matters is psr_fingerprint(). The writer (`verdict.sh
# write`) and the reader (`verdict.sh check`, called from the PreToolUse hook)
# MUST compute staleness identically, or a verdict either never goes stale —
# "reviewed once, blessed forever" — or never stays fresh and the gate becomes
# noise. One function, two callers, no second implementation.
#
# bash 3.2 compatible on purpose: macOS still ships it as /bin/bash and this
# runs on developer machines, not only on CI images. No mapfile, no
# associative arrays, no `${var,,}`.

psr_root() { git rev-parse --show-toplevel; }

psr_sha256() {
  if command -v shasum > /dev/null 2>&1; then
    shasum -a 256 | cut -d' ' -f1
  else
    sha256sum | cut -d' ' -f1
  fi
}

# What the change set is measured against. PSR_BASE overrides; otherwise the
# merge base with origin/main, then a local main, then the root commit so a
# fresh clone with no remote still produces something sane.
psr_base() {
  if [ -n "${PSR_BASE:-}" ]; then git rev-parse "$PSR_BASE"; return; fi
  for ref in origin/main main; do
    if git rev-parse --verify --quiet "$ref" > /dev/null; then
      git merge-base HEAD "$ref" && return
    fi
  done
  git rev-list --max-parents=0 HEAD | tail -1
}

# Everything that could change a review outcome, hashed into one token.
psr_fingerprint() {
  base=$(psr_base)
  {
    git rev-parse HEAD
    git status --porcelain=v1 -uall
    git diff "$base"
    # `git diff` cannot see untracked content — only its name shows up in
    # --porcelain. Without hashing it, fixing a blocker inside a brand-new file
    # would leave the old BLOCKED verdict looking fresh, which is exactly
    # backwards.
    git ls-files -o --exclude-standard | while IFS= read -r f; do
      printf '%s %s\n' "$f" "$(git hash-object -- "$f" 2> /dev/null || echo unreadable)"
    done
  } 2> /dev/null | psr_sha256
}

psr_package() {
  case "$1" in
    server/*) echo server ;;
    client/*) echo client ;;
    reviewer-core/*) echo reviewer-core ;;
    e2e/*) echo e2e ;;
    demo/*) echo demo ;;
    docs/*) echo docs ;;
    scripts/* | .github/* | .claude/*) echo infra ;;
    *) echo root ;;
  esac
}

# Five packages, two managers, one lockfile each — see the layout table in
# AGENTS.md. Guessing wrong here writes the wrong lockfile, which is itself a
# gate below.
psr_pm() {
  case "$1" in
    server | client) echo pnpm ;;
    *) echo npm ;;
  esac
}

# Paths that are never reviewed and never counted: build output, vendored deps,
# recorded demo artefacts. Kept as one regex so collect-diff and gates agree.
PSR_EXCLUDE='(^|/)(node_modules|dist|build|\.next|out|coverage|playwright-report|test-results)/|^_assets/|^docs/results/'
