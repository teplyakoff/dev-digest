# 05 — Intent Layer (client)

Owns: `IntentCard`, the two intent hooks in `lib/hooks/reviews.ts`, and the run
trace's new "PR intent" prompt block.

Plan: [`docs/plans/L03-intent-layer.md`](../../../docs/plans/L03-intent-layer.md).
Server: [`server/docs/specs/05-intent-layer.md`](../../../server/docs/specs/05-intent-layer.md).

## Where the card goes, and why there

**Top of `?tab=findings`** — the tab labelled **"Agent runs"** — as the first
child of its `<section>`, above the live-run block.

The requirement says "before the review results", and on this page that is
literally the top of `FindingsTab`: `?tab=overview` renders only `pr.body`. The
design bundle puts an `IntentBlock` inside `BriefCard` on a PR-Brief Overview
card, but the rest of that brief — blast radius, risks, history — is unbuilt.

**This reverses when the PR Brief is built:** the card moves into `BriefCard` on
Overview and the Findings tab keeps nothing.

## Component

`_components/IntentCard/` — `IntentCard.tsx`, `styles.ts`, `IntentCard.test.tsx`.
Route-local, because one route consumes it. **No `index.ts`**: barrels are
forbidden for new code, so `FindingsTab` imports `../IntentCard/IntentCard`
directly. Every sibling in that folder has a barrel; they predate the rule.

Purely presentational — props in, JSX out, no fetching, no derived state in
`useState`. `FindingsTab` owns `usePrIntent` / `useDeriveIntent` and passes the
results down, which keeps the card testable and adds **zero** props to
`FindingsTab` (it already takes 14).

Three states: derived, never-derived (a muted line + "Derive intent"), and stale
(`head_sha` differs from the PR's → a "Derived against an older commit" badge).

### The provenance footer has no design, and ships anyway

The design bundle's `INTENT` mock is `{intent, in_scope, out_of_scope}` — no
confidence, no sources, no missing context. Everything in the footer is invented.

It ships because the single most load-bearing requirement —
*"an unreachable link must not be silently replaced by invention"* — has no other
carrier. Without a visible, warning-coloured line naming what could not be read,
a thin derivation and a well-sourced one render identically. A `low confidence`
badge sits beside the section label for the same reason.

**Open:** whether a muted text line is the right treatment, or whether this wants
a design pass.

## Hooks

In the existing `lib/hooks/reviews.ts`, which already owns the per-PR review
domain — not a new per-feature file. The key `keys.intent(prId)` stays
module-private; `invalidatePrIntent` is the named invalidator for callers that
must say "a run may have re-derived this".

`useDeriveIntent` writes the response straight into the cache with
`qc.setQueryData`, the way `useExtractConventions` does: invalidating would flash
the card back through its loading state immediately after the user watched it
finish.

## Trace drawer

`TraceBody` renders one more `PromptBlock` for `trace.prompt_assembly.intent`,
guarded by `!= null` — every trace persisted before L03 has no such key, and the
contract is nullish for exactly that reason. `PROMPT_COLORS.intent` and
`runs.trace.prompt.intent` come with it.

The block contains the rendered intent — summary, scope lists, source refs — and
**no fetched file content and no diff**.

## Two client-specific traps this change had to respect

- **Contract imports stay type-only.** `import type { PrIntentRecord }`. A value
  import from `@devdigest/shared` drags the whole `export *` barrel plus `zod`
  into the shared chunk — ~15 kB First Load JS on every route, measured. After
  this change the shared bundle is still 102 kB.
- **`pnpm build` is the only thing that catches the webpack `.js`→`.ts` vendor
  trap**, and it must run with `pnpm dev` stopped or it kills the dev server.

## Testing

- `IntentCard.test.tsx` — the three states, and an assertion on the
  missing-context line specifically. If that assertion is ever deleted, the
  feature's most load-bearing guarantee goes with it.
- `FindingsTab.test.tsx` — **the guard that actually matters.** A component test
  passing the prop by hand proves nothing about whether anything passes it; that
  is exactly how `AgentCard`'s skill-count badge shipped green and invisible.
  This renders the card from a mocked `usePrIntent` through the view that owns
  the hook.

Both use `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
dependency of this package and every existing test here uses `fireEvent`.
