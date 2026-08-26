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

- **`implementer`'s "Handoff to review" section is the highest-yield input a
  review has, and it is free.** On L04 the agent ended its report by naming
  three judgement calls it wanted a second opinion on. Two of them became
  findings the review would otherwise have had to derive from 2 000 lines of
  new code — `Deps` importing ring 2 from the ring-1 port file, and a
  structural re-declaration of the SDK's `RequestHandlerExtra`. It also
  volunteered the one gate defect it had introduced. Read that section first
  and treat each item as a lead to confirm or dismiss; it costs one paragraph
  of reading and it is written by the only party that knows which decisions
  were close. (2026-08-12)


- **`gates.sh` is the cheapest verification interface an agent has, and it took a
  `--unit` flag to make it usable as one.** A passing `pnpm exec vitest run
  --exclude '**/*.it.test.ts'` on `server/` prints **51 lines**; the same run
  through `gates.sh` prints **one** (`GATE  test:server  PASS`), and a failing one
  costs twelve plus a path to the full log under
  `.devdigest/pr-self-review/logs/`. It also picks the manager per package, so an
  agent stops choosing between pnpm and npm — a wrong choice there fails quietly.
  `--full` could not serve this: `server`'s `test` script is a bare `vitest run`
  that sweeps in every `*.it.test.ts` and the testcontainers behind them, so
  `--unit` excludes exactly that, and only for `server`, the one package with a
  DB-backed suite. `implementer` phase 3 is now one `gates.sh --unit --only <pkg>`
  call instead of a four-row table of per-package commands. (2026-08-20)

- **Read a skill by section, not by file — and the anchor form is per skill,
  because the numbering is not uniform.**
  `awk 'f && /^## /{exit} /^## 12\./{f=1} f'` over `onion-architecture/SKILL.md`
  returns 26 lines of 408. The skills a plan reaches for most are the large ones
  — `react-testing-library` 603, `typescript-expert` 431, `frontend-architecture`
  420, `onion-architecture` 408 — and two per step, re-sent every turn, is the
  largest single line item in `implementer`'s budget. The trap: **only
  `onion-architecture` and `frontend-architecture` use numbered headings.**
  `security`, `zod`, `react-testing-library`, `typescript-expert` and
  `react-best-practices` use text headings (`## A06 — Insecure Design`), so a
  rule demanding `§N` universally would not resolve. `implementation-planner`
  therefore cites a path plus an anchor that *resolves* — `§N` where it exists,
  the heading verbatim otherwise — which costs it nothing, because it already
  read that section to write the binding rule. (2026-08-20)

- **When a finding lands on one file, probe every sibling that does the same job
  — before fixing anything.** The `/pr-self-review` pass on `f253548`'s parent
  found a root-resolution bug in `.claude/hooks/plan-write-guard.sh` and, in the
  same report, asserted that `spec-write-guard.sh` "has no equivalent exposure".
  Four `printf '<payload>' | guard; echo $?` lines proved the opposite: the older
  guard's exposure was **wider**, allowing a write anywhere on the filesystem.
  The non-exposure claim had been reasoned from reading the code; the probe took
  under a minute and was already in hand from reproducing the first bug. The rule
  that falls out: a security finding describes a *class*, and the class is what
  you test the neighbours for. The cheapest moment is before the fix, while the
  reproduction harness still exists. (2026-08-20)

- **A finding that names a *class* is fixed as a class, and the audit itself
  turns up defects the finding never named.** `/pr-self-review` reported a
  contradiction at `.claude/commands/impl.md:109` — a newly added conditional
  path versus a table two sections away still stating the unconditional one — and
  described the class as "adding an alternative to a procedure means auditing
  every place that procedure is restated". Patching the cited line took one edit.
  Doing the audit turned up a second restatement at `:127` that the finding had
  not mentioned and that was wrong in a worse way: the item-count guard was sent
  to whichever launch came first in the text rather than to the pass that
  actually enumerates, so in two-pass mode it would have guarded an enumeration
  that does not happen in that pass. Same shape as the sibling-probe entry above,
  one level in: that one says test the neighbouring *files*, this one says test
  the other places in the *same* document. (2026-08-21)

- **A "standalone" design HTML under `_assets/` is a bundler shell — grepping it
  finds the artboard names and nothing else.** `_assets/L02/DevDigest Design
  (standalone) (3).html` is 1.8 MB but only 180 lines: the screens live
  base64+gzip inside a `<script type="__bundler/manifest">` tag, so a search for
  `ScreenContext` returns two hits, both references in the artboard list, and the
  component itself appears nowhere. Reading the design means unpacking it —
  `json.loads` the manifest, `base64.b64decode` each entry, `gzip.decompress`
  when `compressed` is set — after which `screen_tour_context.jsx` and the rest
  are plain JSX. `spec-creator`'s Phase 2 sends agents to these files by path, so
  an agent that greps and reports "the design does not contain this screen" is
  wrong and will say so confidently. (2026-08-22)

- **Run metrics are on disk; do not ask an agent what it spent.** Every session
  writes `~/.claude/projects/<slug>/<session>.jsonl` plus one
  `<session>/subagents/agent-<id>.jsonl` per subagent, each carrying `usage`
  per call, timestamps, tool names with arguments, and `is_error` on results —
  enough to derive tokens per agent, launch order, real concurrency, which files
  two agents both read, and which tool calls failed.
  `.claude/skills/workflow-retro/scripts/collect-run.py` does this. Two traps it
  exists to avoid: a resumed agent's first→last timestamp spans every idle hour
  between its bursts (`spec-creator` measured 1138 m that way and 37 m when
  summed over bursts), and summing `input_tokens` gives billing, not context
  size. (2026-08-22)

- **Hand the finished plan to a model of another family BEFORE `/impl`, not the
  code afterwards.** `docs/plans/L05-pr-brief.md` went to `codex exec --sandbox
  read-only` (OpenAI `gpt-5.6-sol`, reasoning high) with both spec halves and the
  repo's instruction files; it opened with *"not executable as written"* and
  returned four blockers, three of which were confirmed by hand. The two that
  mattered were invisible to the Claude agents that wrote and graded the plan:
  render-time caps that made two drop levels **unreachable in production while
  their unit test stayed green**, and a token budget measured over the source
  blocks while the requirement measured the assembled messages. Both would have
  shipped as green tests. Cost: one read-only CLI run, no repo writes. The note
  belongs in `docs/results/<lab>/` beside the video, because a reviewer asking
  "was this checked" wants the raw output, not a summary. (2026-08-25)


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

- **A plan's factual premises are not reviewed by anything, and a wrong one
  survives every gate.** `docs/plans/L03-smart-diff.md:499` asserted that the
  Files tab's original mode is "alphabetical by path". It is not — `getPrFiles`
  has no `ORDER BY` — and the claim had already been through planning and review.
  A second premise in the same plan was self-contradictory: S9 specified
  `router.replace` while the end-to-end checklist required browser Back to return
  to `?tab=diff&view=smart`, which `replace` cannot do because it overwrites the
  entry Back would return to. Neither is catchable by typecheck, lint or tests,
  because both are claims *about* the code rather than code. When a plan states a
  fact about existing behaviour, verify it against the source before building on
  it, and treat a plan that both prescribes a mechanism and demands an outcome
  that mechanism forbids as a question for the author, not a puzzle to solve
  silently. (2026-08-08)

- **A verification script that cannot be shown to go red is not evidence.**
  `scripts/verify-l03.sh` was written, ran green, and could have shipped there —
  a script whose lanes silently matched zero test files would have printed the
  same two `PASS` lines. Proving it: append a deliberately failing `it()` to one
  of the files it filters on, run it, confirm one `FAIL`, confirm the *other*
  lane still ran (that is what `set -uo pipefail` without `-e` buys), confirm
  exit 1, then restore the file and verify with `md5` that it is byte-identical.
  The same applies to a lint rule added to cover a new path: plant the violation,
  watch it error, revert. Costs two minutes; without it the check is decoration.
  (2026-08-08)

- **A character class cannot anchor a pattern in `gates.sh`, because
  `added_hits` feeds grep `path<TAB>content` and the TAB is already consumed.**
  Fixing the `xit\(` false positive on `process.exit(` by writing
  `[^A-Za-z]xit\(` silently stopped matching any `xit(` at column 0 of the
  source line: the literal `TAB` earlier in the pattern eats the only character
  the class could have matched, and there is nothing left to backtrack onto.
  Colocated client tests live under `client/src/**`, where a top-level `xit(`
  is exactly how a skipped test is written — so the gate lost its most common
  real case while still reporting PASS. Use `\b` instead (`\bxit\(` matches
  after a TAB and after a space, and still rejects `exit(`); both GNU and BSD
  grep support it under `-E`. Test any new pattern against BOTH a column-0 and
  an indented occurrence — either one alone proves nothing. (2026-08-12)

- **`git hash-object` inside `collect-diff.sh cache-key` degrades to the
  literal string `missing`, so a key built from a mangled argument list is
  still sixteen valid-looking hex characters.** Computing one group's key two
  ways during the L04 review returned `5a1e9b9e623214c5` and
  `1013ffe4e4e0190a` from byte-identical inputs, because one call path did not
  word-split the path list and `hash-object` was handed a single nonexistent
  multi-path filename. Nothing errors and nothing warns: the wrong key simply
  never collides with the right one, so every group reads as a cache miss
  forever and the findings written under it are orphaned. Sanity-check a
  computed key by asserting a HIT on a group whose files did not change —
  that is the only cheap evidence that the key is the one the previous run
  wrote. (2026-08-12)

- **Extends the entry above: that sanity check is not reachable from a later
  round, because a cache entry does not record what it was keyed on.** Every file
  in `.git/devdigest/cache/` starts with `group:` and `skills:` and nothing else
  — no file list, no skill paths — so a subsequent round cannot reconstruct the
  argument list the previous one passed to `cache-key` and therefore cannot prove
  a HIT is the right entry. Probing for it in round 8 of the L04 review cost
  several attempts and produced only misses (`mcp-core` → `167277cd91abac26`,
  nothing on disk), which is indistinguishable from "the files changed". Use the
  cheaper and stronger check instead: `git diff --name-only <verdict-head>..HEAD`
  against the head recorded in `.git/devdigest/verdict`. If a file does not
  appear there, its blob is unchanged and the prior round's findings stand — no
  key arithmetic involved. Report those groups as *carried on verified-identical
  blobs*, never as `cached`, so the report does not claim a check nobody ran.
  Fixing the cache properly means writing the key inputs into the entry.
  (2026-08-12)

- **A free port is not a stopped dev server, and `pkill -f "tsx watch
  src/server.ts"` matches nothing.** Stopping the API after a live run looked
  like it worked — `lsof -tiTCP:3001` came back empty — and two processes ran
  on for **9 h 24 m**: `pnpm dev` (96418) and its child
  `node .../tsx/dist/cli.mjs watch src/server.ts` (96432). The port was free
  only because the listener had been killed by PID from `lsof`; the file
  watcher above it never had a port and so never showed up. The `pkill` pattern
  missed because `pnpm dev` spawns tsx through its CLI entry point, so the real
  command line contains `cli.mjs watch src/server.ts`, not `tsx watch …` —
  close enough to read as correct and not close enough to match. Verify with
  `ps -Ao pid,command | grep Projects/dev-digest` after stopping anything;
  a port check answers a different question than the one being asked.
  (2026-08-12)

- **A `PreToolUse` path guard written with `grep` is bypassable, and the payload
  that proves it looks harmless.** `spec-write-guard.sh` restricts `spec-creator`
  to `*/docs/specs/*.md`. The obvious build is to copy `pr-guard.sh`, whose
  header argues at length that "a guard with a dependency is a guard that stops
  guarding" and matches the whole stdin payload with `grep`. That reasoning does
  not transfer. `pr-guard.sh` asks *does this text contain a command*, which is a
  whole-payload question; a path guard asks *what is the value of
  `.tool_input.file_path`*, which is a structural one. Tested during the build:
  `{"agent_type":"spec-creator","tool_input":{"file_path":"server/src/x.ts",
  "content":"see client/docs/specs/06-a.md"}}` — a `grep` for an allowed path
  passes it, and the write lands in `server/src/`. The `jq` version blocks it.
  Copy the *question shape*, not the neighbouring hook's dependency policy.
  (2026-08-20)

- **You cannot restrict a subagent by restricting its parent, so `Agent(...)` is
  a privilege boundary, not a containment one.** `spec-creator` has no `Bash` on
  purpose and its writes are confined by `spec-write-guard.sh`, which keys on
  `agent_type`. Giving it `Agent(researcher)` hands it a subagent that **does**
  carry `Bash` — and a spawned subagent runs under its own `agent_type`, so
  neither the missing shell nor the write hook reaches inside it. The hook has no
  way to ask who spawned whom; nothing in the input carries a parent. Every
  read-only or path-confined agent that gains `Agent(...)` therefore gains
  whatever its child can do, silently. The rule written into both spawning agents
  is "delegate a question, never an action", and that is prose with no enforcement
  behind it. Do not describe such an agent as sandboxed. (2026-08-20)

- **Auditing for the *absence* of something with a substring `grep` reports the
  opposite of the truth.** Checking whether any spec had ever stated an
  accessibility requirement, `grep -ri aria */docs/specs/*.md` returned 8 files —
  it was matching `va`**`ria`**`nt`. With `-w`, the real answer is **zero**, and
  the same for `accessibility`, `a11y`, `WCAG`, `keyboard` and `screen reader`.
  The failure mode is one-directional and nasty: a false hit while hunting for a
  gap makes the gap disappear, and the finding reads as "already covered". When
  the conclusion is "this is missing", the search that established it needs word
  boundaries and needs to be re-run before the claim is written down. (2026-08-20)


- **A `README.md` in `.claude/commands/` becomes a slash command.** Writing one
  there registered `/README` in the same turn — listed, invocable, and doing
  nothing. Every `.md` in that directory is a command and there is no
  documentation-file exemption. `.claude/skills/` looks symmetrical and is not: a
  skill is a *directory* containing `SKILL.md`, so a loose `README.md` beside
  them is inert, which is exactly why the mistake is easy to make in that
  direction. The map for the commands therefore lives at `.claude/COMMANDS.md`,
  one level up from what it describes. (2026-08-20)

- **`server/package.json` is NOT `skip-worktree`, and citing that as the reason
  to write the vitest lane out by hand no longer holds.** `git ls-files -v`
  reports `H` for `server/`, `client/` and `reviewer-core/`. The *rule* survives
  — invoke `pnpm exec vitest run --exclude '**/*.it.test.ts'` rather than a named
  script — but for a different and durable reason: `server/package.json` commits
  exactly one test script, `test`, a bare `vitest run`, so there is no
  `test:unit` or `test:integration` to call. `TESTING.md` and
  `.claude/agents/test-writer.md` both carried the stale justification and now
  state the real one with the old one named beside it. A rule that outlives its
  stated reason is more dangerous than a wrong rule: the next reader re-derives
  the reason, finds it false, and drops the rule. (2026-08-20)

- **A `PreToolUse` path guard that constrains the SHAPE of a path instead of its
  LOCATION reads as working and allows writes anywhere on disk.**
  `spec-write-guard.sh` matched `*/docs/specs/*.md` against the raw
  `.tool_input.file_path`. A `case` glob's `*` matches slashes, so the leading
  `*/` never meant "one package directory" — it meant "anything at all", and
  both `/tmp/evil/docs/specs/01-x.md` and
  `server/clones/<owner>/<repo>/docs/specs/01-x.md` returned exit 0. The second
  is the one that matters: `server/clones/` holds repositories this product
  clones from arbitrary user-supplied URLs, so it is the only tree here whose
  contents an outsider influences, and a guard that cannot tell it from the
  project is not holding the boundary it exists for.
  `plan-write-guard.sh` had the same class by a different route — it resolved the
  root with `git rev-parse --show-toplevel`, which answers for the hook
  **process's** CWD, so run from inside a clone it normalised
  `<clone>/docs/plans/evil.md` to `docs/plans/evil.md` and passed.
  The shape that works, in both: derive the root from `${BASH_SOURCE[0]}` — never
  the CWD, never an env var alone — normalise the destination to a repo-relative
  path, let anything that will not normalise fall through to BLOCKED, and spell
  the allowed prefixes out as a literal alternation rather than a `*/`. Fixed in
  `f253548`, with 30 payloads asserting it. This does not supersede the
  2026-08-20 entry on `Write|Edit` hooks not reaching `Bash`: that one is about
  which *tools* a guard sees, this one about which *paths* it accepts, and a
  guard can be wrong in both ways at once. (2026-08-20)

- **Reading a `CLEAN` verdict as "the tree is clean" does not survive contact
  with the data.** Six consecutive `/pr-self-review` runs on `homework-L05`, each
  after fixing the last: `0a3dc80` found a reproduced root-resolution bug in
  `plan-write-guard.sh`; `f253548` found a wider escape in `spec-write-guard.sh`
  that the previous report had explicitly called clean; `abaf769` found two stale
  agent counts that the run introducing them had missed; `9adaff4` found a stated
  trade with no stated cost; `4e1e328` found the fix for that contradicting
  another section. **Three of the five were defects in this gate's own previous
  output.** The findings do shrink run over run, so it converges — but `CLEAN`
  means "this pass saw nothing further", never "there is nothing further". Budget
  a re-run after every fix and read the verdict as a floor, not a certificate.
  Extends the *every review layer found something the layer before it missed*
  entry above from four different layers to six runs of one. (2026-08-21)

- **Do not spend `PSR_SKIP=1` on a false positive you can reword away.**
  `pr-guard.sh` matches the whole tool payload as text, so writing a review's own
  group results blocks the call whenever the prose quotes one of the four guarded
  phrases — and a report about pushing and pull requests quotes them constantly.
  The entry above records that this "costs one `PSR_SKIP=1`", which reads as
  permission; in practice the cheaper and more honest move is to reword ("the
  push command", "opening a pull request") and leave the override alone. The
  override is the user's to spend — `pr-self-review/SKILL.md` — and an agent that
  learns to reach for it on a documented false positive has learned the habit
  that defeats the gate. (2026-08-21)

- **A subagent that spawns children in the background never receives their
  reports — the main loop does.** `spec-creator` launched four `researcher`
  briefs with `run_in_background`, and its transcript
  (`agent-abc292521de4140b3.jsonl`) holds four launch acknowledgements of 1 099
  chars each and **zero** task-notifications; all four reports were delivered to
  the session's main loop instead. It finished the pass without them, re-read six
  files its own children had already covered (`simple-git.ts`,
  `tokenizer/index.ts`, `schema/agents.ts`, `schema/context.ts`,
  `repos/service.ts`, `run-executor.ts`), and reported honestly that "only one
  returned". 43 178 output tokens landed with the wrong recipient. A nested agent
  must launch its research **blocking**, or the orchestrator must forward what
  arrives. Mirror image of the 2026-08-06 entry above, where a *nested*
  researcher's cost was reported to the planner and never to the main loop:
  delivery follows the spawn mode, and neither direction is the one you assume.
  (2026-08-22)

- **`git add -u` while a subagent's work is sitting in the tree commits their
  files under your subject.** The L05 spec patch was staged that way and swept in
  eight of `implementer`'s tracked edits: `448dd8b`, subject `docs(specs): …`,
  carried the contract, the schema, the container and the intent service. It
  broke two things at once — a `docs` commit holding feature code, and the
  `feat` commit's own `Steps: S1…S13` claiming steps whose files were not in its
  diff. `plan-verifier` caught it in phase 2, not the author. **Stage explicit
  paths whenever an agent has an edit in flight**, and re-read `git status`
  before every `git add` that is not a single named file. The repair is a
  `git reset --soft` to the commit before and two re-commits, which is only
  cheap while nothing has been pushed. (2026-08-25)

- **A graded eval case copied its target path from a documentation *example*
  instead of the real convention it claims to test.** `evals/workflow/review-workflow.cases.ts`
  had three `trace` cases asserting `filesRead` contained `server/docs/api-contracts.md`,
  `reviewer-core/docs/pipeline.md`, and `reviewer-core/insights/gotchas.md` — none of
  which ever existed anywhere in this repo's git history (`git log --all -p -- CLAUDE.md`
  never mentions any of the three). The source was `evals/README.md`'s illustrative
  `contrast`-kind example (`expectFileRead: "server/docs/api-contracts.md"`, written to
  teach the DSL shape, not to describe this repo) — someone building the real graded
  cases reused that placeholder path verbatim instead of checking root CLAUDE.md's actual
  "Read when" table, which routes to `server/README.md`, `reviewer-core/README.md`, and
  (via the "Session loop" rule, not a dedicated gotchas file) each package's own
  `INSIGHTS.md`. All three cases had been silently failing every `pnpm eval:workflow` run
  since the eval package was merged in. **When a graded case's expected path looks
  suspiciously specific, grep the doc it's meant to test for that exact string before
  trusting the case — a README's teaching example and a real fixture can drift apart with
  nothing to catch it**, because nothing type-checks a hardcoded path against the prose it
  claims to route from. Fixed by pointing the three cases at the real "Read when" targets;
  see the inline "FIXED 2026-08-26" comments in `review-workflow.cases.ts` for the
  per-case mapping. (2026-08-26)


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

- **A new package needs THREE rows in `routing.md`, not one — `src`, `test` and
  the launcher — or `/pr-self-review` reviews part of it and says PASS.** L04
  added `mcp/` with a single `mcp/src/**` row. That left 912 lines under
  `mcp/test/**` and a new executable `mcp/bin/devdigest-mcp` matching no group
  at all, and the run still ended `PASS_WITH_NOTES`; the only reason it
  surfaced is that `report-format.md` makes the "Not reviewed" table
  mandatory. The fix was an `mcp-tests` row (onion §12, HIGH ceiling, mirroring
  `server-tests`) plus widening `infra` to `*/bin/**` and `.mcp.json`. When
  adding a package, write the rows before the code — and read the "Not
  reviewed" table of the first run as the check that you got them all.
  (2026-08-12)

- **State the RATIONALE for a placement decision in one file; let the others
  state only the fact.** Whether the MCP registration lives at an
  auto-discovered `.mcp.json` or at a name only an explicit flag loads was
  reversed twice in one session, and each reversal meant editing the same five
  files — `AGENTS.md`, `mcp/AGENTS.md`, `mcp/README.md`, the root `README.md`
  and `pr-self-review/routing.md` — because every one of them explained *why*
  rather than pointing at the explanation. Ten edits for two decisions, and the
  real risk is not the typing: a file missed in the sweep goes on asserting the
  reverse, and `*.md` is on routing's skipped row, so no review pass would ever
  catch it. The fact ("it is auto-discovered", "it costs 1 871 tokens") is
  cheap to repeat and useful in each place. The argument for it belongs in the
  package README, once. (2026-08-12)

- **A subagent cannot hold a dialogue, so any agent whose job includes "ask the
  user" is two-pass — and the pass-1 report is the only carrier between them.**
  `spec-creator` runs six categories of clarification questions past a human
  before writing a spec. A single-pass agent physically cannot: it gets one
  isolated context and returns one final message, so "ask clarifying questions"
  silently degrades into "list assumptions". The shape that works: pass A
  researches, returns a numbered question set, **writes no file**; the caller
  collects answers; pass B is invoked with the answers *and the verbatim pass A
  report*. Pass B does not remember pass A — an invocation carrying answers but
  not the report re-derives the analysis from scratch and quietly produces
  different findings, which is why `spec-creator.md` phase 0 stops rather than
  proceeding. Anything expensive discovered in pass A (there, a design bundle
  read) must be *in* the report or it is lost. (2026-08-20)

- **Two agents can own the same output path and nothing in this repo will tell
  you.** `doc-writer` already routed `<package>/docs/specs/NN-slug.md` when
  `spec-creator` was added for the same destination; the collision was found by
  reading `doc-writer.md`, not by any check. Nothing downstream catches it —
  `routing.md` §1 puts `docs/**` and `*.md` on the *skipped* row, so
  `/pr-self-review` never looks, and an agent file is not a review input either
  (it is in no cache key). Adding an agent therefore includes a manual sweep of
  every existing agent's *Where it may write* table for the paths the new one
  claims, and resolving the overlap in **both** files — here `doc-writer` kept
  only status edits on an existing spec and gained a deny-row, while
  `spec-creator` took authorship. Two agents quietly claiming one path is
  discovered at the moment they disagree. (2026-08-20)

- **The `AC` chain now runs end to end, and each link treats the artefact above
  it as fixed.** `spec-creator` numbers acceptance criteria; `planner` binds
  `S<n> → AC-<n> → test_name` and carries a *Traceability* table; `plan-verifier`
  grades coverage from **the spec's** `AC` list with `COVERED` / `CLAIMED` /
  `DEFERRED` / `UNCOVERED`. Two rules make it work rather than just look tidy.
  Coverage is read from the spec and never from the plan's own table — deriving
  the list from the plan makes the pass tautological, since a criterion the plan
  forgot cannot be missing from a list built out of the plan. And `CLAIMED` is
  kept distinct from `COVERED`, because a matrix whose test column is
  aspirational reads exactly like a satisfied one. Step ids stayed `S<n>` rather
  than the `T<n>` of the source illustration: 32 `### S<n>` headings already
  exist in `docs/plans/` and `plan-verifier` keys its rows on them. **This
  settles the Open Question added earlier the same day** — that the traceability
  the spec format was designed for stopped at the spec. (2026-08-20)

- **`planner` is now `implementation-planner`, and the rename is the smaller half
  of the change.** Every earlier entry in this file naming `planner` means this
  agent; the file is `.claude/agents/implementation-planner.md` and the old
  frontmatter name no longer resolves. What actually moved is the boundary: it
  plans **how**, never **what**. It may not write under `*/docs/specs/`, may not
  draft or reword an `AC`, and may not answer a spec's `[NEEDS CLARIFICATION]`;
  requirement-level defects are reported and routed to `spec-creator` by name
  instead of being quietly repaired inside a step. The reason is not tidiness —
  a plan that fixes a requirement forks the requirements, and `plan-verifier`
  grading the change set against the plan cannot tell which fork the caller
  approved. Note the asymmetry in how the two directions are held:
  `spec-creator` is kept out of every other directory by
  `spec-write-guard.sh`, while the reverse boundary rests on prose in
  `implementation-planner.md` — it has `Bash`, so a redirect is the hole, and
  there is no hook watching it. (2026-08-20)

- **An agent that must put a question to a human is two-pass, and this repo now
  has two of them.** `implementation-planner` joined `spec-creator`: pass A
  returns a requirements review, numbered `R-N` recommendations and the
  single-agent/multi-agent gate; pass B takes the chosen mode and writes the
  plan. It skips the stop when the invocation already names the mode and nothing
  blocking came up, which is the escape hatch that keeps a one-file fix from
  costing two round-trips. The mode is asked rather than assumed because it
  changes the plan's **shape**: multi-agent needs steps grouped into tracks whose
  file sets are disjoint, since `implementer` and `test-writer` both write and
  two parallel tracks sharing a file collide. Deciding that at run time means
  discovering it as a conflict. (2026-08-20)

- **When three agents need the same definition, extract the definition rather
  than syncing three copies.** `spec-creator` writes acceptance criteria,
  `implementation-planner` reviews them before planning, `plan-verifier` grades
  them afterwards — and all three had grown their own wording of "well-formed",
  which is how the same row ends up judged three ways. The wording now lives once
  in `.claude/skills/acceptance-criteria/SKILL.md`: five EARS patterns with the
  Ukrainian keywords, six quality tests, `AC-N`/`NFR-N` numbering, four
  verification kinds. **All three read it by path, none invokes it** — none of
  them has the `Skill` tool, and all three have `Read`, which is the
  `architecture-reviewer` mechanism reused. Note what stayed behind: each agent
  keeps the repo-specific half (where a performance number actually comes from,
  that `*.it.test.ts` is mandatory here) and delegates only the general
  definition. Extract the shared vocabulary, not the local knowledge.
  (2026-08-20)

- **`INSIGHTS.md` is read scoped to the packages in play, and sweeping all of
  them is a mistake rather than diligence.** Written into `spec-creator` phase 1
  after the files got large: the routing table in
  `.claude/skills/engineering-insights/references/entry-quality.md` already says
  which file a package maps to, `repo-intel` routes to `server/INSIGHTS.md`, and
  work under `.claude/`, `docs/` or `scripts/` routes to the root file. The cost
  of over-reading is not just tokens — an entry pulled in from a package the
  feature never touches is a constraint that does not apply, and it shapes a
  criterion anyway. (2026-08-20)


- **A `PreToolUse` hook on `Write|Edit` confines the `Write` tool and nothing
  else, so an agent that also has `Bash` is only half-confined.**
  `.claude/hooks/plan-write-guard.sh` restricts `implementation-planner` to
  `docs/plans/*.md`, but `>`, `tee` and `sed -i` are not `Write` or `Edit` and the
  hook never sees them. `spec-creator` has no `Bash` at all, so its confinement is
  complete; the planner's is enforced for one tool and prose for the other, and
  both halves are stated in its own `## Bash` section. Do not describe an agent
  holding both a path hook and a shell as sandboxed — and when adding a guard,
  decide first which of those two shapes you are building. (2026-08-20)

- **`plan-verifier` has to run twice, because its two halves have different
  dependencies.** Phases 1–4 grade whether the plan's steps landed and need no
  test to exist; phase 5 grades `COVERED` against `CLAIMED`, and `COVERED`
  requires the named test to exist and pass. A single pass is therefore wrong in
  one direction whichever end it sits at: before `test-writer` every coverage row
  reads `CLAIMED`, a column of noise shaped exactly like a finding; after
  `architecture-reviewer` a `NOT MET` step surfaces only once the tests and the
  architectural review have already been paid for. The split is pass ① straight
  after the code (phases 1–4, coverage explicitly deferred) and pass ② at the end
  on the delta. Pass ② is cheap only if handed `git diff <pass-1-head>..HEAD`
  plus the pass ① report — a verdict it cannot see is one it may not inherit.
  (2026-08-20)

- **The `commit` link of `AC → step → test → commit` had no author, because no
  agent commits.** `implementer`, `test-writer` and `doc-writer` are all barred
  from `git commit` on purpose, which left the last hop as the only one nothing
  in the chain could fill. It is closed by convention rather than by an agent:
  root `AGENTS.md` — *Commits* — puts `Plan:` and `Steps:` trailers on plan work,
  and `git log --format='%(trailers:key=Steps,valueonly)'` reads them (git 2.54;
  commits without them return an empty field, so existing history degrades
  quietly). `plan-verifier` treats a trailer as **corroborating, never
  substitutive** — it is an author's claim about their own work, the kind that
  agent's rules already discount, so a `MET` still needs `path:line`. What the
  trailers buy is the reverse direction: a commit claiming `Steps: S4` whose diff
  touches nothing S4 named is a disagreement invisible from the diff alone.
  Nothing enforces them — no `commit-msg` hook, and deliberately not a `gates.sh`
  gate, because a false FAIL there teaches people to bypass gates. (2026-08-20)

- **A command must not wrap a stage that stops to ask a human — it makes the stop
  easier to skip, not easier to answer.** `/sdd-spec` and `/sdd-plan` existed for
  one day and were deleted. Both fronted a two-pass agent whose first pass returns
  a question set, an `R-N` recommendation list or an execution-mode gate and
  writes nothing until a person answers. A command reads as something you fire
  and wait for, so wrapping the stop invites skipping it, and skipping it is
  exactly how a spec acquires silent assumptions. `spec-creator` and
  `implementation-planner` are launched by hand for that reason. `/impl` is a
  command because everything downstream of an approved plan has no such stop
  until the reviews return. (2026-08-21)

- **Removing `test-writer` from the flow also collapses `plan-verifier` to one
  pass, and the dependency is not obvious until you trace it.** The two-pass
  split existed for one reason: phase 5 grades `COVERED` versus `CLAIMED`, and
  `COVERED` requires the named test to *exist*, so grading coverage before a
  separate test author had run produced a column of `CLAIMED` that reads exactly
  like a finding. Move test authorship into `implementer` — the `single-agent`
  mode `implementation-planner` already offered — and the tests arrive with the
  code, so the dependency vanishes and phases 1–5 run once. Two-pass mode is kept
  in `plan-verifier` phase 0a for when a separate `test-writer` does run. What the
  removal costs is independence, not coverage: the context that wrote the code
  writes its tests, which is what the split existed to prevent, so `/impl` asks
  one question of every new test — *would this have failed before the change?*
  (2026-08-21)

- **Pick which review agent to downgrade by how it FAILS, not by how important it
  is.** A weakened `architecture-reviewer` produces more unfounded findings —
  noise, which the reader sees and discards. A weakened `plan-verifier` produces a
  *shorter enumeration*, and a short conformance table reads exactly like a clean
  one. A weakened `security-reviewer` misses a traced input, equally invisible.
  So `architecture-reviewer` moved to `sonnet` and the other two stayed on `opus`,
  and the reason is asymmetry rather than rank. Two things make the sonnet pass
  safe rather than merely cheap: that agent already carries the guardrails a
  smaller model needs (never invent a rule this repo has not stated, a preference
  is a `Nit:` that cannot block, §15's sanctioned exemptions are never findings),
  and it is not the security control — `security-reviewer` is. This refines the
  *cheap models buy little here* entry above, which named `plan-verifier`'s
  extraction/verdict split as the one defensible downgrade: the failure-mode axis
  is the more usable one, because it does not require splitting an agent in two.
  `/impl` also supplies the guard that entry asks for by name — a `grep` for the
  plan's `S<n>` steps, passed in and checked against the returned table.
  (2026-08-21)

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

- **Editing `routing.md` or `gates.sh` does NOT invalidate a single cached
  review group — only `SKILL.md` blobs and the group's own files do.**
  `cache_key()` hashes the group name, each reviewed file's blob, and whatever
  skill-file paths the caller passes; `routing.md` and `gates.sh` are passed to
  neither, so they are invisible to it. Verified during the L04 review: three
  client groups still returned HIT after both files changed. This **supersedes
  the parenthetical in this file's own Open Questions** — twice, in the
  `reviewer-core/test/**` and `severity.md` §3.2 entries — which claims that
  fixing them "invalidates the cached findings of every group reviewed against
  `pr-self-review`'s own files". It does not, and treating a routing change as
  a cache flush hides that the newly-routed files have never actually been
  reviewed. If you want a genuine flush it is `rm -rf .git/devdigest/cache`,
  which `report-format.md` already documents. (2026-08-12)

- **Whether a `PreToolUse` hook should fail open or fail closed follows from its
  matcher's blast radius, not from a house style.** `pr-guard.sh` matches `Bash`,
  so it runs on every shell call in every session and a bug in it would brick the
  session — it allows anything it cannot answer. `spec-write-guard.sh` matches
  `Write|Edit` but exits 0 immediately unless `agent_type` is `spec-creator`, so
  its blast radius is one agent; past that gate it blocks anything it cannot
  verify, including a missing `file_path` and a missing `jq`. Both are correct
  and they read as contradictory in the same directory, so each header says which
  it is and why. Decide the radius first, then the failure direction.
  (2026-08-20)

- **A new `.claude/agents/<name>.md` is picked up mid-session — no restart.**
  Writing `spec-creator.md` produced a system message announcing the new agent
  type to the running session within the same turn, meaning a frontmatter error
  surfaces immediately rather than at the next launch. Only *registration* was
  observed this way; the agent was not invoked, so nothing here says a
  mid-session pickup is fully equivalent to a fresh start. (2026-08-20)


- **`.claude/skills/security/SKILL.md` is written against Express + MongoDB +
  Mongoose + JWT, and this repo is Fastify + Drizzle + Postgres with no
  authentication layer at all.** Its MongoDB operator-injection and `jwt.decode()`
  sections describe code that does not exist here, and most of A01/A07 with them
  — verified: `server/src/app.ts` registers `helmet` (:89), `cors` with an
  explicit `config.webOrigin` (:90) and a rate limit (:96, skipped when
  `nodeEnv === 'test'`), and there is no auth hook anywhere in `server/src`. An
  agent built on this skill will manufacture findings to fill the empty
  categories unless told not to, so `.claude/agents/security-reviewer.md` carries
  the mismatch as an explicit non-negotiable and starts from this repo's own
  surfaces instead: the `INJECTION_GUARD` slots (`reviewer-core/src/prompt.ts:25`
  and `:213`), the GitHub PAT set as a URL *password* in
  `server/src/modules/repos/helpers.ts`, and the argv form `spawn(rg, [...])` at
  `server/src/adapters/codeindex/ripgrep.ts:60`, which is **not** command
  injection and must not be flagged as one. (2026-08-20)

- **With `Edit` unavailable, a self-checking agent rewrites whole files.**
  `spec-creator` issued 10 `Write` calls against 2 paths in one session — five
  full rewrites each — because its Phase 6 self-check fixes findings one at a
  time and `Edit` returned `No such tool available: Edit. Edit is disabled for
  this session, in subagents as well as here.` A one-word correction cost a
  ~30 KB write. When `Edit` is off, tell the agent to batch its corrections into
  one pass rather than fixing as it finds. (2026-08-22)

## Recurring Errors & Fixes

_(no entries yet)_

- **`git log --format='%(trailers:key=Steps)'` returns EMPTY on a commit that
  visibly has `Steps:` in it** → a blank line sits between the plan trailers and
  `Co-Authored-By`. Git parses only the LAST paragraph of a message as trailers,
  so `Plan:`/`Steps:` followed by a blank line are prose, not trailers, and the
  command root `AGENTS.md` documents reads nothing. Both L05 feature commits
  were written that way, verified empty, and rebuilt with the three trailers in
  ONE block, no blank line. Check with the documented command right after
  committing — the message looks correct in `git show` either way. (2026-08-25)


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

- **2026-08-08** — L03 homework, Smart Diff, S1–S10b built through `implementer`
  / `test-writer` with `architecture-reviewer` and `plan-verifier` over the
  result, then `/pr-self-review`. The orchestration worked: two disjoint package
  lanes ran in parallel after the contract landed, and both reviewers found real
  defects the passes had missed (a ring-2 row leak, a lint blind spot, a severity
  enum the client had already drifted). What did **not** work was trusting
  measurements the environment could not make — three fix rounds went into a
  scroll that neither jsdom nor a non-painting browser pane can observe, and the
  correction only came from checking `document.visibilityState`. Two of the
  plan's own premises turned out false under live data (see *What Doesn't Work*),
  both found by running the feature against a real imported PR rather than the
  seed, which could not exercise it at all. Ended `CLEAN` at 0 blockers after one
  HIGH and three MEDIUMs were fixed inside the run.

- **2026-08-12** — L04, the `devdigest-mcp` stdio server, built by `implementer`
  from `docs/plans/L04-mcp-server.md` in one pass (272 k tokens, 144 tool calls,
  28 min) and then reviewed with `/pr-self-review`. The plan survived contact
  almost intact; the one substantive deviation was forced by a tooling
  interaction it could not have predicted (a `zod/*` path alias against the MCP
  SDK's dual zod-3/zod-4 declarations, `TS2589` on every `registerTool`).
  Review round 1 returned 1 HIGH and 4 MEDIUM, round 2 zero of each. Two of the
  five came straight from the implementer's own handoff section, one was a
  latent defect in `gates.sh` that this change set made reachable, and one — the
  routing gap — existed only because the "Not reviewed" table forces the report
  to admit what it skipped. Every fix was demonstrated red before acceptance,
  which caught nothing new but cost about four minutes total. The verdict
  mechanism itself behaved exactly as designed: committing nothing, changing
  three files, and watching the fingerprint invalidate the round-1 token.

- **2026-08-20** — Built `spec-creator` (`.claude/agents/spec-creator.md`), the
  eighth agent and the first one whose write path is enforced rather than
  promised: `.claude/hooks/spec-write-guard.sh`, registered on `Write|Edit` in
  `.claude/settings.json`, confines it to `<package>/docs/specs/*.md`. Chosen
  over the agent's own `hooks:` frontmatter because that form is skipped unless
  workspace trust was accepted. Verified against nine payloads (other agent,
  main session, valid spec, absolute path, source file, root `docs/specs/`,
  `..` traversal, missing path, spoofed path in `content`). Agent design settled
  by asking the user four questions rather than assuming: two-pass agent over
  skill, per-package filename with repo-global `SPEC-NN`, two new template
  sections for design analysis, Ukrainian body with the given headings. Spec
  authorship moved off `doc-writer`, and the four `docs/specs/README.md` files
  gained the template convention. The agent has not been run end to end.

- **2026-08-20** — Renamed `planner` to `implementation-planner` and narrowed it
  to implementation only: new *Non-negotiables 8* (plans how, never what), a
  rewritten phase 0 that refuses an outcome-less request to `spec-creator`
  instead of inventing one, a new phase 2 (requirements review → `R-N`
  recommendations → the single-agent/multi-agent gate, folded into one block and
  one round), and three new report sections — *Execution*, *Requirements review*,
  *Recommendations*. The rename had already been applied across `.claude/`;
  what it left behind was mechanical damage the longer name caused — a
  misaligned composition diagram and eight prose lines past the ~80-column wrap,
  all in `.claude/agents/README.md`. References in `docs/plans/L03-*.md` and
  `L04-mcp-server.md` still say `planner` and were left alone as historical lab
  records. None of the three agents has been run since.

- **2026-08-20** — Follow-up on the entry above: the `planner` references in
  `docs/plans/L03-agents.md`, `L03-intent-layer.md`, `L03-smart-diff.md` and
  `L04-mcp-server.md` **were** renamed after all, on the maintainer's call, so
  the sentence above saying they were left as historical records is superseded.
  The three "Produced by the … agent" lines carry a parenthetical naming the old
  id, because the fact that a plan was produced under a different agent name is
  part of what those files record. Renaming inside a prose paragraph is not a
  free `sed`: `implementation-planner` is 15 characters longer than `planner`,
  so five paragraphs re-flowed past the ~80-column wrap and had to be rewrapped
  by hand — the same mechanical damage the rename did to
  `.claude/agents/README.md`.

- **2026-08-20** — Extended `spec-creator` on four axes: `Agent(researcher)` with
  parallel fan-out and a one-question-per-brief rule; scoped `INSIGHTS.md`
  reading; a `## Traceability` section binding every `AC`/`NFR` to
  unit/integration/e2e/manual plus a test-name handle, which closes the spec's
  end of `AC → step → test → commit`; and numbered `NFR-N` with thresholds that
  can be failed. Phase 6 grew into a real final self-check across four groups,
  reported as a pass/fail line. Also applied the earlier analysis: the `SPEC-NN`
  allocation race is now reported rather than silently resolved, a cross-package
  feature is written as both files in one pass, pass A carries a literal marker
  line, phase 1 checks for contradiction with existing specs, size past ~12 KB is
  reported because the file is re-read into every review, and `security/SKILL.md`
  is read by path on the `routing.md` §3 triggers. Extracted
  `.claude/skills/acceptance-criteria/SKILL.md` and wired all three consuming
  agents to it. Still open and still a product call: this repo has no
  accessibility skill, so `spec-creator` writes the requirement and flags the
  missing standard rather than pretending one exists. Nothing was run.


- **2026-08-20** — Audited the SDD pipeline end to end, then applied the result in
  three rounds. Round one: the post-`implementer` fan-out in
  `.claude/agents/README.md` was wrong on three edges — a reviewer racing
  `test-writer`'s writes, a single `plan-verifier` pass, `doc-writer` inside the
  fan-out — so it became a sequence with the verifier split in two; `gates.sh`
  gained `--unit` and `implementer` phase 3 collapsed to one call; skill
  citations gained resolving anchors. Round two: `.claude/commands/` with
  `/sdd-spec`, `/sdd-plan` and `/sdd-build`; `plan-write-guard.sh` plus `Write`
  for `implementation-planner`, tested across 11 payloads and cross-checked
  against `spec-write-guard.sh` so neither guard reaches the other's agent or
  folder; three small corrections. Round three: `security-reviewer` — the eighth
  agent, and the only one that may decline its own pass — and the commit-trailer
  convention. Verified locally throughout: `gates.sh --unit` green on every
  package, guard exit codes asserted payload by payload, and every `path:line`
  cited in the new agent read back from the file it names. Nothing was committed.

- **2026-08-21** — Cut the SDD pipeline down on cost, then spent most of the
  session paying for the cuts. `/sdd-spec` and `/sdd-plan` deleted and
  `/sdd-build` renamed `/impl`, leaving one command; `test-writer` out of the
  flow with `implementer` writing the plan's tests; `architecture-reviewer` to
  sonnet. Each of those had a second-order consequence that had to be traced
  rather than assumed: dropping `test-writer` collapsed `plan-verifier` to a
  single pass, the model question turned out to be about failure modes rather
  than importance, and removing the early verifier pass cost a rejection point
  that had to be named and given an escape hatch. Six `/pr-self-review` runs, five
  of which found something — three of those in this gate's own earlier output —
  ending `CLEAN` at `4e1e328`. Nothing was pushed.

- **2026-08-21** — Correction to the 2026-08-20 entry above, which records
  shipping `.claude/commands/` with `/sdd-spec`, `/sdd-plan` and `/sdd-build`.
  **All three were deleted the next day and none of them exists.** The directory
  now holds one command, `/impl`, covering the third stage only; the two agents
  the deleted commands fronted, `spec-creator` and `implementation-planner`, are
  launched by hand. That entry is not wrong about what happened on 2026-08-20 and
  is left as written, per this file's append-only rule — but read on its own it
  names three commands a reader would then fail to find. The reason they went is
  in *A command must not wrap a stage that stops to ask a human*, under Codebase
  Patterns.

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

- `.claude/skills/pr-self-review/severity.md` §3.2 lists "a direct edit to
  `*/src/vendor/**`" on the closed BLOCKER list, but `server/AGENTS.md` states
  that `server/src/vendor/shared/**` **is** the source and is exactly where a
  contract change must be made. The two cannot both be right, and a run that
  changes a contract has to choose. The `vendor-sync` gate already resolves it
  correctly — it checks that both copies moved together rather than forbidding
  the edit — so the wording looks like the stale half. Settles by a maintainer
  narrowing §3.2 to `client/src/vendor/**`; until then a reviewer has to know
  that the gate, not the prose, is the authority. Note the fix invalidates every
  cached group reviewed against `pr-self-review`'s own files, so it belongs in
  its own change.

- The spec template numbers acceptance criteria `AC-1…AC-N` so a plan can bind
  `T1 … → AC-1 → test_facts` and `plan-verifier` can grade an
  `AC → task → test → commit` matrix. Neither agent knows about `AC` ids:
  `planner.md` writes steps that name files, and `plan-verifier.md` enumerates
  plan items, not criteria. So the traceability the spec format was designed for
  currently stops at the spec. Settles by updating both agents, or by deciding
  the matrix lives only in the plan.

- `.claude/skills/security/SKILL.md` is a general-purpose OWASP file for a stack
  this repo does not run — Express, MongoDB, Mongoose, JWT — and roughly half its
  body can never apply here. `security-reviewer` bridges the gap inside its own
  prompt, which works but pays for the mismatch on every run and leaves the same
  trap for `/pr-self-review`, which routes the identical file. Settles by a
  maintainer call: fork a repo-specific security skill, add a DevDigest section
  to this one and mark the rest as reference, or accept the bridging. Note that
  editing a `SKILL.md` **does** invalidate the cached findings of every group
  reviewed against it — the cache key hashes skill blobs, unlike `routing.md` and
  `gates.sh` — so it belongs in its own change.
