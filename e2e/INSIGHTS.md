# e2e — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

_(no entries yet)_

## What Doesn't Work

- Running `npm test` straight against your dev DB fails flows 02/04/05: they
  follow the home redirect to the *first* repo and so assume the seeded demo repo
  is the only one. Use `npm run e2e:hermetic`, which brings up its own isolated,
  freshly-seeded stack on alternate ports. (2026-07-27)

## Codebase Patterns

- `e2e/specs/` holds **browser flows** (`NN-name.flow.json`), which is a different
  meaning of "spec" from the project-context specs every package keeps in
  `docs/specs/`. Don't merge the two or write context specs into `specs/` — the
  runner globs that folder. (2026-07-27)

## Tool & Library Notes

- This package uses **npm** (`package-lock.json`), not pnpm, and needs the
  `agent-browser` CLI installed globally once
  (`npm i -g agent-browser && agent-browser install`). (2026-07-27)

## Recurring Errors & Fixes

_(no entries yet)_

## Session Notes

_(no entries yet)_

## Open Questions

_(no entries yet)_
