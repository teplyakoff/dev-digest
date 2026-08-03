# Report format

Three artefacts, three different readers.

| Artefact | Path | Read by |
|---|---|---|
| Group findings (cache) | `.git/devdigest/cache/<key>.md` | the next run of this skill |
| Run report | `.devdigest/pr-self-review/<date>-<short-sha>.md` | the developer |
| Verdict token | `.git/devdigest/verdict` | the PreToolUse hook |
| Run log | `.devdigest/pr-self-review/log.jsonl` | whoever tunes the routing table later |

## 1. A finding

```
- [BLOCKER] server/src/modules/reviews/service.ts:88 — onion-architecture §1
  A use case imports `drizzle-orm` directly, so the service cannot be tested
  without a database.
  Fix: take the query behind the existing `RunRepository` port and inject it.
```

Required, in this order: severity · `path:line` · which skill and which rule ·
one sentence on what is wrong · one line on the fix. No finding without a
`path:line` on a changed line — see [severity.md §4](severity.md).

Suppressed variants keep the same shape under their own heading:

```
- [NOTE] client/src/app/pulls/page.tsx:12 — frontend-architecture §1
  (pre-existing, not introduced here) Component defined inside a route file.
```

## 2. Group cache file

Written after every group pass, read at the start of the next one. Content is
just that group's findings in the format above, with a two-line header:

```
group: client-ui
skills: frontend-architecture, react-best-practices
```

The cache key already covers the group's file blobs **and** the blobs of the
skill files it was reviewed against — pass both to
`collect-diff.sh cache-key`. Editing a skill therefore invalidates every group
reviewed with it, automatically. Nothing else invalidates the cache, so if you
want a clean run: `rm -rf .git/devdigest/cache`.

## 3. Run report

```markdown
# pr-self-review — <verdict>

base <short> → head <short> · <n> files · <n> added lines · <duration>

## Verdict
BLOCKED — 2 blockers, 5 high, 3 notes. Merge is gated until the blockers are gone.

## Blockers
<findings>

## High
<findings>

## Medium and notes
<findings, capped — say how many were dropped>

## Pre-existing, not introduced here
<findings>

## Coverage
| Group | Files | Skills | Source |
|---|---|---|---|
| server-domain | 6 | onion-architecture | reviewed |
| client-ui | 11 | frontend-architecture, react-best-practices | cached |
| e2e | 3 | — | skipped (light) |

## Gates
<the GATE lines from gates.sh, verbatim>

## Not reviewed
<paths that matched no group, and why>
```

**"Coverage" and "Not reviewed" are not optional.** They are the only way a
reader can tell a clean report from a report that quietly skipped half the
change set — the failure this whole skill exists to prevent.

## 4. PR description block

When the verdict is `CLEAN` or `PASS_WITH_NOTES`, end the report with a block
the developer can paste straight into the PR body (`gh pr create --body-file`):

```markdown
## What changed
<one line per package, from the change set>

## Self-review
pr-self-review: PASS_WITH_NOTES (3 high, 2 notes) — see the list below.
Accepted deliberately: <anything left unfixed, with the reason>
```

Do not invent the "what changed" summary from file names alone — it comes from
the diff you just read. If the passes were served from cache and you did not
read the diff, say so instead of guessing.
