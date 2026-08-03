#!/usr/bin/env bash
#
# Re-vendor the Zod contracts: server (source of truth) → client (copy).
#
#   ./scripts/vendor-shared.sh          # copy, report what changed
#   ./scripts/vendor-shared.sh --check  # copy nothing; exit 1 if they differ (CI)
#
# WHY THIS EXISTS
#
# `@devdigest/shared` is vendored twice — `server/src/vendor/shared/**` and
# `client/src/vendor/shared/**` — and until now the only mechanism keeping them
# equal was "copy it by hand", which both INSIGHTS.md files record as failing
# SILENTLY: the client type-checks against its own stale copy, so the API sends a
# field and the component reads `undefined`. Nothing errors, nothing logs.
#
# That is not hypothetical. When this script was written the copies had drifted
# on five files — including `Provider`, whose client copy was missing
# `'openrouter'`, the provider the seeded default agent actually runs on.
#
# DIRECTION IS NOT NEGOTIABLE: server is the source, client is the copy. Editing
# `client/src/vendor/shared/**` loses the edit the next time this runs. Add the
# field on the server, run this, commit both.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/server/src/vendor/shared"
DST="$ROOT/client/src/vendor/shared"

CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

[[ -d "$SRC" ]] || { echo "error: source not found: $SRC" >&2; exit 2; }
[[ -d "$DST" ]] || { echo "error: destination not found: $DST" >&2; exit 2; }

if [[ $CHECK -eq 1 ]]; then
  if diff -r "$SRC" "$DST" > /tmp/vendor-shared-drift.txt 2>&1; then
    echo "vendored contracts are in sync"
    exit 0
  fi
  echo "::error::client/src/vendor/shared has drifted from server/src/vendor/shared" >&2
  echo >&2
  cat /tmp/vendor-shared-drift.txt >&2
  echo >&2
  echo "Fix: ./scripts/vendor-shared.sh && commit both copies." >&2
  exit 1
fi

# --delete so a contract removed on the server does not linger on the client.
# Without it a deleted file keeps type-checking forever and nobody finds out.
if command -v rsync > /dev/null 2>&1; then
  rsync -a --delete --itemize-changes "$SRC/" "$DST/"
else
  rm -rf "$DST" && cp -R "$SRC" "$DST"
fi

if git -C "$ROOT" diff --quiet -- client/src/vendor/shared 2>/dev/null; then
  echo "vendored contracts already in sync — nothing changed"
else
  echo "re-vendored. Changed files:"
  git -C "$ROOT" diff --stat -- client/src/vendor/shared
  echo
  echo "Now run: (cd client && pnpm typecheck && pnpm test)"
fi
