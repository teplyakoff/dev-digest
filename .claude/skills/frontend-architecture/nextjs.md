# Next.js App Router — architecture

Structural decisions in a Next.js App Router project: where the server/client
boundary sits, who owns data access, and what each route file is for.

Scope note: this file is about **structure and ownership**, not performance — where the
boundary goes and who owns data access. [next-best-practices](../next-best-practices/SKILL.md)
covers the same surface from the other side: what is *valid* and what is *fast*.

The two overlap on RSC boundaries, route files and route handlers, so read both when the task
touches one — **decide placement here, then check the mechanics there before writing.** The
constraints that invalidate a boundary decision live over there: a client component cannot be
`async`, and props crossing the boundary must be serializable (no `Date`, `Map`, class
instances, or functions other than Server Actions). Bundle size, images, fonts, metadata and
caching are entirely theirs.

---

## 1. Pick one data architecture, then don't mix (CRITICAL)

This is the decision every other decision hangs off. Next.js names three, and says to choose
one — mixing them is what makes a codebase impossible to audit, because no one can say where
authorization happens.

| Architecture | Data reaches the UI via | Fits |
|---|---|---|
| **External HTTP API** | server or client code calling an existing REST/GraphQL service | an app that already has a backend, or a separate backend team |
| **Data Access Layer** | a `server-only` internal module that queries the DB and returns DTOs | new projects where Next.js *is* the backend |
| **Component-level** | queries written directly in Server Components | prototypes and learning, nothing else |

Consequences that follow from the choice:

- **External HTTP API** — treat the Next.js app as an untrusted client of your own API
  (Zero Trust). Authorization lives in the API, not in the page. The frontend's job is
  transport, cache and rendering. There is no DAL to build, and building one anyway just
  adds a second place where auth could be checked.
- **Data Access Layer** — one internal library owns data access. It must "only run on the
  server", "perform authorization checks", and "return safe, minimal Data Transfer Objects".
  Only the DAL reads `process.env`, which keeps secrets out of every other module.
- **Component-level** — the documented hazard is a Server Component doing
  `SELECT * FROM user` and passing the whole row to a Client Component, publishing every
  column. If you use it, sanitize before the boundary: return only the public fields.

**The audit question for any of the three: can you name the single file where a given
resource's authorization is enforced?** If the answer is "several places" or "it depends",
the architecture has already drifted.

## 2. `'use client'` is a module-graph boundary (CRITICAL)

Not a per-file flag — a cut across the import graph. Once a file is marked, **all of its
imports and the components it directly renders are included in the client bundle**. You do
not repeat the directive downward; the boundary is inherited.

The exception is the one that makes composition possible: the rule "does not apply to Server
Components passed as children or other props. Those components are not imported into the
Client Component's module graph. They are rendered on the server and passed to the Client
Component as rendered output."

So there are two ways to place a component under a client component, and they mean different
things:

```tsx
// IMPORTS it → joins the client module graph.
'use client';
import { HeavyRenderer } from './HeavyRenderer';
export function Tabs() { return <HeavyRenderer />; }

// RECEIVES it → stays a Server Component, arrives as rendered output.
'use client';
export function Tabs({ panel }: { panel: React.ReactNode }) { return <div>{panel}</div>; }
```

Structural rules:

- **Put the directive on the leaf that owns interactivity**, not on a layout, page or
  container that merely contains one. Marking a container conscripts its whole import
  subtree.
- **A `children`/prop slot is the tool for interleaving.** A client shell with a server
  body is the normal shape for modals, drawers, tabs and accordions.
- **Context providers must be client components**, and should be "rendered as deep as
  possible in the tree" — wrap `{children}` in the layout, not the whole document.
- **Third-party components without the directive** get wrapped in a one-line local client
  module rather than forcing their consumer to become a client component.

## 3. Route files are the structure (HIGH)

The App Router already gives you a hierarchy; these files are how you shape it. Treat them
as architecture, not boilerplate.

| File | Owns | Architectural use |
|---|---|---|
| `layout.tsx` | persistent shell for a segment and its descendants | shared chrome, providers; does not re-render on navigation within the segment |
| `template.tsx` | same, but a fresh instance per navigation | when per-navigation state must reset |
| `page.tsx` | the route entry | should be thin — see §4 |
| `loading.tsx` | the Suspense boundary for the segment | where the streaming boundary sits |
| `error.tsx` | the error boundary for the segment | isolates a subtree's failures from the rest of the app |
| `not-found.tsx` | the empty/404 state | reachable via `notFound()` |
| `route.ts` | an HTTP endpoint | mutually exclusive with `page.tsx` in one folder |

Two organizing tools that change structure without changing URLs:

- **Route groups `(name)`** — scope a layout to a subset of routes, or split the app into
  sections with different shells. The folder never appears in the URL.
- **Private folders `_name`** — opt a folder and all its subfolders out of routing entirely.
  Colocation works without them, but they separate UI from routing, keep the convention
  visible, and avoid collisions with future framework filenames.

**Boundaries are placed, not inherited by accident.** A missing `error.tsx` means a failure
in one panel takes down the nearest ancestor that has one — often the whole page. Deciding
where failures and loading states are contained is an architectural decision, and the
default (no file) is a decision too.

## 4. `page.tsx` is a route entry, not a feature (HIGH)

The page's job is to bind a URL to a view. Data-fetching, tab state, handlers and layout
belong below it, in a colocated component.

```tsx
// GOOD: the whole page. The view owns everything else.
// Import the module, not the folder — a folder import needs a barrel (SKILL.md §12).
import { AgentsListView } from './_components/AgentsListView/AgentsListView';

export default function AgentsPage() {
  return <AgentsListView />;
}
```

This holds whichever data architecture you chose. A server page fetches and hands data to a
view; a client page calls its hooks and hands state to a view. **A page may carry
`'use client'`** — in a client-rendered app that is normal, and it does not conflict with
"push the directive to the leaves", because a page this thin has no subtree of its own to
conscript. What it must not do is grow logic. Either way the page stays a binding, so the
view can be tested, moved or promoted without touching routing.

The threshold is structural, not a line count: **a page has drifted once it contains anything
you would have to rewrite to point this view at a different URL** — data hooks, state, URL
parsing, handlers, layout. A page that only imports and renders is thin at any length; a page
with one `useState` in it is already a feature.

## 5. Mutations: keep the entry point thin (HIGH)

Only relevant if the project uses Server Actions. If mutations go through an external API,
this section does not apply — that API owns it.

- **A Server Action is a public endpoint.** Once exported it "is reachable via a direct POST
  request, not just through your application's UI." A page-level auth check does **not**
  cover the actions defined in it: "the Server Action is a separate entry point and must
  verify the caller on its own."
- **Check authorization, not just authentication.** Verify the caller owns the specific
  resource, or you have an IDOR.
- **Delegate to the DAL.** The action validates input, calls a `server-only` module that
  performs auth and the write, then revalidates. Actions stay thin; the security logic lives
  in one auditable place.
- **Control return values.** They are serialized to the client — return what the UI needs,
  not the database record.
- **Never mutate during render.** Cookie writes and cache invalidation belong in an action,
  not in a component body.

Choosing between the three entry points:

- **Server Action** — a mutation driven by this app's own UI.
- **Route handler (`route.ts`)** — a real HTTP endpoint: webhooks, third-party callbacks,
  or clients you don't control.
- **Neither** — the app talks to an existing backend; add nothing.

## 6. The environment boundary (HIGH)

Server and client share a module system, so server code can be imported into the client by
accident. Make that a build error rather than a code review:

- **`import 'server-only'`** at the top of any module holding secrets, DB access or internal
  business logic — importing it from a client module then fails at build time.
- **`import 'client-only'`** for modules touching `window`, `localStorage` and friends.
- **Only `NEXT_PUBLIC_`-prefixed variables reach the browser**; others are replaced with an
  empty string. That is a silent failure, not an error — a server helper called from the
  client does not throw, it just gets an empty key.
- **Confine `process.env` reads to one module.** Scattered reads make it impossible to say
  what is exposed.

## 7. Architecture review checklist

Applies to any App Router project. In DevDigest, the items marked † are answered once by §8 —
check them against §8's decisions, not per-diff, or you will file findings against a choice
that was made deliberately.

- † Can you name the one file where a resource's authorization is enforced?
- † Is more than one of the three data architectures in use?
- † Is `'use client'` on a layout or container rather than on a leaf? (A thin page is fine —
  see §4.)
- † Does a client component **import** something that could have been **passed** as children?
- Is a provider wrapping the document instead of `{children}`?
- Does a `page.tsx` hold hooks, state, URL parsing or handlers instead of binding a view?
- † Which segments have no `error.tsx` — and is that deliberate?
- † Does any module read secrets without `server-only`?
- † Does a Server Action trust a page-level auth check?
- † Does an action or DAL function return a whole DB record?

---

## 8. How this lands in DevDigest

**This section is the authority for `client/`. Where it differs from §1–§7, this wins** — those
sections describe Next.js in general, this describes the architecture actually chosen here.

**DevDigest is the External HTTP API architecture.** `client/` talks to the Fastify API on
`:3001` through `src/lib/api.ts` and TanStack Query. There is no DAL and none should be
built — authorization belongs to the server package. That single fact explains the rest:

- **No Server Actions** (`'use server'` appears nowhere) and **no route handlers**
  (`route.ts` appears nowhere). Mutations are TanStack Query mutations against the API.
  Adding either means introducing a second backend inside the frontend — don't, unless the
  task is explicitly to move an endpoint into Next.
- **Nearly every component is a client component.** Only `src/app/layout.tsx` does real
  server work — it awaits `getLocale()`/`getMessages()` for next-intl and injects the no-FOUC
  theme script. This is a client-rendered app inside App Router: a legitimate consequence of
  talking to an external API, not drift, and not something to "fix" by moving work to the
  server.
- **Secrets do not belong in `client/` at all.** Everything in this package ships to the
  browser, so the rule is not "guard it with `server-only`" (§6) — it is: **a helper that
  needs a secret goes in the `server/` package and is reached through the API.** Installing
  `server-only` here to hold one would be building a second backend inside the frontend.
  The only env var is `NEXT_PUBLIC_API_BASE`, inlined at build time (so changing it needs a
  dev-server restart), and it is read in `src/lib/api.ts`.
- **§2's interleaving pattern mostly doesn't apply.** With the whole tree client-side there
  is no server body to pass down. It becomes relevant only if a route starts server-fetching.

**Where the repo does drift — `page.tsx` weight.** `client/AGENTS.md` says "Pages stay thin;
feature logic lives in colocated `_components/<Name>/` folders." Some pages follow it and
some don't, so **the existing code is not a reliable model — follow the rule, not the
neighbours.**

_Snapshot, 2026-08-02 — re-check before relying on it:_

| Page | Lines | |
|---|---|---|
| `agents/page.tsx` | 7 | thin — renders `<AgentsListView />` |
| `settings/[section]/page.tsx` | 7 | thin — renders `<SettingsView />` |
| `onboarding/page.tsx` | 9 | thin |
| `page.tsx` (root) | 49 | drifted — holds hooks and a redirect decision |
| `agents/[id]/page.tsx` | 124 | drifted |
| `repos/[repoId]/pulls/page.tsx` | 137 | drifted |
| `repos/[repoId]/pulls/[number]/page.tsx` | 185 | drifted — hooks, tab state, URL params, handlers, three tab bodies |

Follow the thin shape for new routes. When adding to a **drifted** page, put the new work in a
component under its `_components/`, and wire the page to it — add one import and one element,
never another hook or handler at page level. Extracting the *rest* of that page is a separate
task: worth proposing, not worth bundling into a feature change
(the scoping rule in [SKILL.md](SKILL.md) §12 applies here too).

**Boundaries — two different situations, do not treat them alike.** There is no `error.tsx`,
`loading.tsx` or `not-found.tsx` anywhere in `src/app/`. Loading and error states are
hand-rolled per view (`<Skeleton />`, `<ErrorState />`, `RepoNotFound` for a stale
`:repoId`) inside the client components.

- **`loading.tsx` and `not-found.tsx` — correctly absent.** They cover the server pass, which
  does almost nothing here, and every route already renders its own skeleton and empty state
  keyed off the query. Adding them duplicates those states and fires at a different moment.
  Match the per-view pattern; don't add route files.
- **`error.tsx` is a real gap, not a deliberate choice.** It is a React error boundary, so it
  catches **render** errors in the segment's whole subtree — a different failure from the
  query failures `<ErrorState />` handles. With none anywhere, one uncaught render error
  blanks the app. Per §3, a missing boundary means the failure climbs to the nearest ancestor
  that has one, and here there is none. Adding a root `src/app/error.tsx` is worth doing; it
  complements the per-view states rather than replacing them. Treat this as known debt — flag
  it, don't silently fix it inside an unrelated task.
