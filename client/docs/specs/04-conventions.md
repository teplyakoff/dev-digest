# 04 — Conventions Extractor (client)

Owns: `/repos/:repoId/conventions` — the candidate queue, the edit modal, and
the create-skill modal.

Plan: [`docs/plans/L02-conventions.md`](../../../docs/plans/L02-conventions.md).
Server: [`server/docs/specs/04-conventions.md`](../../../server/docs/specs/04-conventions.md).

## Problem

The extractor's output is a *review queue*, not a report. A person has to be able
to disbelieve any single candidate quickly — which means the evidence has to be
one click from the real file, and reject has to be as cheap as accept. The page
is judged by how fast someone can throw away a bad suggestion.

## Design source

`_assets/L02/DevDigest Design (standalone) (3).html` → `screen_conv_conf.jsx`
(`ScreenConventions`, `ConventionCard`, `CreateSkillModal`, the empty state).
Port it; deviate only where noted below.

Two deviations, both required by the assignment:

1. **Edit a candidate.** The design has Accept and Reject and no third action.
   The assignment requires editing a rule before it becomes a skill. Add a ghost
   `Pencil` button as the third item in the card's existing 150 px button column
   — no new layout — opening a small modal over `rule` + `category`.
2. **Reject is a state, not a disappearance.** The design's Reject button has no
   handler. A rejected card stays in the list, dimmed (`opacity: .55`) with a
   grey left border and the button flipped to "Rejected — undo". Removing it
   would make an accidental reject unrecoverable, and it is the one action with no
   confirmation.

Everything else — the italic rule line, the evidence panel (mono path header +
copy icon + `<pre>` snippet), the confidence bar with its `≥ 0.85 → ok / else
warn` threshold, the 3 px status-coloured left border, the toolbar's "Accept all
/ Deselect all · N of M accepted · Create skill" — is ported as drawn.

## Route

`client/src/app/repos/[repoId]/conventions/page.tsx`, repo-scoped like
`/repos/[repoId]/pulls`: `useParams`, `useActiveRepo`, `useRepoNotFound`,
`AppShell`, `Skeleton` / `EmptyState` / `ErrorState` for the three non-happy
states.

```
app/repos/[repoId]/conventions/
  page.tsx · styles.ts · constants.ts · helpers.ts
  _components/
    ConventionsToolbar/
    ConventionCard/
    EditConventionModal/
    CreateSkillModal/
```

States, in the order a first-time user meets them:

| State | Render |
|---|---|
| never scanned (`scan: null`) | `EmptyState` — icon `ListChecks`, copy already in `messages/en/conventions.json` → `page.empty`, CTA "Run extraction" |
| extracting | the CTA becomes `page.scanning` and disables; existing cards stay visible and dim |
| `409 not_indexed` | `ErrorState` with a "Re-index" action calling `POST /repos/:id/resync` (`useResyncRepoIntel` already exists in `lib/hooks/repo-intel.ts`) |
| `409 not_cloned` | `ErrorState`, no action — the repo import owns this |
| scanned, kept 0 | `EmptyState` variant naming the drop count: "12 candidates proposed, none survived evidence checks" |
| scanned | header + toolbar + cards |

The header renders the scan's real numbers rather than the design's hardcoded
"84 sample files": `{sampled + config} files sampled · {kept} of {proposed} kept
· scanned {relative time}`. The dropped count is a plain hover title listing the
reasons — the feature's credibility is the drop rate, so it is on screen, not in
a log.

## Evidence links

The mono path in each card's evidence header is a real link, not the design's
inert `MonoLink`:

```ts
githubBlobUrl(repo.full_name, scan.indexed_sha, c.evidence_path,
              c.evidence_start_line, c.evidence_end_line)
```

Pinned to `indexed_sha` — the SHA the sample was read at — so the line numbers
still point at the code the snippet shows even after the branch moves. Opens in a
new tab (`target="_blank" rel="noopener noreferrer"`). This is an acceptance
criterion, so it also gets a test.

## Create-skill modal

Opened from the toolbar; enabled only while at least one candidate is accepted.

On open it fetches `GET /repos/:id/conventions/skill-draft` — the body is built
on the server from the accepted set. The modal does **not** merge candidates
client-side (the design's `conventionsToDraft` helper is the thing being replaced);
it edits Name / Description / Type / Enabled / Body and posts the result to
`POST /repos/:id/conventions/skill`.

The body field reuses the existing `SkillBodyEditor` from
`app/skills/_components/` rather than the design's `CodeEditor`, so the skill
markdown is edited in exactly one component in this app.

The design's footer note ("Saved as v1 · added to Skills Lab") stays and is now
literally true — `SkillsService.create` snapshots v1. On success: toast, close,
and route to `/skills/{id}` so the next step (linking it to an agent from the
Skills tab) is one click away. A `409` duplicate name renders inline on the Name
field with the server's message.

## Nav

`NAV` needs a `conventions` entry. `client/src/vendor/ui/nav.ts` is vendored with
no in-repo source and no re-vendor script, so this is the same known exception
`skills` already took — keep the edit to one object and pin it in app code:

```ts
{ key: "conventions", label: "Conventions", icon: "ListChecks",
  href: "/repos/:repoId/conventions", gKey: "c" }
```

plus `{ keys: "g c", label: "Go to Conventions", group: "Navigation" }` in
`SHORTCUTS` — `nav-registry.test.ts` already fails any `gKey` that is missing
from `SHORTCUTS`, and already asserts g-keys are distinct (`c` is free).

Add the row to that test's `it.each` table. `activeKeyFor()` in
`components/app-shell/helpers.ts` already returns `"conventions"` for a path
containing `/conventions` — no change there.

## i18n

`messages/en/conventions.json` exists and already covers the page header, the
empty state and the confidence label. Extend it; do not restructure it. New keys:

- `card.reject` / `card.rejected` / `card.undo` / `card.edit` / `card.viewOnGitHub`
- `card.category.*` — one label per `ConventionCategory` value
- `toolbar.acceptAll` / `toolbar.deselectAll` / `toolbar.accepted` / `toolbar.createSkill`
- `scan.summary` (ICU, with `{sampled}` `{kept}` `{proposed}`) / `scan.dropped`
- `edit.*` and `create.*` for the two modals
- `errors.notIndexed` / `errors.notCloned` / `errors.noneSurvived`

`card.acceptAsSkill` in the existing file describes a flow this spec does not
build (accept does not create a skill; the toolbar does). Leave the key —
deleting it is churn — but do not wire it.

## Hooks

`lib/hooks/conventions.ts`, exported from `lib/hooks/index.ts`, matching
`skills.ts`:

```ts
useConventions(repoId)                  // GET, key ["conventions", repoId]
useExtractConventions(repoId)           // POST extract → setQueryData(view)
usePatchConvention(repoId)              // PATCH; optimistic on status, invalidate on rule/category
useConventionSkillDraft(repoId, open)   // GET skill-draft, enabled: open
useCreateConventionSkill(repoId)        // POST skill → invalidate ["skills"] and ["conventions", repoId]
```

Accept/reject is optimistic — it is a one-key flip and the queue is unusable if
every click waits on a round-trip. Edit is not: the rule text is what the skill
will contain, so it is written before it is shown as written.

## Verification

Component tests (Vitest + RTL, the `SkillCard.test.tsx` pattern):

- `ConventionCard` renders the rule, the snippet verbatim, and a link whose
  `href` is the `githubBlobUrl` for the cited path, SHA and line range;
- accept → reject → undo walks the three states, and a rejected card stays
  mounted;
- the edit modal writes `rule` and `category` and does not fire on cancel;
- the toolbar's Create-skill button is disabled with zero accepted;
- `nav-registry.test.ts` gains the `conventions` row.

Manual, on a real repo — the acceptance criteria, in order: run the extractor,
click an evidence link and land on the right lines on GitHub, edit one rule,
reject one candidate, create the skill, confirm the rejected rule's text is
absent from the body, link it to an agent, run a review.
