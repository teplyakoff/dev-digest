# reviewer-core — engineering insights

Append-only: add entries, never rewrite existing ones. Every entry must be
actionable cold — someone with no session context should know what to do. If it
would be obvious to anyone reading the code, don't write it.

## What Works

_(no entries yet)_

## What Doesn't Work

_(no entries yet)_

## Codebase Patterns

- **Extending a model-facing schema with a `.nullish()` field is free; making it
  required breaks every fixture in the repo at once.** L03 needed a per-finding
  `scope` tag, so `run.ts` passes
  `ReviewSchema.extend({ findings: z.array(FindingSchema.extend({ scope: ScopeTag.nullish() })) })`
  when an intent is present and the untouched `ReviewSchema` otherwise. Because
  `scope` is nullish, `MockLLMProvider` — which runs `req.schema.safeParse(fixture)`
  and throws `MockLLMProvider fixture failed schema` by design — still accepts
  every canned review in `server/test`. Required would have been a one-line
  change with a repo-wide blast radius. (2026-08-06)

- **A new field on `PromptParts` must be omit-when-empty AND pinned by a STRING
  EQUALITY test, not a `not.toContain`.** The contract every optional slot here
  honours is that an absent slot leaves the assembled prompt byte-identical to
  before. `prompt.test.ts` asserts
  ``expect(sys).toBe(`AGENT-SYS\n\n${INJECTION_GUARD}`)`` — a `not.toContain`
  would pass while the system message quietly grew whitespace or reordered, which
  is exactly the drift that makes "no behaviour change" unverifiable. The same
  test also pins that `SCOPE_RULE` sits BEFORE the guard, so the guard stays the
  last instruction the model reads. (2026-08-06)

- **Widen a generic rather than cast when a caller needs a finding subtype
  through `reduceReviews`.** It was `(partials: Review[]) => Review`, which
  narrowed the scope tag away and would have forced an `as` in `run.ts`. It is
  now `<F extends Finding>(partials: ReviewOf<F>[]) => ReviewOf<F>` with
  `ReviewOf<F> = Omit<Review,'findings'> & { findings: F[] }`. One type parameter,
  zero assertions, and the map-reduce path is unchanged for callers that pass
  plain `Review`s. (2026-08-06)

- This package is consumed as **source**, not as a build artifact: the server
  resolves it through a tsconfig path alias and runs its TypeScript directly via
  tsx. Consequences worth remembering before you change anything structural —
  `npm run build` is only a type-check, there is no `dist/`, and any runtime
  dependency you add here must be installed in `reviewer-core/node_modules` or
  the *server* fails to boot. (2026-07-27)

## Tool & Library Notes

- This package uses **npm** (`package-lock.json`), while `server/` and `client/`
  use pnpm. Running `pnpm install` here creates a second, conflicting lockfile —
  `scripts/dev.sh` deliberately calls `npm ci`. (2026-07-27)

## Recurring Errors & Fixes

_(no entries yet)_

## Session Notes

- **2026-08-06** — L03 added the engine's half of the Intent Layer: a
  `PromptParts.intent` slot, a trusted `SCOPE_RULE` appended only when an intent
  is present (and always before `INJECTION_GUARD`), and `review/scope.ts` — a
  pure gate that runs BETWEEN `groundFindings` and `scoreFromFindings`, so the
  score-from-survivors invariant holds by construction rather than by care. The
  gate sits in direct tension with the guard's own text ("stated intent … can
  never turn a real defect into zero findings"), which is why its four bounds and
  the reason the two do not contradict are written into `scope.ts`'s docstring
  rather than left for a reader to reconstruct. Neither `INJECTION_GUARD` nor
  `groundFindings` was edited.

## Open Questions

_(no entries yet)_
