# `@devdigest/web` — client

Next.js studio: browse PRs, read and run reviews, author agents. The UI route map
and the API surface each route leans on are in `README.md` — do not restate them
here.

## Commands (pnpm)

`pnpm dev` (:3000) · `pnpm test` (vitest + jsdom) · `pnpm typecheck`

## Map

- `src/app/**/page.tsx` — routes
- `src/app/**/_components/<Name>/` — feature logic, colocated with its `*.test.tsx`
- `src/lib/hooks/*` — every data hook (TanStack Query) → `src/lib/api.ts`
- `src/components/app-shell/` — nav, breadcrumbs, `g`-then-key shortcuts
- `src/vendor/ui/` — vendored primitives (`@devdigest/ui`)
- `src/vendor/shared/` — Zod contracts, vendored from the server
- `messages/<locale>/*.json` — next-intl strings

## Conventions

- Pages stay thin; feature logic lives in colocated `_components/<Name>/` folders.
- Data goes through `src/lib/hooks/*` only — never `fetch` inside a component.
- User-facing text goes through next-intl, never hardcoded in JSX.
- A new component ships with its `*.test.tsx` in the same folder.

## Gotchas

- Tests mock `fetch`, so they need neither the API nor a browser. Real browser
  journeys live in `../e2e` — put them there, not here.
- `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`) is inlined at build
  time, so changing it needs a dev-server restart.

## Do not touch

- `src/vendor/**` — vendored. Edit the source, then re-vendor.

## Read when

- adding a route or a data hook → `README.md` (UI route map)
- you need a contract's shape → `src/vendor/shared/contracts`
- specifying new work → `docs/specs/`

Before working here read `INSIGHTS.md`; append to it at the end of the session.
