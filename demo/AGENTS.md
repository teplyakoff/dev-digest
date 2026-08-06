# `@devdigest/demo` — screencast recorders

Playwright records videos of the app end to end. These are **demo recorders, not
tests** — `../e2e` is what asserts behaviour. How a recording is structured and
how to put one in a PR: `README.md`.

## Commands (npm, NOT pnpm)

- `npm run setup` — one-time, fetches the Chromium build Playwright records with
  (~95 MB into `~/Library/Caches/ms-playwright`); idempotent.
- `npm run record` — the review loop. **Spends real money.** It fires a real
  `POST /pulls/:id/review`, so every recording costs whatever the models cost.
- `npm run record:skills` — the L02 Skills feature. **Free** — it calls no model.
- `npm run record:conventions` — the L02 homework: the Conventions Extractor plus
  the API Contract Reviewer control experiment. **Spends real money** (one
  extraction); the two experiment runs are found, not triggered.
- `npm run record:intent` — the L03 Intent Layer. **Spends real money**: two
  review triggers plus the classifier calls behind them.
- `npm run typecheck`

## Map

- `record.ts` — the review loop: one step per scene, each captioned.
- `record-skills.ts` · `record-conventions.ts` · `record-intent.ts` — one lab's
  feature each, same shape.
- `lib/zip.ts` · `lib/skills-fixture.ts` — the import fixture archive, built in
  memory rather than checked in, so a reader can diff its entries against the
  "ignored" list the preview renders.
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
- `record:skills` is free but **not self-sufficient**: its trace scenes need a
  run whose `trace.config.skills` is non-empty, and only a real (paid) review
  produces one. With none in the database it records the rest and exits non-zero
  rather than filming an empty drawer. Link a skill to an agent, run one review
  with `npm run record`, and every later skills recording has a trace to show.
- It creates `migration-safety` and imports `error-handling-guard`, deleting both
  by name first — `skills` has a unique `(workspace_id, name)` index, so without
  that cleanup the second run 409s. The agent's link set is restored in `finally`.
- `record:intent`'s opening scene needs the target PR to have **no intent row**,
  and nothing in the product deletes one, so there is no route to call. It films
  the derived card instead and warns; `delete from pr_intent where pr_id = …`
  restores the empty state.
- **Dropdown items carry their hint inside the same `<button>`**, so an agent's
  accessible name is `"General Reviewer deepseek/deepseek-v4-flash"` — match by
  prefix, never `exact: true`. The trace drawer's tabs are passed as bare strings,
  so its tab labels are literally `trace` and `log`, not "Live log".

## Read when

- recording, or putting the video in a PR description → `README.md`

Before working here read `INSIGHTS.md`; append to it with `/engineering-insights`
at the end of the session.
