# Onion Architecture — the rings per tool

Which ring each backend tool is allowed to appear in, and what keeps it there. Rules live in
[SKILL.md](SKILL.md); this file is the per-tool fence. Code pairs are in
[examples.md](examples.md).

The one-line version:

| Tool | Ring | Fence |
|---|---|---|
| Fastify 5 + plugins | 3 only | One feature = one plugin. Handlers parse, delegate, map status |
| `fastify-type-provider-zod` | 3 | Declare the contract on the route; never `.parse` a body by hand |
| Drizzle 0.38 | 3 only | Repositories. Row types stop at the repository's own service |
| Zod 3 | 1 | The shared kernel. `z.infer` types are what cross boundaries |
| Postgres 16 + pgvector | 3 | `db/client.ts`, `db/schema/**`, `db/migrations/**` |
| Anthropic / OpenAI SDKs | 3 behind `LLMProvider` | Never imported outside `adapters/llm/` |
| Octokit, simple-git | 3 behind `GitHubClient` / `GitClient` | Retry + timeout + error translation at the adapter |
| ast-grep, dependency-cruiser, graphology, js-tiktoken | 3 behind `RepoIntel` | Features import the facade, never the library |
| p-queue, SSE bus, pino | platform | Ring 2 receives structural types, not library types |
| Vitest 2 + testcontainers | test | Docker only for ring 3 |

---

## Fastify — the plugin *is* the boundary

**Ring 3, and nothing but ring 3.**

Fastify's encapsulation is not a convenience, it is the module system this architecture
runs on. [The docs](https://fastify.dev/docs/latest/Reference/Encapsulation/): every child
context has access to root plugins, *"but the containing child context **does not** have
access to the child plugins registered within its grandchild context."* Registration creates
a one-way DAG — which is the dependency rule, enforced by the framework.

- **One feature = one plugin = one `app.register`.** Nothing else registers routes. Adding a
  feature is a new `modules/<name>/` folder and one line in `modules/index.ts`.
- **The container is decorated once, at the root**, so every feature plugin inherits it.
  That decorator is the composition-root handoff (SKILL.md §6) — it is why a feature can be
  reached by a test with mock adapters and by production with real ones, unchanged.
- **Order is load-bearing.** Security plugins, the type-provider compilers, and the error
  handler all register *before* the feature plugins, so the encapsulated plugins inherit
  them. An error handler registered after a module does not apply to it.
- **`fastify-plugin` on a feature module is a smell.** Its whole purpose is to *break*
  encapsulation and hoist a plugin's decorators into the parent. Correct for a genuinely
  shared plugin (the container, a DB handle); wrong for a feature, where it dissolves the
  boundary you are relying on.
- **Nothing below ring 3 names a Fastify type.** No `FastifyRequest` in a service signature,
  no `reply` passed down. A service that needs to stream takes a callback (SKILL.md §5).

**Test double:** none needed — `app.inject()` exercises the real plugin tree without a port.

## fastify-type-provider-zod — one contract, both directions

**Ring 3 usage of a ring-1 artifact.**

`setValidatorCompiler` / `setSerializerCompiler` are set once on the root instance; each
`routes.ts` opts in with `withTypeProvider<ZodTypeProvider>()`. The same Zod contract then
validates the request and serializes the response, and the handler's types are inferred from
it.

- **Declare, don't parse.** `{ schema: { params: IdParams, body: RepoInput } }` on the route
  rejects invalid input with 422 *before* the handler body runs, and the failure goes through
  the framework's validation error path. A hand-rolled `Schema.parse(req.body)` inside a
  handler bypasses that path and has to be special-cased in the error handler.
- **The response schema is a boundary too.** Serialization failures must never leak the raw
  object — log and return a generic 500.
- **`hasZodFastifySchemaValidationErrors()` belongs in the one error handler**, not in
  handlers.

## Drizzle — repositories only

**Ring 3, no exceptions. This is the fence that breaks first.**

- **`drizzle-orm` and `db/schema.js` are importable from `repository.ts` and `db/` only.**
  Not from a service, not from a route.
- **`$inferSelect` row types stop at the repository's own service.** The service maps to a
  contract type before the value travels (SKILL.md §5). `modules/repos/` does exactly this:
  `RepoRepository` returns `RepoRow`, `RepoService` returns `Repo` via `toRepoDto`.
- **Free functions taking `db` first** compose better than connection-bound methods:
  `getPull(db, workspaceId, prId)`. A class facade that only delegates to them is fine when
  a service wants a single object to hold.
- **Every query carries the tenant key.** `and(eq(t.x.workspaceId, workspaceId), …)` — a
  required parameter, never optional.

### Transactions — the service owns the boundary

[Drizzle's API](https://orm.drizzle.team/docs/transactions) gives `tx` the same query
interface as `db`, and `tx` can be handed to helper functions. That is what makes the
[Sentry pattern](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/)
work: repositories accept an optional transaction and resolve it themselves.

**Nothing in this codebase uses a transaction yet, and `DbTx` does not exist.** This is the
shape to follow when the first multi-write operation appears — add the alias next to `Db` in
`db/client.ts`:

```ts
// db/client.ts — ring 3
export type Db = PostgresJsDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
```

```ts
// repository.ts — ring 3. Works identically in and out of a transaction.
async insert(values: InsertRepo, tx?: DbTx): Promise<RepoRow> {
  const invoker = tx ?? this.db;
  const [row] = await invoker.insert(t.repos).values(values).returning();
  return row!;
}

// service.ts — ring 2. Owns the boundary, because it knows the operation's scope.
async addWithDefaults(workspaceId: string, url: string): Promise<Repo> {
  const row = await this.container.db.transaction(async (tx) => {
    const repo = await this.repo.insert({ workspaceId, ...parseRepoUrl(url) }, tx);
    await this.settings.insertDefaults(repo.id, tx);   // a second repository, same tx
    return repo;
  });
  return toRepoDto(row);
}
```

- **Never open a transaction inside a repository method.** Two repositories each opening
  their own gives you two transactions and no atomicity.
- **`tx.rollback()` throws a Drizzle-specific error.** Catch it at the service boundary and
  re-throw from the shared taxonomy, or it reaches the error handler as an unknown 500
  (SKILL.md §10).
- **Nested `tx.transaction()` is a savepoint**, not a new transaction — useful for a partial
  rollback inside one operation.

**Test double:** none. Repositories are tested against real Postgres in `*.it.test.ts`.

## Zod — the shared kernel

**Ring 1.** Contracts in `vendor/shared/contracts/**`, ports in `vendor/shared/adapters.ts`.

- **`z.infer` types are the currency that crosses rings** (SKILL.md §5). This is the whole
  reason ring 1 exists: one definition serves request validation, response serialization,
  the service's return type, and the client — with no duplicate interface to drift.
- **A contract is not a table.** It describes what callers exchange. When the column changes
  and the contract does not, the mapping function absorbs it — that is the point.
- **Ports may use Zod in their signatures.** `completeStructured<T>(req: { schema: z.ZodType<T> })`
  keeps the schema at the boundary and lets the adapter validate the model's output against
  the caller's own type.
- **Authoring rules — refinements, unions, error shaping — belong to
  [zod](../zod/SKILL.md).** This skill only says where the schema lives.

## Postgres + pgvector

**Ring 3.** `db/client.ts` (the handle), `db/schema/**` (every table), `db/migrations/**`.

- **Migrations never run on boot.** A `relation ... does not exist` at startup means the
  migration step was skipped, not that the app should self-heal.
- **Never edit an applied migration.** Add a new one.
- **Table design belongs to
  [postgresql-table-design](../postgresql-table-design/SKILL.md).** Placement is all this
  skill claims.

## LLM SDKs — Anthropic, OpenAI, OpenRouter

**Ring 3, behind `LLMProvider`.** `@anthropic-ai/sdk` and `openai` are importable from
`adapters/llm/**` and nowhere else.

- **The port is provider-shaped, not vendor-shaped:** `listModels`, `complete`,
  `completeStructured`, `embed`. Three vendors satisfy it; the core knows only the interface.
- **Cost estimation is injected into the provider, not built into it.** The provider takes an
  `estimateCost(model, tokensIn, tokensOut)` callback so ring 0 never carries a price table.
  Same inversion as §5's callbacks.
- **`costUsd: null` means unknown, `0` means free.** Do not collapse them — the distinction
  is load-bearing in the UI.
- **API keys come from `SecretsProvider`, so provider construction is `async`.** That is why
  the container exposes `llm(id)` as a method rather than a getter, and why the cache must be
  invalidated when a key changes.

**Test double:** `MockLLMProvider` in `adapters/mocks.ts`. It validates its canned response
against the caller's Zod schema and throws if it does not fit, so fixtures cannot drift from
the contract.

## Octokit and simple-git

**Ring 3, behind `GitHubClient` and `GitClient`.**

- **Every external call is wrapped:** `withRetry(() => withTimeout(promise, TIMEOUT))` from
  `platform/resilience.ts`, and failures become `ExternalServiceError` (502) so the error
  handler renders them without a stack trace reaching the client.
- **Map to contract types inside the adapter.** `OctokitGitHubClient.listPullRequests`
  returns `PrMeta[]`, not Octokit's response payload — the mapping happens where the SDK
  types are already in scope.
- **The port is shaped by what the app does** — `listPullRequests`, `postReview`,
  `commitFiles` — not by REST endpoints.

**Test doubles:** `MockGitHubClient` records what it was asked to do (`posted`, `openedPrs`,
`committed`) — Output Tracking, so tests assert on behaviour rather than call counts.
`MockGitClient` serves canned diffs.

## Analysis libraries — behind the RepoIntel facade

**Ring 3.** `@ast-grep/napi`, `dependency-cruiser`, `graphology`, `js-tiktoken`,
`@vscode/ripgrep` are importable from `adapters/**` and `modules/repo-intel/pipeline/**`
only.

- **Features depend on `container.repoIntel`, the interface** — never on `RepoIntelService`,
  and never on the libraries. Twelve facade methods hide five libraries.
- **The facade degrades, it does not throw.** Object methods return `degraded: true` with a
  reason; array methods return `[]`. An unindexed repo silently becomes diff-only review
  instead of a failed request (SKILL.md §10).
- **`DepGraph` and `Tokenizer` are local ports** — declared in their own adapter files
  because only the indexer reads them. Promote to `vendor/shared/adapters.ts` if a second
  consumer appears (SKILL.md §4).

## Platform infrastructure — jobs, SSE, logging

**Not a ring — cross-cutting.** Each file lands in the ring its dependencies put it in.

- **`p-queue` lives inside `JobRunner`.** Services enqueue by kind and register handlers;
  they never touch the queue library. Long work is enqueued, not awaited (SKILL.md §7).
- **The SSE bus is transport.** The core emits through an `onEvent` callback; the executor
  forwards to the bus. Ring 0 has never heard of server-sent events.
- **Cancellation is a callback, not a lookup.** The engine calls `checkCancelled()` and
  throws its own error; it does not query a cancellation store.
- **Logging crosses rings as a structural type.** Ring 2 declares
  `type Logger = { info(obj, msg?): void; warn(…): void; error(…): void; debug(…): void }`
  and accepts anything that fits. Pino is never imported below transport — nothing to mock,
  nothing to swap.
- **`platform/config.ts` is the only reader of `process.env` for configuration**, and
  `adapters/secrets/local.ts` the only reader for secrets. Secrets are deliberately absent
  from `AppConfig`.

## Vitest and testcontainers

**The test ring mirrors the code rings** (SKILL.md §12).

- **`*.it.test.ts` ⇒ real Postgres** via testcontainers, self-skipping when Docker is
  absent. Any other filename must be hermetic — the CI suite split is by filename, so a
  DB-backed test with the wrong name breaks the fast lane.
- **Ring 0–2 tests use `buildApp({ config, overrides: { … } })`.** The overrides bag is the
  seam; no module mocking, no `vi.mock` of an adapter path.
- **Doubles ship in `src/adapters/mocks.ts`**, exported from the adapter barrel. They are
  production code that gets type-checked with everything else.
- **`reviewer-core` tests import the server's doubles across the package boundary** and run
  with no DB, no keys, no network. That is ring 0 proving it is ring 0.
- **Fire-and-forget work needs a poll helper, not a sleep.** A service that returns before
  its job finishes is correct (§7); the test waits for the terminal row.

---

## Optional future enforcement — not part of this skill

`dependency-cruiser` is already a dependency of `server/`, used as a *library* by repo-intel.
There is no `.dependency-cruiser.js` and no lint lane, and adding one is out of scope. If it
is ever wanted, the [rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
gives the shape:

```js
// .dependency-cruiser.js — sketch only. Not committed.
module.exports = {
  forbidden: [
    {
      name: 'no-orm-above-repository',
      severity: 'error',
      comment: 'Drizzle is ring 3. Services and routes go through a repository.',
      from: { path: '^server/src/modules/[^/]+/(service|routes)\\.ts$' },
      to: { path: '^(server/src/db/|node_modules/drizzle-orm)' },
    },
    {
      name: 'no-sdk-outside-adapters',
      severity: 'error',
      from: { pathNot: '^server/src/adapters/' },
      to: { path: 'node_modules/(octokit|openai|@anthropic-ai|simple-git)' },
    },
    {
      name: 'no-sibling-module-imports',
      severity: 'error',
      from: { path: '^server/src/modules/([^/]+)/' },
      to: { path: '^server/src/modules/(?!\\1|_shared)[^/]+/' },
    },
    {
      name: 'core-stays-pure',
      severity: 'error',
      from: { path: '^reviewer-core/src/' },
      to: { path: '^server/src/(?!vendor/shared/)' },
    },
  ],
};
```

Three things it would need before it could run green:

1. **Exempt `platform/container.ts` and `app.ts`** — the composition root imports outward by
   definition (SKILL.md §6).
2. **Clear or waive the eight known violations** listed in SKILL.md §15.
3. **Decide on type-only imports** — `run-executor.ts` imports `db/schema.js` in type
   position; dependency-cruiser sees that as a dependency unless configured otherwise.

[eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) is the
write-time alternative — worse at graph analysis, better at editor feedback.
