# Onion Architecture — examples

Good/bad pairs for the rules in [SKILL.md](SKILL.md). Every GOOD side is a real shape from
this repo or a direct extension of one. Per-tool fences are in [tools.md](tools.md).

---

## The ring tree

```
reviewer-core/src/                    RING 0 — core. Pure. One injected port, no I/O.
├── prompt.ts                         assembly + INJECTION_GUARD
├── grounding.ts                      the citation gate
└── review/run.ts                     orchestration over the injected LLMProvider

server/src/
├── vendor/shared/                    RING 1 — contracts & ports. Imports nothing outward.
│   ├── adapters.ts                   LLMProvider, GitHubClient, GitClient, CodeIndex,
│   │                                 Embedder, AuthProvider, SecretsProvider
│   └── contracts/                    Zod contracts: findings, review-api, platform, trace…
│
├── platform/                         cross-cutting — each file lands in its own ring
│   ├── errors.ts                     ring 1 — AppError taxonomy, imports nothing
│   ├── resilience.ts                 ring 1 — withRetry / withTimeout, pure
│   ├── jobs.ts  sse.ts  run-logger.ts     infrastructure used by rings 2–3
│   ├── config.ts                     the only reader of process.env for config
│   └── container.ts                  COMPOSITION ROOT — the one file that imports outward
│
├── modules/<feature>/                rings 2–3 inside every feature
│   ├── routes.ts                     ring 3 — parse, delegate, map status
│   ├── service.ts                    ring 2 — orchestration, transaction boundary
│   ├── repository.ts                 ring 3 — the only place Drizzle appears
│   ├── helpers.ts                    ring 0-ish — pure transforms, no container
│   └── constants.ts                  ring 2 — literals
│
├── adapters/                         RING 3 — one folder per port
│   ├── github/octokit.ts             implements GitHubClient
│   ├── llm/{openai,anthropic}.ts     implement LLMProvider
│   ├── secrets/local.ts              implements SecretsProvider
│   └── mocks.ts                      the test doubles — production code, shipped in src/
│
├── db/                               RING 3 — client, schema, migrations
└── app.ts                            COMPOSITION ROOT — plugins, error handler, modules
```

Arrows only ever point up this tree, except from `container.ts` and `app.ts`.

---

## 1. Inline Drizzle in a handler → the three-file feature

```ts
// BAD: modules/pulls/routes.ts — transport doing persistence and business logic.
// Untestable without Postgres, and the next endpoint copies it.
app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  const [repo] = await container.db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
  if (!repo) throw new NotFoundError('Repo not found');

  const gh = await container.github();
  const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
  for (const pr of pulls) {
    await container.db.insert(t.pullRequests).values({ workspaceId, repoId: repo.id, ... })
      .onConflictDoUpdate({ ... });                        // ← 40 more lines of this
  }
  const rows = await container.db.select().from(t.pullRequests)...;
  return rows.map((r) => ({ ...r, severity: countBySeverity(r.findings) }));
});
```

```ts
// GOOD: routes.ts — parse, delegate, map status. Three lines.
app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
  const { workspaceId } = await getContext(app.container, req);
  return service.listForRepo(workspaceId, req.params.id);
});

// GOOD: service.ts — ring 2. No HTTP, no SQL, no SDK. Testable with overrides.
async listForRepo(workspaceId: string, repoId: string): Promise<PrMeta[]> {
  const repo = await this.repos.getById(workspaceId, repoId);
  if (!repo) throw new NotFoundError('Repo not found');
  await this.syncFromGitHub(workspaceId, repo);   // best-effort; see pair 10
  const rows = await this.repo.listByRepo(workspaceId, repoId);
  return rows.map(toPrMeta);                      // ← rows stop here (pair 3)
}

// GOOD: repository.ts — ring 3. The ONLY place that touches the table, always tenant-scoped.
async listByRepo(workspaceId: string, repoId: string): Promise<PullRow[]> {
  return this.db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.repoId, repoId)));
}
```

`modules/repos/` is this shape today — copy that trio, not `pulls/`.

## 2. Constructing an adapter outside the composition root

```ts
// BAD: service.ts — hard-codes the implementation. No test can ever swap it,
// and the service now needs a token it has no business knowing about.
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';

async sync(repoId: string) {
  const token = process.env.GITHUB_TOKEN!;          // ← two violations in one line
  const gh = new OctokitGitHubClient(token);
  return gh.listPullRequests(...);
}
```

```ts
// GOOD: the container resolves it — async because the secret comes from SecretsProvider.
async sync(repoId: string) {
  const gh = await this.container.github();          // GitHubClient, the interface
  return gh.listPullRequests(...);
}

// GOOD: platform/container.ts — the one place that says `new`.
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;
  if (this._github) return this._github;
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
```

## 3. A row type escaping the repository

```ts
// BAD: the DB schema is now the API. Rename a column and the client breaks;
// add a column and it leaks. Ring 2's signature depends on ring 3.
import type { RepoRow } from './repository.js';

async list(workspaceId: string): Promise<RepoRow[]> {
  return this.repo.list(workspaceId);
}
```

```ts
// GOOD: map at the edge. `Repo` is a Zod contract from ring 1 — the shape the
// client agreed to, independent of the table.
import { type Repo } from '@devdigest/shared';
import { toRepoDto } from './helpers.js';

async list(workspaceId: string): Promise<Repo[]> {
  const rows = await this.repo.list(workspaceId);
  return rows.map(toRepoDto);
}

// GOOD: helpers.ts — the mapping is a pure function, testable with a literal.
// This is the real one: it also absorbs camelCase→snake_case and Date→ISO string,
// so neither the column names nor the driver's Date objects reach the client.
export function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return {
    id: row.id,
    full_name: row.fullName,
    clone_path: row.clonePath,
    last_polled_at: row.lastPolledAt?.toISOString() ?? null,
    // …
  };
}
```

## 4. Hand-parsing a request body

```ts
// BAD: validation runs inside the handler, so the failure is a thrown ZodError the
// error handler has to shape-detect. The schema is also invisible to the type provider.
app.post('/repos', async (req) => {
  const body = RepoInput.parse(req.body);
  return service.add(workspaceId, userId, body.url);
});
```

```ts
// GOOD: declared on the route. Invalid input is rejected with 422 before the handler
// body runs, and `req.body` is typed from the contract.
app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
  const { workspaceId, userId } = await getContext(app.container, req);
  const { repo, created } = await service.add(workspaceId, userId, req.body.url);
  reply.status(created ? 201 : 200);       // ← the only decision transport makes
  return repo;
});
```

## 5. A port shaped like the SDK

```ts
// BAD: this is not a port, it is Octokit with a wrapper. Swapping to the GraphQL API,
// to a cache, or to a fake means changing every caller.
export interface GitHubClient {
  octokit: Octokit;
  request(route: string, params: Record<string, unknown>): Promise<{ data: unknown }>;
}
```

```ts
// GOOD: shaped by what the application does. Three implementations satisfy it
// (Octokit, the mock, and one day a cached decorator) and no caller changes.
export interface GitHubClient {
  listPullRequests(repo: RepoRef): Promise<PrMeta[]>;
  getPullRequest(repo: RepoRef, n: number): Promise<PrDetail>;
  postReview(repo: RepoRef, n: number, review: GitHubReviewPayload): Promise<{ id: string }>;
  commitFiles(repo: RepoRef, payload: CommitFilesPayload): Promise<{ branch: string }>;
  currentLogin(): Promise<string>;
}
```

Return types are contract types (`PrMeta`, `PrDetail`), never Octokit response payloads.

## 6. Reaching into a sibling feature

```ts
// BAD: two features are now one. `pulls` cannot change its service signature
// without breaking `reviews`, and the import graph has a cycle waiting to happen.
import { PullService } from '../pulls/service.js';
import { INDEX_JOB_KIND } from '../repo-intel/constants.js';
```

```ts
// GOOD: shared data comes from the composition root, which constructed it once.
const pull = await this.container.reviewRepo.getPull(workspaceId, prId);

// GOOD: shared capability comes from the port, so tests can inject a fake.
const state = await this.container.repoIntel.getIndexState(repoId);

// GOOD: a shared literal is promoted to ring 1, or duplicated. Not imported sideways.
import { INDEX_JOB_KIND } from '@devdigest/shared';
```

## 7. Two repositories, two transactions

```ts
// BAD: not atomic. If the second write fails the first is already committed,
// and the repository has taken a decision that belongs to the caller.
class RepoRepository {
  async insert(values: InsertRepo) {
    return this.db.transaction(async (tx) => tx.insert(t.repos).values(values).returning());
  }
}

async add(...) {
  const repo = await this.repo.insert(values);        // committed
  await this.settings.insertDefaults(repo.id);        // separate transaction — may fail
}
```

```ts
// GOOD: repositories accept a transaction; the service owns the boundary because it
// is the only layer that knows where the business operation starts and ends.
class RepoRepository {
  async insert(values: InsertRepo, tx?: DbTx): Promise<RepoRow> {
    const invoker = tx ?? this.db;                    // works in and out of a transaction
    const [row] = await invoker.insert(t.repos).values(values).returning();
    return row!;
  }
}

// `DbTx` is not defined in this repo yet — see tools.md for the alias to add when the
// first multi-write operation lands.
async add(workspaceId: string, url: string): Promise<Repo> {
  const row = await this.container.db.transaction(async (tx) => {
    const repo = await this.repo.insert({ workspaceId, ...parseRepoUrl(url) }, tx);
    await this.settings.insertDefaults(repo.id, tx);  // same tx, both or neither
    return repo;
  });
  return toRepoDto(row);
}
```

## 8. A use-case test that needs Docker

```ts
// BAD: spins up Postgres to assert a business rule. Slow, Docker-gated, and it is
// really testing that the boundary leaked.
const pg = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
const app = await buildApp({ config, db: await createDb(pg.getConnectionUri()).db });
const res = await app.inject({ method: 'POST', url: '/settings/test-connection',
  payload: { provider: 'github' } });
expect(res.statusCode).toBe(200);
```

```ts
// GOOD: the override bag is the seam. No Docker, no network, milliseconds.
const app = await buildApp({
  config,
  overrides: { github: new MockGitHubClient({ login: 'octocat' }) },
});
const res = await app.inject({ method: 'POST', url: '/settings/test-connection',
  payload: { provider: 'github' } });
expect(res.statusCode).toBe(200);

// GOOD: assert on what the double recorded, not on how it was called.
const gh = new MockGitHubClient({ login: 'octocat' });
await buildApp({ config, overrides: { github: gh } });
await service.publish(workspaceId, prId);
expect(gh.posted).toHaveLength(1);
expect(gh.posted[0].review.event).toBe('REQUEST_CHANGES');
```

Keep the testcontainers harness for what actually needs it: repositories, migrations, and
one real integration per data-backed workflow — named `*.it.test.ts`.

## 9. Over-abstraction — the ceremony that looks like compliance

```ts
// BAD: an interface with one implementation, no second implementer, and no test double.
// It buys nothing and costs a file, an import, and a jump for every reader.
export interface IRepoUrlParser { parse(url: string): { owner: string; name: string } }
export class RepoUrlParser implements IRepoUrlParser { ... }

// BAD: a "domain entity" that is a bag of getters over a contract type.
export class RepoEntity {
  constructor(private readonly row: RepoRow) {}
  get id() { return this.row.id }
  get fullName() { return this.row.fullName }
}

// BAD: a service that only forwards.
class RepoService {
  list(workspaceId: string) { return this.repo.list(workspaceId) }
}
```

```ts
// GOOD: a pure function in helpers.ts. No interface, no class, no injection.
export function parseRepoUrl(url: string): { owner: string; name: string } { ... }

// GOOD: the contract type IS the model. Behaviour that acts on it is a pure function.
import { type Repo } from '@devdigest/shared';
export function isIndexed(repo: Repo): boolean { return repo.indexed }
```

Extract the port when a second implementation or a test needs one — not before (SKILL.md §13).

## 10. Swallowing an adapter failure

```ts
// BAD: the outage is invisible. The endpoint returns an empty list and looks healthy.
try {
  const gh = await container.github();
  pulls = await gh.listPullRequests(repo);
} catch {
  pulls = [];
}
```

```ts
// GOOD: adapter translates, service decides, and the decision is logged.
// adapters/github/octokit.ts — ring 3, the SDK error stops here.
async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
  return withRetry(() => withTimeout(this.fetchPulls(repo), TIMEOUT));
  // failures surface as ExternalServiceError (502) with a message, not an Octokit object
}

// service.ts — ring 2. Local-first is a deliberate product rule, so it is explicit.
private async syncFromGitHub(workspaceId: string, repo: RepoRow): Promise<void> {
  let gh: GitHubClient;
  try {
    gh = await this.container.github();
  } catch (err) {
    this.log.warn({ err }, 'GitHub unavailable; serving persisted PRs');
    return;                                   // documented degradation, not a silent hole
  }
  const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
  await this.repo.upsertMany(workspaceId, repo.id, pulls);
}
```

A facade whose contract is "always answers" — like `RepoIntel` — returns `degraded: true`
with a reason instead of throwing, and its consumers check the flag.

## 11. The core reaching outward

```ts
// BAD: reviewer-core is no longer a pure engine. It now needs a DB connection,
// an SSE bus, and an env var to run a single test.
import { runBus } from '../../server/src/platform/sse.js';
import { db } from '../../server/src/db/client.js';

export async function reviewPullRequest(input: ReviewInput) {
  runBus.emit(input.runId, 'started');
  const findings = await callModel(input);
  await db.insert(t.findings).values(findings);
  if (process.env.STRICT_GROUNDING) { ... }
}
```

```ts
// GOOD: everything outward is a parameter. The engine is testable with a stub provider
// and no infrastructure at all — which is the whole point of ring 0.
export async function reviewPullRequest(input: {
  systemPrompt: string;
  model: string;
  diff: UnifiedDiff;
  llm: LLMProvider;                              // the one injected port
  onEvent?: (e: { kind: string; msg: string; data?: unknown }) => void;
  checkCancelled?: () => void;                   // inverted, not looked up
}): Promise<ReviewOutcome> { ... }

// The server supplies the outside. Persistence happens in the caller, not the engine.
const outcome = await reviewPullRequest({
  ...agentConfig,
  llm: await this.container.llm(agent.provider),
  onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
  checkCancelled: () => {
    if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
  },
});
await this.repo.insertFindings(reviewId, outcome.findings);
```

## 12. A framework type below transport

```ts
// BAD: the service is now reachable only over HTTP. A job or a CLI cannot call it,
// and every test has to fabricate a FastifyRequest.
async run(req: FastifyRequest, reply: FastifyReply) {
  const { workspaceId } = await getContext(this.container, req);
  reply.header('x-run-id', runId);
  ...
}
```

```ts
// GOOD: primitives in, contract types out. The same service backs the route, the job
// handler, and the CI runner.
async runReview(
  workspaceId: string,
  prId: string,
  targets: AgentTarget[],
  log: Logger,                                   // structural type, not pino's
): Promise<{ runs: string[]; reviews: string[] }> { ... }
```
