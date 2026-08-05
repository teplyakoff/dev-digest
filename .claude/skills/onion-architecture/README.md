# Onion Architecture Skill

## Motivation

The repo had twelve skills. Three covered backend *tools* —
[fastify-best-practices](../fastify-best-practices/SKILL.md),
[drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md),
[postgresql-table-design](../postgresql-table-design/SKILL.md) — and one covered frontend
*placement*, [frontend-architecture](../frontend-architecture/SKILL.md). Nothing covered
backend placement: which ring a piece of server code belongs in, and which way it may import.

The architecture already existed and was good. `reviewer-core` is a genuinely pure engine
with one injected port. Every external system sits behind an interface in
`server/src/vendor/shared/adapters.ts`. `platform/container.ts` is a real composition root
with a test-override seam. But the rules lived as one-line bullets scattered across four
`AGENTS.md` files, and four modules already contradicted them — `pulls/`, `polling/`,
`settings/` and `workspace/` run Drizzle queries inline in route handlers, with
`pulls/routes.ts` at 395 lines doing GitHub sync plus three read-time aggregation blocks
inside handlers. An agent asked to add an endpoint reads that file and copies it.

This skill states the dependency rule once, maps it onto the tools actually in use, and
gives a diff-checkable smell list. It is the backend counterpart to `frontend-architecture`
and deliberately shares its format.

### Design decisions

| Decision | Rationale |
|---|---|
| **Pragmatic onion, not DDD tactical patterns** | The core is pure functions plus Zod contracts, which is what `reviewer-core` already is. Entity classes and value objects would flag most of the codebase as anemic while changing nothing about the dependency direction — the thing that actually matters. §13 says so explicitly, so the skill cannot be read as an invitation to add ceremony. |
| **Ring 1 holds ports *and* contracts** | A port is a statement of what the inside needs, so it belongs with the inside. In this repo both already live in the same folder (`vendor/shared/`), so the model matches the filesystem rather than fighting it. |
| **Documentation-only enforcement** | `dependency-cruiser` is already a dependency, but only as a runtime library for repo-intel. A lint lane would fail on day one against four route files and the composition root. §14 is the enforcement; the config sketch and the three things it would need first are parked at the end of `tools.md`. |
| **Known violations named in §15, fixed on touch** | Grandfathering them silently is worse than useless: the agent reads `pulls/routes.ts` and copies it. Requiring a full refactor is out of scope for a docs change. Same scoping move `frontend-architecture` used for barrel files. |
| **A `tools.md` split** | The rules are portable to any Node/TS service; the per-tool fences are not. Keeping Fastify/Drizzle/Zod specifics out of `SKILL.md` keeps it scannable and draws a clean line against the three tool skills, which own *how* to use each tool while this one owns *where* it may appear. |
| **Sanctioned exemptions listed explicitly** | Without them the skill flags correct code — the composition root importing modules, the ring-0 re-export shims, `RepoIntel` living in a module folder. A rules document that cries wolf gets ignored. |

## Files

- `SKILL.md` — the rules. Fifteen numbered sections; §15 is the DevDigest authority section.
- `tools.md` — per-tool ring fences: Fastify, Drizzle, Zod, Postgres, the LLM/GitHub SDKs,
  the analysis libraries, platform infrastructure, Vitest. Plus the dependency-cruiser sketch.
- `examples.md` — twelve BAD/GOOD pairs and the ring tree.

## Sources

Everything below was fetched and verified while writing the skill.

### Onion Architecture — primary

- [The Onion Architecture : part 1 — Jeffrey Palermo (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) —
  the origin. Source of §2's rule, quoted verbatim: *"all code can depend on layers more
  central, but code cannot depend on layers further out from the core"*, and of §1's framing
  that *"The database is not the center. It is external."*
- [The Onion Architecture : part 2 — Palermo](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) —
  interfaces defined in the core, implementations in outer layers. Backs §4.
- [Onion Architecture: part 4 — after four years — Palermo (2013)](https://jeffreypalermo.com/2013/08/onion-architecture-part-4-after-four-years/) —
  backs §6 and §13: *"Onion architecture works just fine without the likes of StructureMap or
  Castle Windsor."* The pattern does not require a DI framework, which is why this repo's
  hand-written container is a complete implementation and not a shortcut.
- [The Clean Architecture — Robert C. Martin (2012)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) —
  *"source code dependencies can only point inwards"* (§2) and *"We don't want to cheat and
  pass Entities or Database rows"* (§5) — the direct basis for the rule that Drizzle row
  types stop at the repository.
- [Hexagonal Architecture — Alistair Cockburn](https://alistair.cockburn.us/hexagonal-architecture/) —
  primary (driving) versus secondary (driven) ports, which §4 uses to classify routes and job
  handlers as adapters rather than as a separate concept; and test adapters substituting for
  real ones, which §12 builds on.
- [Explicit Architecture #01: DDD, Hexagonal, Onion, Clean, CQRS… — Herberto Graça](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/) —
  how ports/adapters and onion rings compose into one model. Source of §4's port-shape rule:
  *"It is of utmost importance that the Ports are created to fit the Application Core needs
  and not simply mimic the tools APIs."*

### Composition root, layering limits, over-engineering

- [Composition Root — Mark Seemann](https://blog.ploeh.dk/2011/07/28/CompositionRoot/) —
  §6's definition, quoted: *"a (preferably) unique location in an application where modules
  are composed together"*, placed as close to the entry point as possible. Also the
  Service-Locator distinction the section leans on: infrastructure resolving at the root is
  fine, application code querying a container for its own dependencies is not.
- [Anemic Domain Model — Martin Fowler](https://martinfowler.com/bliki/AnemicDomainModel.html) —
  *"they incur all of the costs of a domain model, without yielding any of the benefits"*.
  The reason §13 forbids a `domain/` folder of getter-bags, and the reason this skill does not
  prescribe entity classes. Also §7's thin-service rule: *"If all your logic is in services,
  you've robbed yourself blind."*
- [PresentationDomainDataLayering — Martin Fowler](https://martinfowler.com/bliki/PresentationDomainDataLayering.html) —
  backs §11: past a certain size *"split your top level into domain oriented modules which
  are internally layered"*, which is exactly `modules/<feature>/` with rings inside each one
  rather than top-level `services/` and `repositories/` folders.

### Testing across the boundary

- [Testing Without Mocks: A Pattern Language — James Shore](https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks) —
  §12. Nullable Infrastructure (*"Nullables look like test doubles, but they're actually
  production code"*) names what `server/src/adapters/mocks.ts` already is: doubles shipped in
  `src/`, type-checked with the ports they implement. Output Tracking is the source of the
  "assert on what the double recorded, not on how it was called" rule, which describes
  `MockGitHubClient.posted` exactly.

### Tool-specific — the practices the skill forces

- [Encapsulation — Fastify docs](https://fastify.dev/docs/latest/Reference/Encapsulation/) —
  `register` creates a child context; decorators and hooks reach descendants but never
  ancestors, forming a DAG. Backs `tools.md`'s claim that a plugin boundary *is* an
  architectural boundary, and that `fastify-plugin` on a feature module is a smell because
  its purpose is to break exactly that.
- [Plugins Guide — Fastify docs](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) —
  the plugin tree as a lightweight DI system, which is the framing behind
  `app.decorate('container', …)` as the composition-root handoff.
- [fastify-type-provider-zod](https://github.com/turkerdev/fastify-type-provider-zod) —
  `setValidatorCompiler` / `setSerializerCompiler` / `withTypeProvider<ZodTypeProvider>()`:
  one Zod contract driving both request validation and response serialization. Backs §9's
  "declare, don't parse", and the note that `hasZodFastifySchemaValidationErrors()` belongs
  in the single error handler.
- [Transactions — Drizzle ORM docs](https://orm.drizzle.team/docs/transactions) —
  `db.transaction(async (tx) => …)`, `tx` exposing the same query interface as `db`, nested
  transactions as savepoints, and the fact that `tx` can be handed to helper functions. That
  last property is the mechanism §8's transaction rule depends on.
- [Atomic Repositories in Clean Architecture and TypeScript — Sentry](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) —
  the concrete Drizzle shape in §8 and `tools.md`: repositories take an optional transaction,
  resolve it as `const invoker = tx ?? db`, and the boundary is owned by the caller — so
  repositories stay reusable and the ORM's transaction type never reaches the core. Also the
  note that `tx.rollback()` throws a Drizzle-specific error that must be translated.

### Enforcement (described, not implemented)

- [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) —
  the `{ name, severity, from: { path }, to: { path } }` forbidden-rule shape, plus `circular`
  and `orphan` detection. The sketch at the end of `tools.md` follows it.
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) —
  the write-time alternative, already cited by `frontend-architecture` for the same purpose.

### Consulted, not cited

- [Onion Architecture: Going Beyond Layers — NDepend](https://blog.ndepend.com/onion-architecture-layers/) —
  returned HTTP 403 and could not be verified, so no claim in the skill rests on it.
- [Implementing SOLID and the onion architecture in Node.js with TypeScript and InversifyJS — Remo Jansen](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) —
  the best-known Node/TS write-up, but built on an InversifyJS decorator container that this
  repo deliberately does not use. Read as background; nothing in the skill depends on it.
