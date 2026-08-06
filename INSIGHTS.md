# repo-wide — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

**What belongs here:** lessons that are not about one package — the agent and
skill infrastructure under `.claude/`, cross-package conventions, the scripts and
docs at the root. A lesson a reader of `server/INSIGHTS.md` would have to reason
about the client to use belongs in *both* package files, reworded for each, not
here. Here is for what has no package at all.

## What Works

- **Resume a `researcher` agent instead of spawning a second one** when a first
  report leaves narrow follow-ups. `SendMessage` to its agent ID resumes it from
  its transcript with its fetched page captures intact, so follow-ups are
  `grep`-against-capture rather than a re-fetch — the second report on the
  subagent/skill design questions answered three of them with "No new fetches
  were needed". A fresh agent pays the whole search cost again and can land on a
  different revision of the same page. (2026-08-06)

- **Every review layer that cost money found something the layer before it
  structurally could not — so cut input, never checks.** Measured over the L03
  Intent Layer (1.21 M subagent tokens): `architecture-reviewer` +
  `plan-verifier` (351 k, 32 %) returned an it-test making **live billed API
  calls**, a cache invalidator with zero callers, and a signature that blinded
  the repo's own ring-2 lint rule. `/pr-self-review` then found a BLOCKER
  *neither could have seen* — a prompt-injection hole in code written after they
  ran. The live `dev.sh` run then found two more that no agent and no test
  caught: a linked plan never read, and a scope filter that never armed. Four
  layers, four disjoint finding sets, 249 unit tests green throughout. When
  trimming an agent budget, trim how input reaches the checkers. (2026-08-06)

## What Doesn't Work

- **A subagent whose `tools` allowlist omits `Skill` cannot invoke any skill in
  `.claude/skills/`, and it fails silently** — no error, it simply never loads
  one. Every subagent example in the upstream docs omits `Skill`, so copying one
  produces an agent that looks skill-aware and is not. `.claude/agents/implementer.md:4`
  lists it deliberately; `researcher.md:4` and `planner.md:4` omit it deliberately.
  Whichever you intend, make it a decision, not a default. (2026-08-06)

- **A `tools` allowlist cannot make `Bash` read-only.** Granting `Read, Grep,
  Glob, Bash` and calling the agent read-only is wishful: `Bash` still reaches
  `>`, `sed -i`, `git commit`. Anthropic's own read-only example agent
  (`db-reader`) enforces it with a `PreToolUse` hook and calls the system prompt
  a backstop *only when the hook is also in place*. `researcher.md` and
  `planner.md` both rely on a prose deny-list with no hook — that is a known,
  accepted gap, documented in the `## Bash` section of each. Do not describe
  either agent as guaranteed read-only. (2026-08-06)

- **Omitting `tools` from an agent's frontmatter inherits everything, including
  every MCP tool in the session.** A session here can carry 200+ MCP tools
  (Blender, Figma, Vercel, Gmail, Terraform) that have nothing to do with this
  repo. Writing `tools` explicitly is the only thing that keeps them out — there
  is no narrower default to fall back on. (2026-08-06)

- **`.claude/agents/README.md` can assert something that adding an agent makes
  false, and nothing catches it.** It read *"Only `implementer` has the `Skill`
  tool"*; `test-writer` and `doc-writer` made that a lie the moment they landed.
  No test covers it — `.claude/agents/**` is in no cache key, and `routing.md`
  §1 puts `*.md` in the *skipped* row, so `/pr-self-review` never reads it.
  Before adding an agent, grep the README for absolute claims — `only`, `never`,
  `all`, `both`, `neither` — and fix them in the same commit. (2026-08-06)

- **Shortening the documents you pass between agents is the wrong lever, and the
  numbers are not close.** Measured on the L03 Intent Layer, 1.21 M subagent
  tokens total: the plan is 20 789 tokens, the four scratchpad briefs 5 212, the
  six agent prompts ~8 k — **~34 k, or 2.8 % of spend**. Halving all of it saves
  ~1.4 % and destroys the self-contained handoff this file's own *"handoff goes
  through a written artifact"* entry depends on. The actual driver is **568 tool
  calls at ~1 957 tokens each**, multiplied by context being re-sent every turn.
  Optimise turn count and per-agent input scope; leave the artifacts alone.
  (2026-08-06)

- **`planner` carries `Agent(researcher)` and WILL spawn one even when you hand
  it finished research — ~101 k tokens, 8 % of a feature's budget, pure
  duplication.** It was given three pre-digested briefs (repo map, verified model
  facts, external-practice survey) and spawned its own researcher anyway at
  13:25, nested inside its own run so the cost never appears in a notification —
  it is reported to the planner, not to you. Found only by counting subagent
  transcripts (seven) against agents launched (six). When research is
  pre-supplied, say so in the prompt: *"do not spawn a researcher; the briefs are
  your research."* Cheapest single saving available. (2026-08-06)

- **A read-only reviewer given the whole branch re-reviews what a prior verdict
  already covered.** `architecture-reviewer` and `plan-verifier` were both
  pointed at the change set versus the branch base, so they read 47 files — but
  25 were byte-identical to files a `PASS_WITH_NOTES` verdict at an earlier HEAD
  had already passed. Roughly half of ~351 k bought nothing. Point review agents
  at `git diff <last-reviewed-head>..HEAD`, not at the branch base; the reviewed
  head is in `.git/devdigest/verdict`. This is the same reduction
  `/pr-self-review`'s group cache performs and the agents simply never got.
  (2026-08-06)

- **Polling a background agent with `sleep` is pure waste — completion
  notifications re-invoke you automatically.** ~25 minutes of a 3 h 23 m session
  went into `sleep` loops waiting for two researchers, plus several `TaskStop`
  calls to clean up the timers afterwards. Costs little in tokens and a lot in
  wall clock. End the turn instead; the notification brings you back. The one
  legitimate use is a *long* fallback for work the harness cannot track.
  (2026-08-06)

- **`.claude/hooks/pr-guard.sh` gates `git push` but NOT `gh pr edit`** — its
  `GUARDED` list is `gh pr create|gh pr ready|gh pr merge|git push`. So a pull
  request's title and body can be rewritten with no verdict at all, while the
  branch behind them cannot move. That asymmetry is usable (update the prose,
  then push) and also a hole worth knowing about: a description can be made to
  claim things the pushed tree does not contain. Note too that the guard matches
  the payload as whole TEXT, so a command that merely *mentions* `git push` — an
  echo, a heredoc, a doc edit — is blocked too; that is documented and accepted,
  and costs one `PSR_SKIP=1`. (2026-08-06)

## Codebase Patterns

- **A review subagent that needs two skills in one pass takes no `Skill` tool —
  it `Read`s the `SKILL.md` files by path.** `pr-self-review/SKILL.md` phase 5
  already does this and says why: *"Read, not the Skill tool — a pass usually
  needs two of them at once and the Skill tool loads one."* Three further
  properties fall out, which is why `architecture-reviewer.md:4` is
  `Read, Grep, Glob, Bash`: a literal path cannot resolve to a plugin skill, so
  the ~100-plugin collision hole closes by construction rather than by
  convention; the read-only tool surface stays as narrow as it was; and the
  unresolved question below about `allowed-tools` widening a subagent's grant
  never gets to matter. Preloading via `skills:` is the wrong instrument here —
  two ~400-line skills are paid in full even on a one-file diff. (2026-08-06)

- **Agents cite a skill by path, never by bare name** — `.claude/skills/onion-architecture/SKILL.md`,
  not `onion-architecture`. A session here loads ~100 plugin skills alongside the
  13 project ones, and several collide by topic: `vercel:react-best-practices`
  against `react-best-practices`, `engineering:architecture` and
  `backend-development:architecture-patterns` against `onion-architecture`,
  `vercel:nextjs` against `next-best-practices`. A bare name lets an agent load
  foreign rules while believing it followed the project's. (2026-08-06)

- **A subagent's output format is its API.** It starts with a fresh, isolated
  context — it does not see the conversation, the files already read, or the
  skills already invoked — and the caller gets back only its final message. That
  is why `researcher.md`, `planner.md` and `implementer.md` each end in a
  mandatory report template, and why each keeps a section that may never be
  dropped (`Not established`, `Open decisions`, `Deviations from the plan`). An
  agent that "just answers" loses everything it did not write down. (2026-08-06)

- **A check whose answer is a grep belongs in `gates.sh`, not in a review
  agent** — it costs nothing, cannot be reasoned out of its answer, and fails
  identically on every machine. Reviewing L03 by hand showed four BLOCKER-class
  rows from `routing.md` §5 that are pure pattern matches and are currently paid
  for in model tokens on every run: a sibling-module import out of
  `modules/*` (onion §11); `INJECTION_GUARD` present on each new
  model path; the `groundFindings → applyScopeFilter → scoreFromFindings`
  ordering in `reviewer-core/src/review/run.ts`; and the count of
  `eslint-disable no-restricted-imports` against a recorded baseline. Three are
  on the closed BLOCKER list, so today a model decides them. The
  machine-identical property is the real prize, not the ~20 k/run — it is what
  the un-injected-`ANTHROPIC_API_KEY` bug taught: a check that passes only
  because *this* machine lacks a key is not a check. (2026-08-06)

- **Do NOT merge `architecture-reviewer` and `plan-verifier` to save tokens —
  and merging would not save any.** Their independence is the product:
  `plan-verifier.md` names "substituting review advice for the conformance
  table" as the failure it exists to prevent, and on L03 their finding sets were
  disjoint. Nor is there a saving: they run in isolated contexts, so sequential
  and parallel cost the same tokens and parallel is faster in wall clock (17 min
  against 28 min summed). Share their *input* — one prepared diff bundle,
  scoped to the unreviewed delta — and keep two agents. (2026-08-06)

- **Cheap models buy little here, because the mechanical work is already free.**
  The instinct is to downgrade the review agents; the measurement says
  `gates.sh` already does the 17 genuinely mechanical checks at zero model cost,
  and what remains in the agents is judgement. The one defensible split is
  `plan-verifier`, whose phase 1 is *extraction* (turn a 20 789-token plan into a
  159-item checklist — haiku-tier) and phase 2 is *verdicts* (not). Guard it by
  asserting the item count before the verdict phase runs: a silently short
  enumeration reads exactly like a clean conformance table, which is the failure
  that agent exists to prevent. (2026-08-06)

- **Agent-to-agent handoff goes through a written artifact, not a message.**
  A plan produced by `planner` is written to `docs/plans/L<NN>-<slug>.md` — the
  existing convention, see `docs/plans/L02-conventions.md` — and the implementing
  agent is given that path. This follows the upstream guidance to write a
  self-contained spec and execute it from a clean context, and it survives the
  session ending, which a message does not. (2026-08-06)

- **`docs/results/<lab>/` may keep a frame from a different take, but only if it
  says which one and why.** `docs/results/README.md` says re-recording *replaces*
  the file, which reads as "never mix takes" — and mostly it should, because the
  L02 evidence's own postmortem is a mislabelled still. The exception is a state
  the current take structurally cannot produce: `13-intent-stale.png` needs a PR
  whose head moved after its intent was derived, and only a push does that. Keep
  the older frame, and name it as borrowed in that lab's `README.md` next to the
  reason. An unlabelled borrowed frame is the failure; a labelled one is evidence
  the take could not otherwise carry. (2026-08-06)

## Tool & Library Notes

- **A `PreToolUse` hook *can* be scoped to one subagent — read the read-only
  entry above as "we chose not to", not "it is impossible".** Hooks fire inside
  subagents, and the hook input carries `agent_id` and `agent_type` (`agent_type`
  is the frontmatter `name`, not the filename), so a global hook in
  `settings.json` can branch on the agent. A hook can also be declared in the
  agent's own `hooks:` frontmatter, where it applies only while that agent is
  active — that form needs the workspace-trust dialog accepted, or Claude Code
  skips it. This qualifies, and does not delete, the 2026-08-06 *What Doesn't
  Work* entry: the `db-reader` backstop wording still stands, but the missing
  hook here is a decision (recorded in `docs/plans/L03-agents.md`), not a gap in
  the harness. **And `.claude/hooks/pr-guard.sh` is not that hook** — this repo
  does register a `PreToolUse` hook on `Bash`, and it gates `git push` and
  `gh pr create/ready/merge` on the `/pr-self-review` verdict. It restricts no
  writes. Seeing it in `.claude/settings.json` and concluding an agent is
  enforced read-only is the exact wrong inference. (2026-08-06)

- **`skills:` in an agent's frontmatter is a different axis from the `Skill`
  tool, and works without it.** `skills:` injects the full content of the listed
  skills at startup; `Skill` in `tools` permits invoking skills at runtime. The
  docs state it directly: "This field controls which skills are preloaded, not
  which skills the subagent can access." `planner` uses this to receive
  `engineering-insights` content while remaining unable to invoke any skill —
  which is also what keeps plugin skills out of its reach entirely. (2026-08-06)

- **Two different limits govern a `description`, and the smaller one is the real
  one.** The Agent Skills spec hard-validates at **1024 characters** with a parse
  error; Claude Code separately truncates the combined description in its skill
  *listing* at 1536. Write to 1024 — the 1536 figure is a display budget and does
  not make a longer description legal anywhere else. (2026-08-06)

- **`Agent(name)` inside `tools` narrows which subagents an agent may spawn;
  omitting `Agent` blocks spawning entirely.** `planner` carries
  `Agent(researcher)` so history and upstream-docs questions go to the agent that
  already has a hardened Bash contract, instead of widening `planner`'s own tool
  surface. The parenthesised syntax is version-gated: if it does not resolve, the
  agent still launches — a launch only fails when *nothing* in `tools` resolves.
  (2026-08-06)

## Recurring Errors & Fixes

_(no entries yet)_

## Session Notes

- **2026-08-06** — Added `planner` and `implementer` to `.claude/agents/`,
  grounded in a two-pass `researcher` run over the Claude Code subagent and
  Agent Skills docs. The design changed twice under evidence: `planner` was first
  given no skill access at all (wrong — it would plan on less context than the
  implementer has), then the `Skill` tool (wrong — it cannot be shown to preserve
  read-only, and it opens the plugin-collision hole), and finally `skills:`
  preload, which is the documented mechanism that gives content without granting
  invocation. Three harness behaviours remain undocumented; they are in *Open
  Questions* rather than assumed.

- **2026-08-06** — Added `test-writer`, `architecture-reviewer`, `plan-verifier`
  and `doc-writer`, taking `.claude/agents/` to seven. The plan came from
  `planner` and five `researcher` runs fired in parallel — subagent mechanics,
  test authoring, architectural review, plan verification, documentation — and
  the external pass paid for itself twice: it turned up the agent-scoped hook
  mechanism that corrects this file's own read-only entry, and Anthropic's
  best-practices page carries a worked prompt for reviewing a diff against a plan
  file, which is `plan-verifier`'s job almost verbatim. Two README statements had
  to be corrected rather than extended. The read-only enforcement question was
  put to the user and answered *prose deny-list*, matching the three existing
  agents; `docs/plans/L03-agents.md` records that as a decision so the next
  session does not re-derive it.

- **2026-08-06** — Built the L03 Intent Layer end to end through the seven-agent
  pipeline, and measured the pipeline while using it. Wall clock **3 h 23 m**, of
  which **2 h 01 m** was subagent compute; **1.21 M subagent tokens**, of which
  1 111 674 measured and ~101 k estimated for a nested researcher whose cost is
  reported to its parent, not to the caller.

  | agent | tokens | tool calls | duration |
  |---|---:|---:|---|
  | implementer | 381 885 | 232 | 46m26s |
  | planner | 204 504 | 70 | 17m46s |
  | plan-verifier | 194 680 | 77 | 16m13s |
  | architecture-reviewer | 156 289 | 76 | 12m03s |
  | researcher — external practice | 100 599 | 67 | 17m39s |
  | researcher — OpenRouter models | 73 717 | 46 | 10m51s |
  | researcher — nested in planner | ~101 000 | — | 4m52s |

  Split: implementer 34 %, verification 32 %, research 23 %, planning 18 %. The
  main thread's own usage is not exposed to the model, so this is subagents only.
  Two researchers in parallel and two reviewers in parallel saved ~24 min of wall
  clock and nothing in tokens. Real DevDigest spend for the feature's own model
  calls was ~$0.006 persisted (4 intent derivations + 3 review runs), higher in
  fact because `pr_intent` upserts and earlier derivations were overwritten.

  The waste, itemised in *What Doesn't Work* above: ~101 k duplicated research
  and roughly 200 k of badly-scoped reviewer input — about 30 % recoverable with
  no check removed. Not the checking: four layers each found what the previous
  could not, and 249 unit tests were green through all of it.

- **2026-08-06** — Filmed the L03 Intent Layer (`demo/record-intent.ts`, evidence
  in `docs/results/l03/`) and rewrote PR #5's title and description around it.
  The subject had claimed *"Intent layer · Smart Diff"*; only the Intent Layer is
  in the branch, so the title was narrowed and a *Not in this branch* section
  says what the lesson pairs it with and why that is absent. Three takes, ~$0.012,
  and the two discarded ones produced better lessons than the one that shipped —
  both are in `demo/INSIGHTS.md`. The sharpest is not about recording at all:
  `buildApp` reaps `running` runs on construction, so the **server test suite
  marks live billed reviews `failed` in the dev database** (written up in
  `server/INSIGHTS.md`, tracked as separate work off `main`).

## Open Questions

- `reviewer-core/test/**` matches **no group** in
  `.claude/skills/pr-self-review/routing.md` §1 — `engine` covers
  `reviewer-core/src/**`, `server-tests` covers `server/test/**`, `client-tests`
  covers `client/**`. Tests written there are reviewed by nothing. `routing.md`
  says a file in no group is a decision rather than an oversight, but nothing
  records that this one was decided; `test-writer` applies `onion-architecture`
  §12 there by analogy, which is a workaround. Settles by a maintainer call:
  add an `engine-tests` row, or state in `routing.md` that the omission is
  deliberate. Either way it invalidates the cached findings of every group
  reviewed against `pr-self-review`'s own files, so it belongs in its own change.

- Does a subagent whose `tools` omits `Skill` still receive the level-1 skill
  listing (names and descriptions), or is it blind to which skills exist? The
  "What loads at startup" list in the docs enumerates six items and a skill
  listing is not among them, but nothing states the exclusion. Settles by
  experiment: spawn with `tools: Read` and ask it what skills it can see.

- Can a skill's `allowed-tools` grant a tool that the invoking subagent's own
  `tools` allowlist does not contain? The field is documented only as
  permission-prompt pre-approval in a main session, and the subagents doc never
  mentions it. This is load-bearing for every read-only agent here: if it can
  broaden, then `researcher` and `planner` stop being read-only the moment they
  touch a skill. Settles by experiment.

- Is the `Skill(name)` / `Skill(name *)` permission syntax legal inside a
  subagent's own `tools` / `disallowedTools` frontmatter, or only in
  `settings.json`? If it works in frontmatter, the plugin-collision problem
  becomes a config fix instead of a convention held up by prose.
