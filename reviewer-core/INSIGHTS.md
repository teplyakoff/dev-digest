# reviewer-core — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

_(no entries yet)_

## What Doesn't Work

_(no entries yet)_

## Codebase Patterns

- This package is consumed as **source**, not as a build artifact: the server
  resolves it through a tsconfig path alias and runs its TypeScript directly via
  tsx. Consequences worth remembering before you change anything structural —
  `npm run build` is only a type-check, there is no `dist/`, and any runtime
  dependency you add here must be installed in `reviewer-core/node_modules` or
  the *server* fails to boot. (2026-07-27)

## Tool & Library Notes

- This package uses **npm** (`package-lock.json`), while `server/` and `client/`
  use pnpm. Running `pnpm install` here creates a second, conflicting lockfile —
  `scripts/dev.sh` deliberately calls `npm ci`. (2026-07-27)

## Recurring Errors & Fixes

_(no entries yet)_

## Session Notes

_(no entries yet)_

## Open Questions

_(no entries yet)_
