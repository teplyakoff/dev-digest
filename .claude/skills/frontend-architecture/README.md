# Frontend Architecture Skill

## Motivation

The repo had eleven skills but none that answered **"where does this file go?"**. The closest
thing was a five-bullet `Code Organization (MEDIUM)` section at the bottom of
[react-best-practices](../react-best-practices/SKILL.md) — and two of its five bullets were
wrong for this codebase, pointing at a `src/utils/` and a `components/ui/` that don't exist in
`client/`.

So an agent asked to add a component had no grounded rule for the decisions it makes first:
which folder, when a route-local component graduates to shared, what belongs in `constants.ts`
versus `helpers.ts` versus `src/lib/`, where types live, where business logic goes. Those
decisions compound — every file added after a misplacement follows the misplacement.

This skill owns placement. `react-best-practices` keeps React semantics (hooks rules,
memoization, keys, accessibility) and now cross-links here instead of restating a thinner
version of the same guidance.

### Design decisions

| Decision | Rationale |
|---|---|
| **Universal rules + a DevDigest appendix** | The skill is portable to any React/Next project; §14 maps it onto this repo's real paths. |
| **Placement decision table first** | An agent needs a lookup, not an essay. §1 answers most questions without reading further. |
| **Promote on the second consumer** | The single rule that prevents both premature abstraction and copy-paste drift. |
| **Hard no on barrel files** | Chosen deliberately over the softer "public API index is fine" position. Scoped to new and touched code so it can't trigger a repo-wide refactor as a side effect. |
| **Describe container/presentational and atomic design, don't prescribe them** | Both are widely cited and both are commonly misapplied; the sources themselves qualify them. |
| **Next.js architecture split into `nextjs.md`** | Keeps `SKILL.md` scannable, and draws a clean line against the existing `next-best-practices` skill: that one owns Next.js *mechanics and performance* (what is valid, what is fast), this one owns *structure and ownership* (where the boundary sits, who owns data access). |

## Files

- `SKILL.md` — the placement rules. Start here.
- `examples.md` — good/bad folder trees and code for each rule.
- `nextjs.md` — Next.js App Router architecture: the `'use client'` boundary, the three data
  architectures, route file conventions, Server Action entry points, the environment boundary.

## Sources

Everything below was fetched and verified while writing the skill.

### Folder structure and feature boundaries

- [bulletproof-react — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — the canonical `src/` and per-feature trees, the unidirectional `shared → features → app` rule, and the `import/no-restricted-paths` config that enforces it. Also the source for §12: it explicitly reversed its own barrel-file recommendation over tree-shaking.
- [Feature-Sliced Design — Overview](https://feature-sliced.design/docs/get-started/overview) — layers/slices/segments, and the segment definitions that settle the `utils` vs `helpers` vs `lib` argument in §7: `lib` is "library code that other modules on this slice need", `model` holds business logic, `config` holds configuration and feature flags.
- [Feature-Sliced Design — Public API](https://feature-sliced.design/docs/reference/public-api) — what a module boundary must guarantee, plus the documented costs of index files: they can "slow down the development server" and `export *` hurts "the discoverability of a slice".
- [Screaming Architecture: Evolution of a React folder structure — profy.dev](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25) — the staged walkthrough with the concrete failure mode at each stage, which is where §3's "how by-type fails" comes from. Source of the Uncle Bob quote and of "Only components that are shown on multiple pages stay in the components folder."
- [React Folder Structure Best Practices — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/) — the flat → by-type → by-feature progression, the per-component file set in §4, and the explicit promotion rule behind §2: one feature uses it, it stays local; two or more, it moves up.
- [Project structure and organization — Next.js](https://nextjs.org/docs/app/getting-started/project-structure) — private `_folder` semantics and their four stated benefits, route groups, the rule that a route is not public until `page`/`route` exists, and the three organization strategies.

### Colocation and abstraction timing

- [Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation) — "Place code as close to where it's relevant as possible", the maintainability/applicability/ease-of-use benefits, and the critique of single-use functions parked in a global `utils/` that §2 and §7 are built on.
- [AHA Programming — Kent C. Dodds](https://kentcdodds.com/blog/aha-programming) — "Avoid Hasty Abstractions", Sandi Metz's "prefer duplication over the wrong abstraction", and the failure mode quoted in §2: abstract early and "the abstraction is basically your whole application in `if` statements and loops."

### Component splitting

- [When to break up a component into multiple components — Kent C. Dodds](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) — the basis for "length is not a reason to split": "I don't mind if the JSX I return in my component function gets really long", and "It's WAY easier to maintain it until it needs to be broken up than maintain a pre-mature abstraction."
- [Prop Drilling — Kent C. Dodds](https://kentcdodds.com/blog/prop-drilling) — the ordered remedies in §5: don't break components up prematurely, keep state close to where it's relevant, and reach for Context last, since "context is kinda taking us back to the days of global variables."
- [Presentational and Container Components — Dan Abramov](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) — the original split **and** the 2019 retraction that §5 leans on: "I don't _suggest_ splitting your components like this anymore… Hooks let me do the same thing without an arbitrary division."
- [Atomic Web Design — Brad Frost](https://bradfrost.com/blog/post/atomic-web-design/) — atoms → molecules → organisms → templates → pages, and the framing that scopes it to design systems rather than app folder structure.
- [Server Components — React](https://react.dev/reference/rsc/server-components) — the `'use client'` boundary rule and the children-as-props pattern: a client component "will see output of the Server Components passed as props", which keeps server code out of the bundle.

### Next.js App Router architecture (`nextjs.md`)

- [Server and Client Components — Next.js](https://nextjs.org/docs/app/getting-started/server-and-client-components) — the module-graph framing that `nextjs.md` §2 is built on: "Once a file is marked with `\"use client\"`, **all of its imports and the components it directly renders are included in the client bundle**", and the exception that makes composition work — the rule "does not apply to Server Components passed as children or other props." Also the `server-only` / `client-only` packages under "Preventing environment poisoning", and the advice to render providers "as deep as possible in the tree".
- [How to think about data security in Next.js](https://nextjs.org/docs/app/guides/data-security) — the source for §1's three-way choice: External HTTP APIs (Zero Trust, for apps with an existing backend), a `server-only` Data Access Layer returning DTOs (for new projects), or component-level access (prototypes only) — with the instruction to "choose one data fetching approach and avoid mixing them." Also §5: a Server Action "is reachable via a direct POST request, not just through your application's UI", a page-level check does not cover it because "the Server Action is a separate entry point and must verify the caller on its own", and the auditing checklist this file's §7 is modelled on.

### Business logic placement

- [Reusing Logic with Custom Hooks — React](https://react.dev/learn/reusing-logic-with-custom-hooks) — four rules in §10: hooks share stateful logic but not state itself; "You don't need to extract a custom Hook for every little duplicated bit of code. Some duplication is fine."; a function that calls no Hooks must not use the `use` prefix (`getSorted`, not `useSorted`); and no lifecycle wrappers — `useMount`, `useEffectOnce`, `useUpdateEffect` are all flagged.
- [You Might Not Need an Effect — React](https://react.dev/learn/you-might-not-need-an-effect) — the two placement rules: anything calculable from props or state is computed during render, and "If this logic is caused by a particular interaction, keep it in the event handler. If it's caused by the user *seeing* the component on the screen, keep it in the Effect."
- [Effective React Query Keys — TkDodo](https://tkdodo.eu/blog/effective-react-query-keys) — colocate queries per feature; "I don't believe that storing all your Query Keys globally in `/src/utils/queryKeys.ts` will make things better"; and "I usually only export custom hooks, so the actual Query Functions as well as Query Keys will stay local."

### Barrel files and import boundaries

- [How we optimized package imports in Next.js — Vercel](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) — the measured numbers in §12: entry barrels with "up to 10,000 re-exports", "200~800ms just to import them", and `@material-ui/icons` at 10.2 s / 11,738 modules. Also why tree-shaking doesn't rescue it — analyzing the full module graph is itself the expensive part.
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — architectural layers declared as config and checked at write time via its `boundaries/dependencies` rule; the alternative to `import/no-restricted-paths` offered in §11.
- [Taking Frontend Architecture Serious With Dependency-cruiser — Xebia](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) — import rules as an "architecture fitness function", and the practical note that ESLint wins on editor feedback while dependency-cruiser wins on graph analysis.

### Consulted, not cited

- [Barrel imports (index.ts re-exports) — Next.js discussion #92926](https://github.com/vercel/next.js/discussions/92926) — checked to confirm the barrel guidance is still current for Next 16.
- *Where Your Types Live Matters More Than You Think* — returned HTTP 403 and could not be verified, so §8 rests on the React and FSD sources above plus this repo's existing `src/vendor/shared/contracts` convention rather than on this article.
