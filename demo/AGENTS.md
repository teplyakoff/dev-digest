# `@devdigest/demo` — screencast recorder

Playwright records a video of the real review loop end to end. It is a **demo
recorder, not a test** — `../e2e` is what asserts behaviour. How a recording is
structured and how to put one in a PR: `README.md`.

## Commands (npm, NOT pnpm)

- `npm run setup` — one-time, fetches the Chromium build Playwright records with
  (~95 MB into `~/Library/Caches/ms-playwright`); idempotent.
- `npm run record` — **spends real money.** It fires a real
  `POST /pulls/:id/review`, so every recording costs whatever the models cost.
- `npm run typecheck`

## Map

- `record.ts` — the whole recorder: one step per scene, each captioned.
- `recordings/` — output, git-ignored (`mp4`/`webm`, per-step `png`, `summary.json`).

## Conventions

- Everything is env-driven, so one script serves any repo/PR: `DEMO_REPO`,
  `DEMO_PR`, `DEMO_BASE_URL`, `DEMO_API_URL`, `DEMO_OUT`, `DEMO_HEADED`,
  `DEMO_RUN_TIMEOUT`. Never hard-code a repo or PR number.
- A `failed` agent run exits the script non-zero — a broken recording is loud
  rather than a quietly short video.

## Gotchas

- **The dev stack must already be up** (`../scripts/dev.sh`), and the target PR
  needs a **real diff**. `pnpm db:seed` inserts file rows with `patch: null`, so
  a seeded PR grounds no findings. Record against a genuinely imported repo.
- **Cost `—` is not a bug.** `cost_usd` is `null` (UNKNOWN) on failed, cancelled
  and in-flight runs, and on models with no price. `0` means a genuinely free
  run. One unpriced run makes the total unknown, not partial.
- Playwright can only record VP8/WebM. With a real `ffmpeg` on `PATH` the output
  is converted to H.264/mp4; without it you keep the `.webm` and nothing fails.
- Captions are injected DOM nodes, so a client-side route change drops them —
  every step re-creates the banner rather than assuming it survived.

## Read when

- recording, or putting the video in a PR description → `README.md`

Before working here read `INSIGHTS.md`; append to it with `/engineering-insights`
at the end of the session.
