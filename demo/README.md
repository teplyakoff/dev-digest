# `@devdigest/demo` — screencast recorders

Two recorders, both producing a captioned video plus one PNG per scene:

| Script | Records | Cost |
|---|---|---|
| `npm run record` | the review loop: PR list → run every enabled agent → watch them work → verdict, score and **Run Cost Badge** → run trace → back to the list with the COST column filled in | **real money** |
| `npm run record:skills` | the L02 Skills feature: the grid and preview drawer → authoring and versioning → the import preview's ignored-entries list → the agent Skills tab → the run trace's skills block and token count | free |

These are **demo recorders, not tests.** They exist to produce shareable evidence
that the app works against a real stack; `../e2e` is what actually asserts
behaviour.

## Why they are not part of `../e2e`

`e2e` is deliberately deterministic, key-free and free: its flows target
read-only seeded data and never touch a model. `record` does the opposite — it
triggers a real `POST /pulls/:id/review`, so **every run costs real money** and
takes as long as the models take. Keeping the two apart is what lets `npm test`
in `e2e` stay cheap and CI-safe.

`record:skills` sits between them: it calls no model, but it **writes** — it
authors a skill, imports one and re-links an agent, so it needs a stack it is
allowed to mutate. That is why it lives here and not in `e2e`, whose flows are
strictly read-only.

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

### Recording the Skills feature

```bash
npm run record:skills
```

Reads `DEMO_BASE_URL`, `DEMO_API_URL`, `DEMO_OUT` (default
`./recordings/l02-skills`) and `DEMO_HEADED`. No repo or PR to choose — it drives
`/skills`, the agent editor and one existing run trace.

Two things worth knowing before you run it:

- **It writes.** It authors `migration-safety`, imports `error-handling-guard`
  from an archive it builds in memory, and ticks a skill onto an agent. Both
  skills are deleted by name first so the run is repeatable — `skills` has a
  unique `(workspace_id, name)` index — and the agent's link set is restored on
  the way out, including after a failure.
- **The trace scenes need a run that already loaded a skill.** No model is called
  here, so the recorder cannot create one; it searches every run for a non-empty
  `trace.config.skills` and, finding none, records the other scenes and exits
  non-zero rather than filming an empty drawer. Link a skill to an agent, run
  `npm run record` once, and every skills recording afterwards has a trace.

It also asserts rather than just filming: if the import preview fails to name
every non-body entry of the fixture archive as ignored, the run fails. That list
is the product claim, so a recording that silently lost it is worse than none.

## Output

Into `recordings/` (git-ignored):

- `devdigest-review-loop-<timestamp>.mp4` / `devdigest-skills-<timestamp>.mp4` —
  the video, captioned per step
- `NN-<step>.png` — one frame per step, at 2× for stills
- `summary.json` — for `record`, cost before/after plus per-agent status, cost
  and findings; for `record:skills`, what it authored and imported, the ignored
  entries it asserted on, and the trace run it used

Playwright can only record VP8/WebM, and the ffmpeg it bundles is built with
libvpx alone, so it cannot re-encode. If a real `ffmpeg` is on `PATH` the
recording is converted to H.264/mp4 and the webm dropped — mp4 plays where WebM
does not (QuickTime, Keynote, PowerPoint) and for this screen content lands at
roughly half the size. Without ffmpeg you simply keep the `.webm`; nothing fails.
`brew install ffmpeg` if you want the mp4.

## Putting the recording in a PR

GitHub will **not** play a video that lives in the repo. `<video>` is stripped by
its sanitizer, `![](x.mp4)` renders as a broken `<img>`, and the blob page for an
mp4 offers only "View raw". Only a file uploaded through the web UI gets a player.

So to put one in a **description**, borrow a comment as the uploader:

1. Drag the mp4 into a new comment on the PR and post it.
2. Copy the `https://github.com/user-attachments/assets/<uuid>` URL out of it —
   `gh pr view <n> --json comments --jq '.comments[].body'`.
3. Put that URL **on its own line** in the description. A bare attachment URL
   expands into a `<video controls>` anywhere GitHub renders markdown, not just
   in the comment that uploaded it.
4. Delete the comment — `gh api -X DELETE /repos/{owner}/{repo}/issues/comments/{id}`.
   The asset outlives it and the description's player keeps working.

Only step 1 needs the browser; the rest is `gh`. Commit the mp4 to
`docs/results/<lab>/` as well — the attachment is GitHub's copy, the repo is
yours.

A GIF does embed straight from the repo, and that was the workaround here before
the four steps above were worked out. It is not worth it: to fit, the recording
has to be sped up past the point where the step captions can be read, and it
still costs more than the mp4 it replaces.

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
