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

- **Agent-to-agent handoff goes through a written artifact, not a message.**
  A plan produced by `planner` is written to `docs/plans/L<NN>-<slug>.md` — the
  existing convention, see `docs/plans/L02-conventions.md` — and the implementing
  agent is given that path. This follows the upstream guidance to write a
  self-contained spec and execute it from a clean context, and it survives the
  session ending, which a message does not. (2026-08-06)

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
