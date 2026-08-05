# L02 homework — evidence

Conventions Extractor and the API Contract Reviewer control experiment.
Recorded with `cd demo && npm run record:conventions`; `summary.json` is written
by that run and holds the exact scan, run ids and costs the frames show.

Plan: [`docs/plans/L02-conventions.md`](../../plans/L02-conventions.md).

## The video

`devdigest-conventions.mp4` — 15 captioned scenes, both halves in one take.

## Conventions Extractor

| Frame | Shows |
|---|---|
| `01-conventions-page` | the page, before a scan |
| `02-candidates-with-drop-count` | what the scan kept, and how many it threw away |
| `03-evidence-links-to-github` | every rule cites a file and line; the link resolves to the real code at the scanned SHA |
| `04-edit-convention` | a candidate's wording is editable — it goes into the skill verbatim |
| `05-rejected-stays-visible` | reject is a state, not a disappearance |
| `06-accepted` | "Accept all" takes the undecided ones and leaves the rejection standing |
| `07-create-skill-modal` | the body merged **on the server** from the accepted set |
| `08-skill-created` | `repo-conventions`, v1, `source: extracted` |
| `09-skill-linked-to-agent` | linked, so it loads on that agent's next run |

The recording **asserts** the load-bearing claim rather than just filming it: it
notes which rule it rejected, reads the draft back from
`GET /repos/:id/conventions/skill-draft`, and throws if that rule's text appears
in the body. The take that produced these frames logged
`draft: 19 rules, rejected rule absent ✓` — 20 candidates, one rejected, 19
merged.

## The control experiment

PR [#4](https://github.com/teplyakoff/dev-digest/pull/4) renames an HTTP route
and a response field. It compiles, type-checks, and updates every in-repo call
site — only deployed clients break.

| Frame | Shows |
|---|---|
| `10-experiment-pr` | the PR under review |
| `11-without-skills-trace` | skills **unlinked**: no `Skills loaded` row, 0 findings, approved |
| `12-with-skills-trace` | skills **linked**: four skills loaded, 3 CRITICAL findings, 3 blockers |
| `13-with-skills-prompt-block` | the skills block in the prompt assembly |

Same agent, same model (`openrouter` / `deepseek-v4-flash`), same PR, same diff.

| | without skills | with skills |
|---|---|---|
| findings | 0 | **3 CRITICAL** |
| blockers | 0 | 3 |
| verdict | `approve` | `request_changes` |
| grounding | 0/0 | 3/3 passed |
| prompt tokens | 4 187 | 6 287 |
| cost | $0.0005 | $0.0010 |

The three findings: the route rename (`repos/routes.ts:38`), the response-field
rename (`contracts/platform.ts:149`), and the client-side copy of the same
contract.

## Two things these frames do not flatter

**The first take of frame 11 was wrong and was thrown away.** The recorder chose
the "without skills" run by finding count — "0 findings must be the run without
skills" — and picked a run that HAD four skills loaded but whose single finding
citation-grounding had dropped. The caption said `skills UNLINKED` over a trace
listing four skills. Selection now reads `trace.config.skills`, which is the only
field that actually answers the question.

**The experiment failed the first time it was run properly, and the skill was at
fault.** With skills linked, the model read the diff correctly, named both
renames in its own words, then approved — because `breaking-change` carried two
rules that both applied ("CRITICAL when the caller is outside this diff" and "if
the diff updates EVERY caller, use WARNING"), and it picked the second. The skill
now separates the two cases; the model's behaviour was reasonable given what it
was told. See `docs/agent-prompts/api-contract-reviewer.md`.
