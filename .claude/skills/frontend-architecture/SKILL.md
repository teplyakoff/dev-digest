---
name: frontend-architecture
description: "Frontend code organization and architecture for React/Next.js projects. Use when deciding where a file belongs, creating or moving a component, splitting a component that grew too large, or reviewing a diff for structural drift. Covers folder structure, component splitting, constants, utils vs helpers vs lib, types, styles, business-logic placement, and import boundaries."
---

# Frontend Architecture — where code goes

Answers one question: **given this piece of code, which folder does it belong in?**
For code examples and folder trees, see [examples.md](examples.md).
For React semantics — hooks rules, memoization, keys, a11y — see
[react-best-practices](../react-best-practices/SKILL.md). This skill owns placement only.

## Severity Levels

- **CRITICAL** — Wrong placement here compounds: every later file follows the mistake
- **HIGH** — Causes coupling, bundle bloat, or painful refactors
- **MEDIUM** — Hurts consistency and discoverability

---

## 1. Placement Decision Table (CRITICAL)

Find the row, then the column matching how many consumers exist **today** — not how many
you predict.

| Artifact | 1 component | 1 route / feature | 2+ routes / features | App-wide |
|---|---|---|---|---|
| Component | inline in the parent file | `_components/<Name>/` | `components/<name>/` | design-system package |
| Pure function | `helpers.ts` beside it | feature `helpers.ts` | `lib/<what-it-provides>.ts` | package |
| Constant | `constants.ts` beside it | feature `constants.ts` | `lib/<domain>.ts` | `config/` |
| Custom hook | the component's own file | feature `hooks.ts` | `lib/hooks/` | `lib/hooks/` |
| Type | inline in the file | `types.ts` beside it | infer at each use site from the contract | `types/` (ambient only) |
| Class strings | inline utilities | `styles.ts` beside it | a shared component | theme tokens |
| Query hook + key | — | feature `queries.ts` | `lib/hooks/<domain>.ts` | — |

**The default is always the leftmost column that fits.** A file with one consumer that starts
life in a global folder is a defect, not a head start.

`—` means the tier does not apply: a query serves a domain, never a single component, and never
the whole app. **This table is the generic pattern.** In a project with a concrete layout, §14 —
or the equivalent map in that project's `AGENTS.md` — is the authority and overrides it.

## 2. The Promotion Ladder (CRITICAL)

Four tiers. Code enters at the bottom and climbs **only when a second consumer actually
appears**.

```
component-local  →  route/feature-local  →  shared  →  global
```

- **Promote on the second consumer.** One feature uses it → it stays in that feature. Two or
  more need it → it moves up. Do not promote on the first, on a hunch, or "because it's
  generic".
- **Demote too.** If a shared module drops back to one consumer, move it back down. The ladder
  runs both ways.
- **Promotion is a real edit**, not a copy. Two divergent copies is the failure this rule exists
  to prevent.
- **Prefer duplication over the wrong abstraction.** Two similar-looking call sites are not yet
  a pattern; the third is the signal. Abstracting on the first sighting produces a "reusable"
  module that is bent to fit each new caller until it is a pile of flags.

Why the ladder and not a global folder: code placed near its use gets found, gets updated when
the surrounding code changes, and gets deleted with the feature. A single-use function parked
in a global `utils/` is out of sight and gets maintained forever by people who don't know
whether anything still calls it.

## 3. Folder Structure (CRITICAL)

**Group by feature, not by file type.** A `src/` containing `components/ hooks/ utils/
services/` describes the framework. A `src/` containing `reviews/ repos/ agents/` describes the
product. The second one tells a new reader what the system *is* — the architecture should
scream the domain, not the toolchain.

The by-type layout fails predictably as the project grows: the global `components/` folder mixes
pages, stateful forms, and dumb UI atoms; the global `hooks/` and `contexts/` folders fill with
entries whose only relationship is their file type; and the code for any one feature ends up
scattered across four directories.

Two structures worth knowing:

- **Feature-based (the default).** `features/<domain>/` with only the sub-folders that feature
  needs — `api/ components/ hooks/ stores/ types/ utils/`. Plus top-level `components/`,
  `hooks/`, `lib/`, `config/`, `types/` for genuinely shared code. This is the right choice for
  almost every app.
- **Feature-Sliced Design (heavyweight).** Layers (`app` → `pages` → `widgets` → `features` →
  `entities` → `shared`), sliced by domain, each slice segmented into `ui`/`api`/`model`/`lib`/
  `config`. Layers may only import from layers strictly below, and slices may not import
  siblings on the same layer. Adopt it when several teams ship into one frontend and you need
  the import graph enforced by structure. It is overkill for a single-team app — the ceremony
  costs more than the coupling it prevents.

**In a Next.js App Router project, the route tree *is* the feature tree.** Do not add a parallel
`src/features/` beside `src/app/` — that gives you two competing hierarchies and a permanent
argument about which one owns a given component. Route-local code lives in the route folder;
shared code lives in `src/components/` and `src/lib/`. The `features/` trees above are the
generic pattern, for projects whose router does not already provide one.

Routing then imposes the hierarchy for you. Use it:

- A route is not public until the folder has `page` or `route` — so **any other file can sit
  safely inside a route folder** without becoming a URL.
- `_folderName` opts a folder and all its subfolders out of routing entirely. Use it to
  separate UI from routing, and to stay clear of future framework file conventions.
- `(groupName)` organizes routes without appearing in the URL — for section layouts, or opting
  a subset of routes into a layout.

## 4. The Component Folder Contract (HIGH)

A component folder holds one component and everything that exists only for it:

```
RunCostBadge/
├── RunCostBadge.tsx        # the component — the only file that exports JSX
├── RunCostBadge.test.tsx   # ships with the component, same folder
├── helpers.ts              # pure functions used only here
├── constants.ts            # literals used only here
├── styles.ts               # shared class strings used only here
├── types.ts                # types shared between the files above
└── hooks.ts                # stateful logic used only here
```

Rules:

- **`Component.tsx` and its test are mandatory. The rest are on demand.** Add `helpers.ts`,
  `constants.ts`, `styles.ts` or `types.ts` when there is something real to put in them — a
  one-line `constants.ts` holding a single array is noise, and that literal belongs at module
  level in the component file instead.
- **One component per file.** A small private sub-component used only by its neighbour may stay
  in the same file; once it needs its own test or helpers, it gets a folder.
- **Nest with `_components/`** when a component grows sub-components of its own. Nesting is the
  signal that the parent is a feature, not a widget. A nested child follows its **parent
  folder's** convention, not the tree's root — a sub-component of a kebab-cased shared component
  stays kebab-cased.
- **Name the folder for the component**, in the case convention already used by the folder you
  are adding to. A project may legitimately run two conventions in two different trees; match
  the neighbours, never normalize across trees.

## 5. Splitting Components (HIGH)

**Length is not a reason to split.** A long `return` is not a defect, and splitting to hit a
line count produces components whose only purpose is to be small. The real triggers:

- **A second consumer** — the block is needed somewhere else. This is reuse, the strongest reason.
- **State isolation** — you can no longer tell which state and handlers belong to which part of
  the JSX, or unrelated state changes are re-rendering the whole thing.
- **A distinct responsibility** — one component fetches, transforms, *and* renders. Move the
  fetching and transforming out (see §10); what remains usually needs no split at all.

Maintaining a component until it needs breaking up is cheaper than maintaining a premature
abstraction.

**Composition beats prop drilling.** When props are threaded through components that don't use
them, restructure before reaching for Context: pass rendered elements as `children` or props so
intermediate layers never see the data. Keep state as close to where it's relevant as possible.
Context is for what is genuinely needed deep in the tree — it is close to a global variable, and
every consumer re-renders on change.

**Container / presentational** — know it, don't enforce it. Its author withdrew the
recommendation: the point was separating stateful logic from rendering, and hooks do that
without the arbitrary component split. Use it where a codebase already leans that way; never
impose it.

**Atomic design** (atoms → molecules → organisms → templates → pages) — a design-system
vocabulary, not an app folder structure. Use it for a component library shared across products;
do not classify product features by it.

**Server/client boundary (Next.js / RSC).** `'use client'` marks an entry point: everything that
module imports joins the client bundle and hydrates. So push the directive **to the leaves** —
the button, the form, the toggle — and keep layouts and containers on the server. When a client
component needs server-rendered content, pass it as `children` or a prop; the client sees the
rendered output, and the server code stays out of the bundle.

## 6. Constants (MEDIUM)

Same ladder as everything else: `constants.ts` beside the component → feature `constants.ts` →
`config/`.

- **Narrow scope is not a magic number.** A literal used once, three lines from its meaning,
  reads fine. Name it when it appears twice, when the name explains something the value doesn't,
  or when it must stay in sync with somewhere else.
- **Don't build a global constants file.** A module every feature imports couples every feature
  to every other, and answers "who uses this?" with "unknown".
- **Environment-derived values belong in one config module**, read once and exported typed —
  never `process.env` reads scattered across components.
- **Constants used in JSX must live at module level**, not inline — an inline array or object is
  a fresh reference on every render.

## 7. `utils` vs `helpers` vs `lib` (HIGH)

The distinction people reach for is real but weak, and picking by feel produces two folders that
mean the same thing. Use these definitions:

- **`lib`** — library code the surrounding module needs: preconfigured clients, adapters,
  wrappers around third-party packages. Formal enough to be published.
- **`helpers`** — pure functions supporting one component or feature. Colocated, private,
  deleted with their owner.
- **`utils`** — generic, domain-free operations with several unrelated consumers.

**The rule that matters more than the naming: name a module for what it provides, not what it
contains.** `relative-time.ts`, `github-urls.ts`, `parse-diff.ts` — never `utils.ts`. A file
named for its category has no criterion for what may enter it, which is exactly how it becomes
the folder where anything nobody could place ends up. This governs **shared** folders; a
colocated `helpers.ts` is exempt, because the folder it sits in already states its scope.

Pick **one** of the three names per project and stay with it. If the project already uses
`helpers.ts` beside components, keep writing `helpers.ts`; do not introduce a parallel `utils.ts`
convention.

## 8. Types (MEDIUM)

- **Inline** in the file that uses it → **`types.ts`** in the folder once a second file there
  needs it → **central `types/`** only for genuinely cross-cutting shapes.
- A central `types/` folder is for ambient declarations and truly global shapes, **not** a
  parking lot for every interface in the app.
- **Never hand-write a type that duplicates a schema.** If a validation schema or generated
  contract defines the shape, infer from it. A hand-copied duplicate drifts silently — the
  compiler cannot tell you the two disagree. Many contracts already export the inferred type
  next to the schema — import that rather than re-inferring.
- **An inferred alias lives where it is used**, not in a central types module: write
  `type X = z.infer<typeof Schema>` in the file that needs it, or in that folder's `types.ts`
  once a second file there needs it. Two unrelated routes needing the same alias each write
  their own line — that is a one-line restatement of a single source of truth, not duplication.
  Do not add the alias to a vendored or generated contract module; those are overwritten.
- Props types live with their component, not in a shared types module.

## 9. Styles (MEDIUM)

- **Utility classes inline** in the JSX. No `style={{}}` objects.
- **`styles.ts` beside the component** for class strings used by more than one element in that
  folder, or long enough to hurt readability inline.
- **3+ variant combinations → a variant map in that folder's `styles.ts`** (or a variants
  library if the project already depends on one), not nested ternaries in `className`.
- **Repeated across components → extract a component**, not a shared class string. A `Badge`
  beats a `badgeClasses` export.
- **Design tokens are central** — colors, spacing, radii, fonts live in the theme layer, not
  re-declared per feature.

## 10. Business Logic and Data (CRITICAL)

Three layers, each with a different home:

| Layer | What | Where | Test |
|---|---|---|---|
| Pure functions | calculations, formatting, validation, mapping | `helpers.ts` | direct call, no React |
| Custom hooks | stateful/effectful orchestration | `hooks.ts` / `lib/hooks/` | hook test |
| Service / API | request functions, transport, serialization | `api.ts` / `lib/api.ts` | mocked network |

**Component bodies get none of it.** A component reads props, calls a hook, and returns JSX.

Rules that decide the layer:

- **A function that calls no Hooks is not a Hook.** Name it `getSorted`, not `useSorted`. The
  `use` prefix is a claim about the Rules of Hooks; a plain function can be called anywhere,
  including inside conditions.
- **Don't extract a hook for every duplicated line.** Some duplication is fine. Wrapping a single
  `useState` in a custom hook buys nothing.
- **Name hooks for a concrete use case** — `useReviewRun(id)`, `useRepoSearch(query)`. Never
  lifecycle wrappers like `useMount`, `useEffectOnce`, `useUpdateEffect`; they describe the
  mechanism instead of the intent. If you can't name the hook clearly, the logic isn't ready to
  be extracted.
- **Derivable from props/state → calculate during render.** Never store it in state and sync it
  with an Effect.
- **Caused by an interaction → event handler. Caused by the component being displayed → Effect.**
  A POST fired by a button click belongs in the handler; an analytics event fired on view
  belongs in an Effect.

**Server-state (TanStack Query and friends): a key lives with the query that owns it.** Whether
that file sits in the feature folder or in a shared `lib/hooks/<domain>.ts` is a project
decision — both are colocation in the sense that matters. What is not negotiable: **no global
`queryKeys.ts`.** A single key registry every feature imports couples every feature to every
other feature's cache shape, which is the coupling the structure exists to prevent. Export the
custom hook; keep the query function and the key module-private, so callers cannot depend on
the key's shape.

## 11. Import Boundaries (HIGH)

- **Flow is unidirectional: `shared → features → app`.** Shared code is importable anywhere;
  features never import from the app layer.
- **No cross-feature imports.** Feature A must not import from feature B. If both need
  something, it moves to shared. If one genuinely needs the other's behaviour, compose them at
  the app level, where both are already visible.
- **A feature must be deletable.** Remove its folder and nothing outside it should break except
  the places that composed it. If deletion cascades, the boundary was never real.
- **Enforce mechanically.** Conventions decay under deadline; lint rules don't. Configure
  `import/no-restricted-paths` zones or `eslint-plugin-boundaries` so a violation is a red
  squiggle at write time.

## 12. No Barrel Files (HIGH)

**Import modules directly. Do not add `index.ts` re-export files.**

```ts
// ✅ import { RunCostBadge } from '@/components/run-cost-badge/RunCostBadge'
// ❌ import { RunCostBadge } from '@/components/run-cost-badge'
```

The cost is measured, not stylistic. A barrel forces the bundler to pull in every re-exported
module to resolve one import: popular component and icon libraries ship entry barrels with up to
10,000 re-exports, costing 200–800 ms per import — one measured case took 10.2 s and 11,738
modules to boot. Tree-shaking does not rescue it: analyzing the whole module graph to prune it
is itself the expensive part, and a single side effect anywhere in the barrel defeats pruning
entirely. `export *` additionally hides where a symbol actually comes from.

**Scope of this rule: new and touched code.** It is not a mandate to mass-delete existing
`index.ts` files. Removing them is a deliberate, separately-requested migration — never a
side effect of unrelated work.

## 13. Smells — check a diff for these (HIGH)

- A new file in a shared or global folder with exactly one consumer
- A `use*` function that calls no Hooks — or a Hook named for a lifecycle, not a use case
- `fetch` / a request call inside a component body
- A component importing from a sibling feature
- A new `utils.ts`, `helpers.ts`, or `constants.ts` at global level
- A hand-written type that restates a schema or contract
- A new barrel `index.ts`
- `useState` + `useEffect` maintaining a value derivable from props
- A component split purely to reduce line count, with one consumer and no state of its own
- `'use client'` on a layout, container, or page rather than on a leaf

---

## 14. How This Maps to DevDigest

**This section is the authority for `client/`.** Where it differs from §1–§13, this wins — those
sections describe the generic pattern, this describes the actual tree. Paths are relative to
`client/`.

`client/` is Next.js 15 App Router, so **the route tree is the feature tree**. There is no
`src/features/` and none should be created.

Write `C` for the component's own folder — `src/app/<route>/_components/<Name>/` when route-local,
`src/components/<kebab-name>/` once promoted. `R` is the route's shared folder,
`src/app/<route>/_components/`.

| Artifact | 1 component | 2+ components, 1 route | 2+ routes | Cross-cutting |
|---|---|---|---|---|
| Component | in the parent `.tsx` | `R/<Name>/` | `src/components/<kebab-name>/` | — |
| Pure function | `C/helpers.ts` | `R/helpers.ts` | `src/lib/<what-it-provides>.ts` | `src/lib/…` |
| Constant | module level in the `.tsx` | `R/constants.ts` | `src/lib/<what-it-provides>.ts` | `src/lib/…` |
| Class strings | `C/styles.ts` | `R/styles.ts` | shared component's `styles.ts` | `src/app/globals.css` |
| Type | inline, then `C/types.ts` | `R/types.ts` | infer at each use site | `src/lib/types.ts` (client-only) |
| Non-data hook | in the `.tsx`, then `C/hooks.ts` | `R/hooks.ts` | `src/lib/hooks/<name>.ts` | `src/lib/hooks/<name>.ts` |
| Data hook | — | `src/lib/hooks/<domain>.ts` | `src/lib/hooks/<domain>.ts` | `src/lib/hooks/core.ts` |
| UI strings | — | the route's namespace | `messages/<locale>/common.json` | `common.json` |

"1 component" means one component *uses* it: start inline in the `.tsx`, and split it out into
`C/types.ts` or `C/hooks.ts` only once a second **file inside that folder** needs it (§4).

`<domain>` applies to **data hooks only** and means the API area, matching the existing files —
`agents.ts`, `reviews.ts`, `repo-intel.ts`, `trace.ts`. A hook for a review run's trace joins
`trace.ts`; do not create a file per hook. `core.ts` holds the shared query/mutation primitives
those domain files are built on — never feature hooks, and never non-data hooks: a shared
`useKeyboardShortcut` goes in `src/lib/hooks/keyboard-shortcut.ts`, named for what it does.

UI-string namespaces are named for the **feature the route serves**, not the URL path —
`prReview.json` covers `repos/[repoId]/pulls/**`, `agents.json` covers `agents/**`. Add a
namespace only with a new feature area; otherwise join the existing one.

Real examples: `src/app/agents/_components/AgentCard/` (route-local) ·
`src/components/run-cost-badge/` (promoted, shared) · `src/components/app-shell/hooks/`
(non-data hooks in a folder) · `src/lib/github-urls.ts` (cross-cutting pure functions) ·
`src/lib/hooks/reviews.ts` (data).

Project rules:

- **Promotion target: `src/components/<kebab-name>/`.** A component moves there once a route
  folder needs it that **cannot reach it by importing upward** — a sibling route, or an ancestor
  of the route that owns it. Two components inside one route is not promotion, a descendant
  using an ancestor's component is not promotion, and a prediction is never promotion. It never
  moves into `src/vendor/ui/`.
- **Every new component ships `Component.tsx` + `Component.test.tsx`**, plus `helpers.ts`,
  `styles.ts`, `constants.ts` only where it has something to put in them — promotion moves files,
  it does not add them. Several older components in `src/components/` predate the test
  convention; that is debt, not a precedent.
- **Two casing conventions coexist by design**: kebab-case folders under `src/components/`,
  PascalCase folders under `_components/`. Match the tree you are in; do not normalize across
  them. Files inside are always PascalCase for components, lowercase for the rest.
- **`helpers.ts` is the established name.** There is no `src/utils/` and none should be created.
- **Every data hook goes through `src/lib/hooks/*`**, which calls `src/lib/api.ts` — this project
  centralizes them by domain rather than per feature. Never `fetch` in a component. Query keys
  stay module-private in the hook's file (§10).
- **Contract types come from `src/vendor/shared/contracts`** — infer with `z.infer`, at the use
  site or in the folder's `types.ts`. Never add to `src/vendor/**`; it is overwritten on
  re-vendor. `src/lib/types.ts` is for client-only shapes.
- **User-facing text goes through next-intl.** A route-local component's strings go in the
  namespace matching its route; a component in `src/components/` is shared across routes, so its
  strings go in the shared namespace — and promoting a component means moving its keys there too,
  in the same change. Never hardcode text in JSX.
- **Tests ship in the component's folder.** Real browser journeys belong in `e2e/`, not here.
- **§11's ESLint zones do not apply as written** — they assume `src/features/`. The boundary here
  is directional. Imports may only go **up** the route tree: a nested route may use what an
  ancestor route owns (`pulls/[number]/` reading `pulls/_components/` is the ladder working, not
  a violation). Two other directions are violations, and both are fixed by promoting to
  `src/components/`: a **sibling** reaching across to another route's `_components/`, and an
  **ancestor** reaching down into a descendant's. The badge case is the second — `pulls/`
  needing what `pulls/[number]/_components/` owns is exactly why it promotes.
