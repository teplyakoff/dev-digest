# `@devdigest/demo` — screencast recorder

Records a video of the real review loop: PR list → run every enabled agent →
watch them work → verdict, score and **Run Cost Badge** → run trace → back to the
list with the COST column filled in.

This is a **demo recorder, not a test.** It exists to produce shareable evidence
that the loop works against a real stack; `../e2e` is what actually asserts
behaviour.

## Why it is not part of `../e2e`

`e2e` is deliberately deterministic, key-free and free: its flows target
read-only seeded data and never touch a model. This recorder does the opposite —
it triggers a real `POST /pulls/:id/review`, so **every run costs real money** and
takes as long as the models take. Keeping the two apart is what lets `npm test`
in `e2e` stay cheap and CI-safe.

## Setup (once)

```bash
cd demo
npm install
npm run setup      # fetches the Chromium build Playwright records with
```

`npm run setup` downloads ~95 MB into `~/Library/Caches/ms-playwright` and is
idempotent — re-running it is a no-op once the browser is present.

## Recording

The dev stack must already be up (`../scripts/dev.sh`) and the target repo must
have a PR with a **real diff**. Then:

```bash
npm run record
```

Everything is env-driven, so the same script serves any repo/PR:

| Env | Default | Meaning |
|---|---|---|
| `DEMO_BASE_URL` | `http://localhost:3000` | web origin |
| `DEMO_API_URL` | `http://localhost:3001` | API origin |
| `DEMO_REPO` | first repo that has a PR | substring match on `full_name` |
| `DEMO_PR` | that repo's first PR | PR number |
| `DEMO_OUT` | `./recordings` | output directory |
| `DEMO_HEADED` | unset (headless) | `1` to watch the browser live |
| `DEMO_RUN_TIMEOUT` | `300000` | ms to wait for the runs to settle |

```bash
DEMO_REPO=acme/payments-api DEMO_PR=482 npm run record
```

## Output

Into `recordings/` (git-ignored):

- `devdigest-review-loop-<timestamp>.mp4` — the video, captioned per step
- `NN-<step>.png` — one frame per step, at 2× for stills
- `summary.json` — cost before/after, plus per-agent status, cost and findings

Playwright can only record VP8/WebM, and the ffmpeg it bundles is built with
libvpx alone, so it cannot re-encode. If a real `ffmpeg` is on `PATH` the
recording is converted to H.264/mp4 and the webm dropped — mp4 plays where WebM
does not (QuickTime, Keynote, PowerPoint) and for this screen content lands at
roughly half the size. Without ffmpeg you simply keep the `.webm`; nothing fails.
`brew install ffmpeg` if you want the mp4.

The script exits non-zero if any agent run ends `failed`, so a broken recording
is loud rather than a quietly short video.

## Gotchas

- **A seeded PR has no diff.** `pnpm db:seed` inserts file rows with
  `patch: null`, so a run against the demo `acme/payments-api` PR has nothing to
  ground findings against. Record against a genuinely imported repo.
- **Cost `—` is not a bug.** `cost_usd` is `null` (UNKNOWN) on failed, cancelled
  and in-flight runs, and on providers with no price for the model slug. `0`
  means a genuinely free run. The recorder's total null-poisons the same way the
  engine does: one unpriced run makes the total unknown, not partial.
- Captions are injected DOM nodes, so a client-side route change drops them —
  every step re-creates the banner rather than assuming it survived.
