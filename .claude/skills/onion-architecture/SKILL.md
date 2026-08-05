---
name: onion-architecture
description: "Backend code organization and dependency direction for Node/TypeScript services. Use when adding an endpoint, putting a new external dependency behind a port, deciding whether logic belongs in a route, a service or a repository, wiring something into the DI container, or reviewing a backend diff for layering drift. Covers the four rings, the dependency rule, ports and adapters, the composition root, use-case services, repositories and transaction boundaries, transport, error translation, cross-module imports, and how the rings map onto Fastify, Drizzle, Zod and Vitest."
---

# Onion Architecture — which ring backend code belongs in

Answers one question: **given this piece of backend code, which ring owns it — and which
way is it allowed to import?**

- Per-tool rules — Fastify, Drizzle, Zod, the LLM/GitHub SDKs, Vitest → [tools.md](tools.md)
- Good/bad code pairs and the ring tree → [examples.md](examples.md)
- Route mechanics — hooks, lifecycle, serialization, rate limits →
  [fastify-best-practices](../fastify-best-practices/SKILL.md)
- Query and schema mechanics — joins, relations, migrations →
  [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md)
- Writing the schemas themselves → [zod](../zod/SKILL.md)
- The client-side counterpart → [frontend-architecture](../frontend-architecture/SKILL.md)

This skill owns dependency direction and ring placement only. It does not tell you how to
write a query, a route, or a schema — the skills above do.

## Severity Levels

- **CRITICAL** — Breaks the dependency rule. The core stops being runnable without
  infrastructure, and every test of it needs Docker
- **HIGH** — Welds a feature to a tool, or spreads one rule across many handlers
- **MEDIUM** — Costs consistency now and a refactor later

---

## 1. The Four Rings (CRITICAL)

| Ring | Contains | May import | Must never import |
|---|---|---|---|
| **0 — Core** | Pure domain logic: assembly, transformation, scoring, parsing | ring 1 types | anything that performs I/O |
| **1 — Contracts & ports** | Zod contracts, port interfaces, error taxonomy, pure utilities | itself only | rings 0, 2, 3 |
| **2 — Use cases** | Services, pipelines, job handlers — orchestration | rings 0–1 | a web framework, an ORM, an SDK, `node:fs` |
| **3 — Adapters & transport** | Routes, repositories, external clients, DB client, migrations | rings 0–2 | another feature's ring 2 |
| **RC — Composition root** | Wires the object graph. The one place allowed to point outward | everything | — |

Ring 1 is deliberately *inside* ring 2 even though it contains no behaviour. A port
interface is a statement of what the core needs; it belongs with the core, not with the
thing that satisfies it (§4).

**Four rings is the ceiling, not a starting budget.** Ring 0 is empty in most services and
that is fine — see §13 before adding a fifth.

**The compile test.** Delete ring 3 from your head. If rings 0–2 still type-check and their
tests still pass, the direction is right. If a service stops compiling because a Drizzle
type vanished, the boundary already leaked.

## 2. The Dependency Rule (CRITICAL)

The whole architecture is one sentence, from
[Palermo](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/): *"all code can
depend on layers more central, but code cannot depend on layers further out from the core."*

- **All coupling points inward.** An outer ring names an inner one freely. An inner ring
  never names an outer one — not by import, not by type, not by string reference to a file.
- **Inner rings do not know their callers.** A service does not know whether it was reached
  over HTTP, by a job, or by a test. If it needs to know, the wrong thing was passed in.
- **The composition root is the only exemption**, and only because assembling the graph *is*
  its job (§6). Every other outward import is a defect.
- **Type-only imports still count.** `import type { PullRow }` from `db/schema.js` into a
  service is a dependency on the database schema — the shape has to change when a column
  does. The narrow carve-out: an outer-ring file may import an outer-ring type for its own
  internal use. Crossing inward, it is a leak.
- **The database is not the centre; it is external.** Persistence is a detail the core is
  told about through an interface, not a foundation the core is built on.

## 3. Placement Decision Table (CRITICAL)

Find the row. Most questions end here.

| I am writing… | Ring | Where it goes |
|---|---|---|
| An HTTP endpoint | 3 | `modules/<feature>/routes.ts` |
| A rule that orchestrates two or more steps | 2 | `modules/<feature>/service.ts` |
| A pure calculation over data already in memory | 0 | `helpers.ts` beside the caller, or the core package |
| SQL, in any form | 3 | `modules/<feature>/repository.ts` |
| A call to GitHub / an LLM / git / the shell | 1 + 3 | interface in the port file, implementation in `adapters/<name>/` |
| A shape the client also needs | 1 | `vendor/shared/contracts/` |
| A background job handler | 2 | `service.ts`, registered from `routes.ts` at plugin load |
| Retry, timeout, cancellation, queueing | — | `platform/` — cross-cutting, not a feature |
| A literal (job kind, limit, default) | 2 | `modules/<feature>/constants.ts` |
| A test double for an external system | 3 | `adapters/mocks.ts`, shipped in `src/` (§12) |
| Config read from the environment | RC | `platform/config.ts`, nowhere else |
| A secret | 3 | behind `SecretsProvider`. Never config, never the DB, never git |

`platform/` is not a ring. It is cross-cutting infrastructure that several rings use, and
each file in it belongs to whichever ring its dependencies put it in: `errors.ts` and
`resilience.ts` import nothing and are ring 1; `container.ts` imports everything and is the
composition root.

## 4. Ports: inner defines, outer implements (CRITICAL)

A **port** is an interface owned by the inside. An **adapter** is the outside satisfying it.
Palermo's part 2 states the split plainly: interfaces are defined in the core, and
implementations live in outer layers.

**Adding any new external system is four edits, in this order:**

1. **The interface**, in the shared port file — ring 1.
2. **The real implementation**, in `adapters/<name>/` — ring 3, `implements` the interface.
3. **A test double**, next to the real one, so callers can be tested without the system.
4. **An override key** on the container's overrides type, so tests can inject the double.

Miss step 3 or 4 and the port is decorative: nothing can be tested through it, and the next
person inlines the SDK instead.

- **Shape the port to the caller's need, not to the SDK.** From
  [Graça](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/):
  *"It is of utmost importance that the Ports are created to fit the Application Core needs
  and not simply mimic the tools APIs."* A port with an `octokit` field on it is not a port,
  it is the SDK wearing a hat.
- **Ports speak in contract types.** Parameters and return values are ring-1 shapes, never
  the library's response objects (§5).
- **Two directions, both real.** *Driven* ports are the ones the core calls out through —
  database, LLM, GitHub. *Driving* ports are the ways the outside gets in — HTTP routes,
  job handlers, the CLI. Driving adapters are also ring 3 and also forbidden from holding
  logic (§9).
- **A port can be local.** If exactly one feature uses it, declaring the interface in the
  adapter file next to the implementation is fine. Promote it to the shared port file when
  a second consumer appears.

## 5. What May Cross a Ring Boundary (HIGH)

Uncle Bob's rule for boundary crossings is the one to memorise:
*"We don't want to cheat and pass Entities or Database rows."*

| Crosses inward | Never crosses inward |
|---|---|
| Primitives and plain objects | ORM row types (`$inferSelect`, model instances) |
| Types inferred from a Zod contract | `FastifyRequest` / `FastifyReply` / any framework request object |
| The service's own declared interfaces | SDK response objects (Octokit payloads, LLM response envelopes) |
| Callbacks the caller supplies (`onEvent`, `checkCancelled`) | Library error classes |
| Errors from the shared taxonomy | A logger typed as the concrete logger |

- **Map at the repository edge.** A repository may return its row type to its own service;
  the service converts to a contract type before that value goes anywhere else. One mapping
  function per entity, next to the service.
- **Invert instead of importing.** When the core needs something to happen outside — emit
  progress, check for cancellation — take a callback. The core stays ignorant of SSE buses
  and cancellation tables, and tests pass a no-op.
- **Structural types beat concrete ones for cross-cutting values.** A service that logs
  should accept `{ info(obj, msg?): void; warn(…): void }`, not the logger library's type.
  Nothing to mock, nothing to import.

## 6. The Composition Root (HIGH)

[Seemann](https://blog.ploeh.dk/2011/07/28/CompositionRoot/): *"a (preferably) unique
location in an application where modules are composed together"*, as close to the entry
point as possible.

- **One place constructs adapters.** `new SomeApiClient(...)` outside the composition root
  is the single most common way this architecture rots, because it hard-codes a
  dependency that can no longer be swapped in a test.
- **Everything below takes what it needs as a constructor argument.** No module-level
  singletons, no imports reaching sideways for a shared instance.
- **Container in a constructor is fine; container in a helper is not.** A service holding
  the container and reading `container.github()` is constructor injection with one argument.
  A pure function that reaches for a global container is the Service Locator anti-pattern —
  its dependencies become invisible at the call site.
- **Resolve lazily when construction needs a secret or a network call.** A getter that
  builds on first use keeps boot fast and keeps unconfigured features from throwing until
  something actually uses them.
- **The composition root may import inward from every ring.** That is not a violation; it is
  the definition. Exempt it explicitly in any lint rule you write.
- **A DI framework is optional.** Palermo, five years on: *"Onion architecture works just
  fine without the likes of StructureMap or Castle Windsor."* A hand-written container class
  is a complete implementation of this pattern.

## 7. Use-Case Services (HIGH)

A service answers *"what happens when someone asks for this?"* — and nothing else.

- **No HTTP.** No status codes, no headers, no request or reply objects. It throws a
  taxonomy error and lets transport map it (§10).
- **No SQL.** Persistence goes through a repository, every time.
- **No filesystem, no `process.env`, no SDK.** Those are ports.
- **It owns the transaction boundary**, because it is the only layer that knows where one
  business operation starts and ends (§8).
- **Keep it thin.** Fowler's warning applies in both directions: a service layer should
  coordinate, and *"If all your logic is in services, you've robbed yourself blind."* A rule
  that is pure computation belongs one ring further in, where it can be tested with no
  container at all.
- **Long-running work is enqueued, not awaited.** The service creates the record, hands the
  job to the queue, and returns something the caller can poll or subscribe to.

## 8. Repositories (HIGH)

- **The repository is the only place the ORM appears.** One repository per entity or
  feature; it is *the* place that touches those tables.
- **Every query is scoped by the tenant key.** A query without it is a data-leak bug, not a
  style issue. Make it a parameter, not an optional.
- **Free functions taking the handle first** (`getPull(db, workspaceId, id)`) compose better
  than methods bound to a connection. A class facade over them is fine when a service wants
  one object to hold.
- **The caller owns the transaction; the repository accepts one.** Give every write method
  an optional transaction argument and resolve it as `const invoker = tx ?? db`. The
  repository then works identically inside and outside a transaction, and the service can
  make two writes atomic without either repository knowing about the other. This is the
  pattern [Sentry documents for Drizzle](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/);
  the mechanics are in [tools.md](tools.md).
- **Row types stop here.** Returning a row to your own service is fine; letting that row
  travel further is the leak §5 forbids.
- **Read-time aggregation is a query, not a loop.** Counting, scoring, and rolling up belong
  in SQL or in a pure helper the repository calls — not in the handler that renders them.

## 9. Transport Is a Ring-3 Adapter (HIGH)

A route handler does exactly three things: **parse, delegate, map the status code.**

- **Declare the schema; never hand-parse.** Attach the contract to the route so invalid input
  is rejected before the handler body runs. A `Schema.parse(req.body)` inside a handler means
  validation failures bypass the framework's own error path.
- **One line of orchestration per handler.** If a handler has a `for` loop, a `try/catch`
  around business logic, or two awaits that depend on each other, that body is a service.
- **The status code is transport's decision**, and the only one it gets to make. What
  happened is the service's answer; which number expresses it is transport's translation.
- **Jobs, streams, and CLIs are transport too.** They are alternative driving adapters into
  the same services — never a shortcut that reaches past a service into a repository.
- **A feature's plugin boundary is an architectural boundary.** One feature = one plugin
  registered in one place. Nothing else registers routes. Details in [tools.md](tools.md).

## 10. Errors and Degradation (MEDIUM)

- **Adapters translate.** A failing HTTP call, a driver timeout, a rate limit — each becomes
  an error from the shared taxonomy at the adapter boundary. Library error classes never
  travel inward (§5).
- **Inner rings throw semantics, not statuses.** `NotFoundError`, `ValidationError`,
  `ConfigError` describe what happened; a single error handler at the edge turns them into
  responses.
- **One error handler, registered before the feature plugins**, so every plugin inherits it.
- **Enrichment degrades; the operation does not fail.** Optional context — an index, a cache,
  a secondary lookup — returns a degraded marker or an empty list rather than throwing. A
  facade whose whole promise is "always answers" must not have a throwing path.
- **Never swallow silently.** A `catch {}` with no log and no fallback value hides the outage
  that the retry/timeout wrapper was there to surface.

## 11. Cross-Module Boundaries (HIGH)

Features are siblings on the same ring. The rings run *inside* each feature, which is
exactly Fowler's advice for a codebase past its first few thousand lines: *"split your top
level into domain oriented modules which are internally layered."*

- **Never import a sibling's `service.ts` or `repository.ts`.** That is a private
  implementation, and importing it makes two features impossible to change independently.
- **Shared data goes through the composition root.** Construct the shared repository there
  and hand it to both features as `container.<thing>Repo`.
- **Shared behaviour becomes a port.** When a feature needs a capability another feature
  provides, define an interface, have the provider implement it, and let consumers depend on
  the interface from the container (§4).
- **Shared types go to ring 1**, not to whichever module happened to declare them first.
- **A sibling constant is still a sibling import.** Duplicate the literal, or promote it to
  ring 1. A `../other-feature/constants.js` import is a coupling that will grow.

## 12. Testing Mirrors the Rings (HIGH)

If the rings are real, the test pyramid falls out of them for free.

| Ring under test | How | Needs Docker |
|---|---|---|
| 0 — Core | Call the function; inject a stub port | no |
| 1 — Contracts | Parse fixtures against the schema | no |
| 2 — Use cases | Build the app with override doubles | no |
| 3 — Repositories, migrations | Real database via testcontainers | yes |
| 3 — Adapters | The real client against a recorded or fake endpoint | no |

- **A use-case test that needs a database is a boundary report.** Fix the placement, not the
  test.
- **Test doubles are production code.** Ship them in `src/` beside the adapters, not in the
  test folder — [James Shore's Nullable Infrastructure](https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks):
  *"Nullables look like test doubles, but they're actually production code."* They get
  type-checked with everything else, so a port change breaks them at compile time instead of
  letting fixtures drift.
- **Validate fixtures inside the double.** A structured-output double that parses its canned
  response against the caller's schema cannot drift from the contract.
- **Track outputs instead of asserting on calls.** Have the double record what it was asked
  to do in domain terms (`posted`, `committed`) and assert on that. Asserting a mock's call
  count tests the wiring; asserting the recorded output tests the behaviour.
- **Name the DB-backed tests distinctly** so the fast lane can exclude them by filename.

## 13. When *Not* to Add a Ring (MEDIUM)

This pattern's failure mode is ceremony. Every one of these is a violation of the skill, not
compliance with it:

- **A `domain/` folder of classes with only getters and setters.** Fowler:
  *"they incur all of the costs of a domain model, without yielding any of the benefits."*
  If a shape has no behaviour, it is a contract type — ring 1, no class required.
- **An interface with one implementation and no test double.** That interface buys nothing.
  Depend on the class; extract the port when a second implementation or a test needs one.
- **A mapper that copies a type field-for-field into an identical type.** Map when the shapes
  genuinely differ. Otherwise the "boundary" is a rename.
- **A repository wrapping a repository.** One indirection per concern.
- **A service that only forwards to a repository.** Let the handler call the repository
  through a thin service only when it earns it — an operation, not a passthrough.
- **A fifth ring.** If the four are not enough, the feature is probably two features.

The pattern's value is the *direction* of dependencies, not the *count* of layers. A
three-file feature with correct direction is more onion-shaped than a nine-file feature with
a service that imports the ORM.

## 14. Smells — Check a Diff for These (HIGH)

- An ORM import (`drizzle-orm`, `db/schema`) in a `routes.ts` or a `service.ts`
- `FastifyRequest` or `FastifyReply` named anywhere below ring 3
- `Schema.parse(req.body)` in a handler instead of a schema declared on the route
- `new <SomeAdapter>(…)` outside the composition root
- `process.env` read outside the config loader and the secrets provider
- A row type (`$inferSelect`) in a signature that crosses into ring 2 or ring 0
- `node:fs`, `child_process`, or a raw `fetch` inside a `service.ts`
- A relative import climbing into a sibling feature (`../<other-feature>/…`)
- An adapter importing from a feature module — the arrow is backwards
- A new test that needs Docker to exercise a use case
- An interface with one implementation and no test double (§13)
- A `catch` that returns a fallback without logging, or swallows an adapter failure
- A handler body longer than about fifteen lines, or containing a loop over writes
- A port method whose parameter or return type comes from an SDK

---

## 15. How This Maps to DevDigest

**This section is the authority for `server/` and `reviewer-core/`.** Where it differs from
§1–§14, this wins. Where it differs from [`server/AGENTS.md`](../../../server/AGENTS.md) or
[`reviewer-core/AGENTS.md`](../../../reviewer-core/AGENTS.md), *those* win — this skill is
their expansion, not a competing source.

### The rings already exist, under other names

| Ring | Real paths |
|---|---|
| **0 — Core** | `reviewer-core/src/**` — `prompt.ts`, `grounding.ts`, `review/run.ts` |
| **1 — Contracts & ports** | `server/src/vendor/shared/adapters.ts` (every port), `vendor/shared/contracts/**` (every Zod contract), `platform/errors.ts`, `platform/resilience.ts` |
| **2 — Use cases** | `modules/*/service.ts`, `modules/reviews/run-executor.ts`, `modules/repo-intel/pipeline/**` |
| **3 — Adapters & transport** | `modules/*/routes.ts`, `modules/*/repository*.ts`, `adapters/**`, `db/**` |
| **RC** | `platform/container.ts`, `app.ts`, `server.ts` |

`reviewer-core` is ring 0 and its own `AGENTS.md` already states the purity contract:
**"No side effects except the injected `LLMProvider`. No DB, no GitHub, no filesystem, no
`process.env`."** That is the rule of this skill, written before it.
[`modules/repos/`](../../../server/src/modules/repos) is the reference shape for a feature —
`routes.ts` → `service.ts` → `repository.ts`, with `helpers.ts` and `constants.ts` beside
them. Copy that trio, not `pulls/`.

### The four edit sites, concretely

Adding an external system (§4) means exactly these files:

1. `server/src/vendor/shared/adapters.ts` — the interface
2. `server/src/adapters/<name>/<impl>.ts` — `implements` it, wrapped in
   `withRetry(withTimeout(…))`, failures translated to `ExternalServiceError`
3. `server/src/adapters/mocks.ts` — the double
4. `ContainerOverrides` in `server/src/platform/container.ts` — the injection key, plus a
   lazy getter (sync) or an async method (when a secret is needed, like `llm()` / `github()`)

### The `vendor/` tension, resolved

`server/src/vendor/shared/**` is marked *do not touch* in two `AGENTS.md` files, yet it is
where ports and contracts must be added. Both are true:

- **`server/src/vendor/shared/**` is the source.** Edit it when adding a port or a contract.
- **`client/src/vendor/shared/**` is the copy.** Never edit that one.
- **There is no re-vendor script.** Copy the changed file by hand and say so in the PR —
  `server/INSIGHTS.md` records that this drift fails silently.

### Sanctioned exemptions — do not flag these

- **`platform/container.ts` imports from `modules/`** (`AgentsRepository`,
  `ReviewRepository`, `RepoIntelService`). That is the composition root doing its job (§6).
- **`run-executor.ts` and `diff-loader.ts` import `db/schema.js` in type position only.**
  Acceptable today; prefer a contract type when you touch those signatures.
- **`platform/prompt.ts`, `grounding.ts`, `structured.ts`** are 6–12 line re-export shims to
  ring 0, so the server has one import path. Not a layer.
- **`RepoIntel`** (`modules/repo-intel/types.ts`) is a ring-1 port that happens to live in a
  module folder, because only repo-intel implements it. Consumers depend on the interface
  from `container.repoIntel`, never on `RepoIntelService`. Its degraded contract — object
  methods return `degraded: true`, array methods return `[]`, nothing throws — is §10's
  degradation rule.
- **`ContainerOverrides.depgraph` / `.tokenizer`** are local ports (§4) declared in their
  adapter files, because only the indexer pipeline reads them.

### Known violations — do not add a new one; extract when you touch one

| File | Violation |
|---|---|
| `modules/pulls/routes.ts` | 395 lines: inline Drizzle, GitHub sync, and three aggregation blocks in handlers. No service, no repository |
| `modules/polling/routes.ts` | Inline Drizzle in handlers |
| `modules/settings/routes.ts` | Inline Drizzle in handlers |
| `modules/workspace/routes.ts` | Inline Drizzle in handlers |
| `adapters/astgrep/index.ts` | Imports `modules/repo-intel/constants.js` — adapter reaching into a feature |
| `adapters/auth/local.ts` | Imports `db/seed.js` |
| `modules/repos/service.ts` | Imports `../repo-intel/constants.js` — sibling import (§11) |
| `modules/repo-intel/service.ts` | Calls `readFile` directly from a ring-2 service (§7) |

**The rule: new handlers get `service.ts` + `repository.ts` from the start, and a touched
handler in the table above gets its logic extracted as part of that change.** Extracting a
whole 395-line file to fix a one-line bug is not required — extract the path you touched.

### Enforcement

There is none, by choice. `dependency-cruiser` is in `server/package.json` as a *runtime
library* for repo-intel; there is no `.dependency-cruiser.js` and no lint lane. §14 is the
enforcement — apply it when reviewing a backend diff. A config sketch, and the exemptions it
would need, is at the end of [tools.md](tools.md).
