# server — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

- `./scripts/dev.sh` boots the whole stack from zero and is genuinely idempotent:
  it reuses an already-running `devdigest-postgres` container instead of failing
  on the fixed container name, and re-running installs only what is missing.
  (2026-07-27)

## What Doesn't Work

- On **pnpm 11**, every `pnpm <script>` in this package fails before running
  anything, with `ERR_PNPM_IGNORED_BUILDS`. pnpm 11 flipped `strictDepBuilds` to
  true, so the automatic pre-run dependency check refuses to pass while any
  dependency's build script is undecided. The fix is `pnpm-workspace.yaml` with
  an `allowBuilds:` map (`cpu-features`, `esbuild`, `protobufjs`, `ssh2` — all
  `false`; none of them need to build, each ships a prebuilt binary via
  optionalDependencies). What does NOT work, and wastes time: a `pnpm` field in
  `package.json`, `strict-dep-builds` in `.npmrc`, and the `npm_config_*` env
  vars — pnpm 11 reads this setting only from `pnpm-workspace.yaml`. (2026-07-27)

## Codebase Patterns

_(no entries yet)_

## Tool & Library Notes

- The API imports `reviewer-core`'s raw TypeScript through a tsconfig path alias,
  so `reviewer-core/node_modules` must exist or boot dies with
  `ERR_MODULE_NOT_FOUND` — even though nothing in `server/package.json` references
  that package. `scripts/dev.sh` installs it separately, with **npm**, for exactly
  this reason. (2026-07-27)

## Recurring Errors & Fixes

- `relation ... does not exist` on a fresh boot → migrations were never applied.
  The server does not migrate on boot by design. Run `pnpm db:migrate`. (2026-07-27)

## Session Notes

- **2026-07-27** — First boot from zero on this machine. Docker Desktop was not
  running; after starting it, Postgres, migrations and seed all came up clean.
  Verified `/health/ready` → `{"ready":true}` and the seeded demo data (repo
  `acme/payments-api`, PR #482, the built-in agents).

## Open Questions

- The seeded General Reviewer agent uses `provider: openrouter`, so a review run
  needs `OPENROUTER_API_KEY` — but `.env.example` presents OpenAI/Anthropic
  first. Unclear whether the seed or the example file is the intended default.
