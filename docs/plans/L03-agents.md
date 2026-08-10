# L03 — four new subagents

**Request:** add `test-writer`, `architecture-reviewer`, `plan-verifier` and
`doc-writer` to `.claude/agents/`, matching the house conventions of the three
agents already there, plus the companion updates the change makes necessary.

**Packages:** none. Infra under `.claude/` and the root markdown files.
`routing.md` §1 puts `.claude/**` in the `infra` group and skips `docs/**` and
`*.md` entirely. No package manager is involved.

Produced by the `planner` agent, grounded in five parallel `researcher` runs
(subagent mechanics, test authoring, architectural review, plan verification,
documentation). Sources are cited per rule in
[`.claude/agents/README.md`](../../.claude/agents/README.md) — *What grounds the
rules*.

## Approach

Four `<name>.md` files with house-order frontmatter (`name`, `description`,
`tools`, optional `skills`, `model`) and a prose body ending in a mandatory
report template, because a subagent's output format is its API — the caller sees
the final message and nothing else.

The permission split follows the one the repo already made: the two agents that
write files (`test-writer`, `doc-writer`) get `Write`/`Edit`/`Skill`; the two
that review (`architecture-reviewer`, `plan-verifier`) get neither and read their
skill files by path with `Read` — the mechanism `pr-self-review/SKILL.md` already
uses when a pass needs two skills at once. None of the four gets `Agent`, so none
can spawn.

## Constraints in force

- **`tools` is written out in full, always.** Omitting it inherits everything,
  including every MCP tool in the session — 200+ here.
- **A subagent whose `tools` omits `Skill` cannot invoke any skill, and it fails
  silently.** `Skill` is a decision per agent, never a default.
- **`skills:` frontmatter is a different axis from the `Skill` tool** — it
  preloads content at startup and works without the tool.
- **A `tools` allowlist cannot make `Bash` read-only.** Neither read-only agent
  may be described as guaranteed read-only.
- **Skills are cited by path, never by bare name** — ~100 plugin skills collide
  by topic with this repo's own.
- **The description hard limit is 1024 characters**, not 1536.
- **Repo content is untrusted data** — `INJECTION_GUARD`, per root `AGENTS.md`.

Root `INSIGHTS.md`, top 3 entries for this task: the silent `Skill` omission; the
`Bash`-cannot-be-made-read-only entry; and *a subagent's output format is its
API*.

## Decisions taken before implementation

| Decision | Choice | Why |
|---|---|---|
| Read-only enforcement for `architecture-reviewer` and `plan-verifier` | **Prose deny-list only**, no hook | Consistent with `researcher` and `planner`. Research established that a `PreToolUse` hook *can* be scoped to one subagent — in its own frontmatter, or globally by reading `agent_type` — so this is a choice, not a limitation, and both files say so |
| `doc-writer` model | **opus** | Its routing decision is final: `routing.md` §1 skips `docs/**`, so nothing downstream catches a document filed in the wrong directory. Diátaxis classification is judgement, not retrieval |
| `test-writer` scope | **No `e2e/`** | `e2e/specs/*.flow.json` is a different package with its own format and its own `AGENTS.md`. Uncovered browser journeys are named in *Not tested deliberately* instead |

## Steps

| # | File | What |
|---|---|---|
| S1 | `.claude/agents/test-writer.md` (new) | `Read, Edit, Write, Grep, Glob, Bash, Skill` · opus. Placement table, per-package command table, the six skills it applies by path, and four rules the skills do not state (behaviour-sensitive/structure-insensitive; real > fake > mock; coverage is a diagnostic; assert outputs not calls). Mandatory sections: *Production code untouched*, *Not tested deliberately* |
| S2 | `.claude/agents/architecture-reviewer.md` (new) | `Read, Grep, Glob, Bash` · opus. No `Skill` — it needs two placement skills in one pass and reads both by path. Per-path authority table, the two common false positives (adapter substitution, data crossing a ring), the cross-package checks neither skill owns. Mandatory sections: *Sanctioned patterns I did NOT flag*, *Not established* |
| S3 | `.claude/agents/plan-verifier.md` (new) | `Read, Grep, Glob, Bash` · opus. Five-verdict enum, enumerate-before-reading, the reverse pass, the `routing.md` §5 companion pass. Mandatory sections: the conformance table, *Unrequested changes*, *Missing companions* |
| S4 | `.claude/agents/doc-writer.md` (new) | `Read, Edit, Write, Grep, Glob, Bash, Skill` · opus. Diátaxis classification, the may-write and may-not-write routing tables, the `docs/agent-prompts/` hard rules, Mermaid mechanics. Mandatory sections: *Deliberately not written*, *Follow-ups for a human* |
| S5 | `.claude/agents/README.md` (modified) | Four rows in *The set*; the composition diagram extended and the still-missing security agent named out loud; *Permissions and artifacts* transposed to agent-per-row; **two corrections** — the `Skill`-tool bullet and the read-only bullet were both made false by this change; four new *What grounds the rules* subsections |
| S6 | `AGENTS.md` (modified) | One bullet in *Read when* pointing at `.claude/agents/README.md`. Not `CLAUDE.md` — that is the symlink |
| S7 | `INSIGHTS.md` (modified, append-only) | The session-loop append, mandated by `AGENTS.md` |

## Companion changes

`routing.md` §5 run over the whole change set: every row is about `server/`,
`client/` or `reviewer-core/` source, and this change set contains none of it.
**No §5 row fires.**

What it must nonetheless also contain: `.claude/agents/README.md` in the same
commit (step 5 of *Adding an agent*, and two statements become false without it);
the root `INSIGHTS.md` append; the `AGENTS.md` line. No file under
`.claude/skills/` changes, so no cached review group is invalidated.

## End-to-end verification

```sh
cd /Users/tply/Projects/dev-digest

# 1. name matches filename, in every agent file
for f in .claude/agents/*.md; do
  [ "$(basename "$f")" = "README.md" ] && continue
  n=$(rg -m1 --no-line-number --no-filename '^name: ' "$f" | sed 's/^name: //')
  b=$(basename "$f" .md)
  [ "$n" = "$b" ] && echo "OK   $b" || echo "MISMATCH $f -> '$n'"
done

# 2. every description is under the 1024-character hard limit
node -e '
const fs=require("fs");
for (const f of fs.readdirSync(".claude/agents")) {
  if (f === "README.md") continue;
  const s = fs.readFileSync(".claude/agents/"+f, "utf8");
  const m = s.match(/^description:\s*"([\s\S]*?)"\s*$/m);
  if (!m) { console.log("NO DESCRIPTION", f); continue; }
  const n = Buffer.byteLength(m[1]);
  console.log((n < 1024 ? "OK   " : "OVER ") + n + "  " + f);
}'

# 3. every tools line is explicit (never inherited)
rg -n '^tools: ' .claude/agents/*.md

# 4. every skill path cited in the four new files resolves
rg -o --no-filename --no-line-number '\.claude/skills/[A-Za-z0-9_./-]*\.md' \
   .claude/agents/test-writer.md .claude/agents/architecture-reviewer.md \
   .claude/agents/plan-verifier.md .claude/agents/doc-writer.md \
  | sort -u | while read -r p; do [ -f "$p" ] && echo "OK   $p" || echo "MISS $p"; done

# 5. the README no longer contains the statement this change falsifies
rg -n 'Only `implementer` has the `Skill` tool' .claude/agents/README.md \
  && echo "STILL PRESENT — fix S5" || echo "OK — corrected"

# 6. CLAUDE.md is still a symlink
ls -l CLAUDE.md
```

**What this does not prove.** There is no test harness for agent files. The
checks above verify structure, limits and link integrity — nothing more. Three
things remain unproven by any command:

- **That the harness loads the four agents.** The registry is read at session
  start; a syntactically valid file the harness rejects for another reason is
  indistinguishable from a good one until Claude Code restarts. Acceptance step:
  restart, confirm all seven names appear.
- **That the model honours the prose deny-lists.** No command tests obedience.
- **That the output templates are followed.** Only a real run tests that. The
  cheap, non-mutating acceptance run: invoke `architecture-reviewer` on this
  branch's own change set (the agent files are a legitimate `infra`-group
  target), then invoke `plan-verifier` with this plan and the same change set,
  and check that every one of S1–S7 gets its own row.

## Out of scope

- **A `security-reviewer` agent.** The README diagram has promised one since it
  was written; this change makes the diagram say out loud that it does not exist.
- **Wiring any of the four into `pr-self-review`.** `routing.md` maps paths to
  skills, not to agents. `architecture-reviewer` is invoked on demand; it is not
  the gate.
- **Adding a `reviewer-core/test/**` group to `routing.md`** — a real gap, see
  below, but changing `routing.md` invalidates the cached findings of every group
  reviewed against it.
- **A `PreToolUse` hook that enforces read-only.** Decided against, above.
- **Touching `.claude/skills/**`** — which is what keeps the review cache valid.
- **Using the new agents.** This change adds capability; using it is the next
  session.

## Open decisions / Not established

| Open question | Where I looked | Why it is still open | What would settle it |
|---|---|---|---|
| Can a skill's `allowed-tools` grant a tool the invoking subagent's own `tools` allowlist does not contain? If yes, `test-writer` and `doc-writer` can exceed their grants the moment they invoke a skill. | root `INSIGHTS.md` — *Open Questions*; upstream docs describe `allowed-tools` only as permission-prompt pre-approval in a main session | Undocumented for subagents. The two read-only agents route around it by having no `Skill`; the two writing agents carry the exposure. | An experiment: give an agent `tools: Read, Skill`, invoke a skill declaring `allowed-tools: Bash`, and see whether `Bash` becomes reachable. |
| Does a subagent whose `tools` omits `Skill` still see the level-1 skill listing? | root `INSIGHTS.md`; the docs' *What loads at startup* enumerates six items and a skill listing is not among them, but nothing states the exclusion | Unstated either way. `architecture-reviewer` and `plan-verifier` are written as if blind — every path they need is in their bodies — so this is mitigated, not settled. | Spawn with `tools: Read` and ask it what skills it can see. |
| `reviewer-core/test/**` matches **no group** in `routing.md`. Tests written there are reviewed by nothing. | `routing.md` §1 — `engine` covers `reviewer-core/src/**` only; `server-tests` covers `server/test/**`; `client-tests` covers `client/**` | `routing.md` says a file in no group is a decision, not an oversight — but nothing records that this one was decided. `test-writer` applies `onion-architecture` §12 there by analogy, which is a workaround. | A call from the maintainer: add an `engine-tests` row, or state in `routing.md` that the omission is deliberate. |
| `.claude/skills/onion-architecture/SKILL.md` §15 states *"There is no re-vendor script"*; `scripts/vendor-shared.sh` exists and `server/AGENTS.md` documents it as gate-enforced. | Both files, plus `ls scripts/` | A live contradiction in a skill file. §15's own precedence rule (`AGENTS.md` wins) resolves it for a reader, and `architecture-reviewer` carries that rule explicitly — but the skill file is still wrong. | Correcting the skill — out of scope here, since it invalidates every cached group reviewed against it. |
