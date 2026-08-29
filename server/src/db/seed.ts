import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import {
  BREAKING_CHANGE,
  RESPONSE_SCHEMA,
  SECRET_HANDLING,
  SEMVER_DISCIPLINE,
  TENANT_SCOPING,
  TEST_QUALITY_RUBRIC,
} from './seed-skills.js';
import { DEFAULT_WORKSPACE_NAME, SYSTEM_USER_EMAIL } from './constants.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * The agent the demo review — and therefore every eval case seeded from its
 * findings — belongs to. One agent, not several: a set is "this agent's cases",
 * so spreading the twelve findings over several owners would leave none of them
 * with a set worth running. The General Reviewer is the deliberate pick: the
 * findings span security, perf, bug, style and test, and a mixed set read
 * against a security-only prompt would score its own `perf` and `style` cases as
 * misses of a rule that agent was never given.
 */
const DEMO_REVIEW_AGENT = 'General Reviewer';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with commits and files that carry REAL
 * unified-diff patch text, a sample review whose findings are all anchored
 * inside those patches and all decided (accepted or dismissed), the five
 * built-in agents (General + Security + Performance + Test Quality + API
 * Contract), and the two L02 skills with their
 * agent links — all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (conventions, memory, eval, …) once
 * their features are built — they start empty here.
 */

// Declared in db/constants.ts — a module that imports nothing — so the auth
// adapter can resolve the same workspace/user without importing this script.
// Re-exported so existing `from './seed.js'` call sites keep working.
export { DEFAULT_WORKSPACE_NAME, SYSTEM_USER_EMAIL };

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- built-in agents (the five starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  //
  // These come BEFORE the demo PR on purpose. The demo review is owned by one of
  // them, and an eval case inherits its owner from `reviews.agent_id`
  // (`modules/evals/repository.ts` findingWithPatch). Seeding the review while no
  // agent existed left that column null, which turned every one-click case
  // creation into a 422 — a seeded set of zero, AC-35 unreachable, and the
  // recorded demo unable to produce a single case.
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    // ---- L02 agents. Each ships with a skill attached below, because an agent
    // whose knowledge layer is empty is exactly the "before" side of the
    // control experiment, not a useful default.
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Checks the tests: uncovered branches, missed corner cases, over-mocking, flakes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Catches breaking changes to routes, exported signatures and shared types.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files — real unified-diff patch text, derived from PR_482_FILES so the
    // patch and the findings below are ONE authored pair. Seeded files used to
    // carry `patch: null`, which left every grounded read of this PR empty:
    // `groundFindings` drops 100% of findings against an empty diff and nothing
    // in the UI says so (INSIGHTS.md — "Seeded PR files carry `patch: null`").
    await db.insert(t.prFiles).values(
      PR_482_FILES.map((f) => ({
        prId: pr!.id,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
    );

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run.
    // It is OWNED by an agent: `agent_id` is what an eval case built from one of
    // these findings runs under, so a null here is not cosmetic — it is a 422 on
    // every case, i.e. a seeded set of zero.
    const [demoAgent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, DEMO_REVIEW_AGENT)));
    if (!demoAgent) {
      throw new Error(
        `seed: built-in agent "${DEMO_REVIEW_AGENT}" is missing, so the demo review would have ` +
          'no owner and no finding on it could become an eval case',
      );
    }

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: demoAgent.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext, webhook signature checks are skipped for the `legacy` provider, the limiter keys on an unvalidated `x-forwarded-for` header, and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 54,
        model: 'seed',
      })
      .returning();

    // Findings come out of the SAME fixture as the patches, so a finding's
    // [startLine, endLine] cannot drift out of a hunk of its own file.
    await db.insert(t.findings).values(
      PR_482_FILES.flatMap((f) =>
        f.findings.map((finding) => ({ ...finding, reviewId: review!.id, file: f.path })),
      ),
    );
  }

  // ---- L02 skills + the agent links ----
  // `uncovered-branch-gate` is deliberately absent: it arrives through the
  // import preview, which is the whole point of that path.
  await seedSkills(db, workspaceId);

  return { workspaceId, userId };
}

/**
 * The demo PR's files and findings, authored as ONE pair.
 *
 * Both inserts above are derived from this array, and that is the point: a
 * finding's `[startLine, endLine]` is written next to the very hunk it cites, so
 * it cannot drift out of it. `groundFindings`
 * (`reviewer-core/src/grounding.ts`) keeps a diff-finding only if its range
 * intersects a hunk of its own file on the NEW side, and `diffFromPrFiles`
 * (`modules/reviews/diff-loader.ts`) rebuilds the diff from exactly these
 * `patch` strings — so a patch invented independently of the line numbers means
 * every finding is dropped, every citation-accuracy number is 0/0, and nothing
 * anywhere says so. That silent-green failure is what AC-31 exists to catch.
 *
 * `patch` is GitHub-shaped: hunks only, no `diff --git`/`---`/`+++` header —
 * `diffFromPrFiles` prepends those.
 *
 * Every finding carries a decision, because a finding with neither is not a
 * usable eval case (accepted → `must_find`, dismissed → `must_not_flag`).
 */
const ACCEPTED_AT = new Date('2026-08-21T10:20:00.000Z');
const DISMISSED_AT = new Date('2026-08-21T10:24:00.000Z');

type SeedFinding = Omit<typeof t.findings.$inferInsert, 'reviewId' | 'file'>;

type SeedPrFile = {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
  /** Each range must fall inside a hunk of the patch directly above it. */
  findings: SeedFinding[];
};

const PR_482_FILES: SeedPrFile[] = [
  {
    // New file — one hunk, new-side lines 1-41.
    path: 'src/middleware/ratelimit.ts',
    additions: 41,
    deletions: 0,
    patch: `
@@ -0,0 +1,41 @@
+import type { FastifyReply, FastifyRequest } from 'fastify';
+import { RATE_LIMIT } from '../config.js';
+
+type Bucket = { tokens: number; updatedAt: number };
+
+// One bucket per client key.
+const buckets = new Map<string, Bucket>();
+
+function clientKey(req: FastifyRequest): string {
+  const forwarded = req.headers['x-forwarded-for'];
+  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
+  return req.ip;
+}
+
+function take(key: string, now: number): boolean {
+  const bucket = buckets.get(key) ?? { tokens: RATE_LIMIT.burst, updatedAt: now };
+  const elapsed = (now - bucket.updatedAt) / 1000;
+  bucket.tokens = Math.min(RATE_LIMIT.burst, bucket.tokens + elapsed * RATE_LIMIT.perSecond);
+  bucket.updatedAt = now;
+  if (bucket.tokens < 1) {
+    buckets.set(key, bucket);
+    return false;
+  }
+  bucket.tokens -= 1;
+  buckets.set(key, bucket);
+  return true;
+}
+
+export async function rateLimit(req: FastifyRequest, reply: FastifyReply): Promise<void> {
+  const key = clientKey(req);
+  if (take(key, Date.now())) return;
+  req.log.warn({ key, headers: req.headers }, 'rate limit exceeded');
+  await reply
+    .code(429)
+    .header('retry-after', String(RATE_LIMIT.retryAfterSeconds))
+    .send({ error: 'too_many_requests' });
+}
+
+export function resetBuckets(): void {
+  buckets.clear();
+}
`.trim(),
    findings: [
      {
        // hunk 1-41 → line 7
        startLine: 7,
        endLine: 7,
        severity: 'WARNING',
        category: 'perf',
        title: 'Rate-limit bucket map grows without bound',
        rationale:
          'Line 7 declares a process-wide Map keyed by client IP that is never pruned; one entry per distinct caller is retained for the lifetime of the process.',
        suggestion: 'Evict buckets whose `updatedAt` is older than the refill window, or use an LRU with a fixed cap.',
        confidence: 0.81,
        acceptedAt: ACCEPTED_AT,
      },
      {
        // hunk 1-41 → lines 10-12
        startLine: 10,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Limiter keys on an unvalidated `x-forwarded-for` header',
        rationale:
          'Lines 10-12 take the client key from the first value of `x-forwarded-for` with no trusted-proxy check, so any unauthenticated caller can rotate the header and bypass the limiter entirely.',
        suggestion: 'Use Fastify `trustProxy` with the known proxy list and fall back to `req.ip`.',
        confidence: 0.94,
        acceptedAt: ACCEPTED_AT,
      },
      {
        // hunk 1-41 → line 32
        startLine: 32,
        endLine: 32,
        severity: 'WARNING',
        category: 'security',
        title: 'Whole request header set written to the log',
        rationale:
          'Line 32 logs `req.headers` verbatim on every rejection, which puts `authorization` and `cookie` values into the log stream.',
        suggestion: 'Log the client key only, or redact via the Pino `redact` option.',
        confidence: 0.88,
        acceptedAt: ACCEPTED_AT,
      },
      {
        // hunk 1-41 → lines 33-36
        startLine: 33,
        endLine: 36,
        severity: 'SUGGESTION',
        category: 'test',
        title: 'No test covers the 429 branch',
        rationale: 'Lines 33-36 are the only path that returns 429 and no test exercises it.',
        suggestion: 'Add a test that drains the bucket and asserts the status and `retry-after` header.',
        confidence: 0.55,
        dismissedAt: DISMISSED_AT,
      },
      {
        // hunk 1-41 → lines 39-41
        startLine: 39,
        endLine: 41,
        severity: 'SUGGESTION',
        category: 'style',
        title: '`resetBuckets` is exported but unused in production code',
        rationale: 'Lines 39-41 export a function no caller in `src/` uses.',
        suggestion: 'Delete it, or move it behind a test-only entrypoint.',
        confidence: 0.44,
        dismissedAt: DISMISSED_AT,
      },
    ],
  },
  {
    // Two hunks — new-side lines 1-11 and 34-48.
    path: 'src/api/public/webhooks.ts',
    additions: 13,
    deletions: 4,
    patch: `
@@ -1,10 +1,11 @@
 import type { FastifyInstance } from 'fastify';
 import { verifySignature } from '../../lib/signature.js';
+import { rateLimit } from '../../middleware/ratelimit.js';
 
 export function registerWebhookRoutes(app: FastifyInstance): void {
-  app.post('/public/webhooks/:provider', async (req, reply) => {
+  app.post('/public/webhooks/:provider', { preHandler: rateLimit }, async (req, reply) => {
     const { provider } = req.params as { provider: string };
     const raw = req.rawBody!;
-    if (!verifySignature(provider, raw)) {
+    if (provider !== 'legacy' && !verifySignature(provider, raw)) {
       return reply.code(401).send({ error: 'bad_signature' });
     }
@@ -33,7 +34,15 @@ export function registerWebhookRoutes(app: FastifyInstance): void {
     const event = JSON.parse(raw.toString());
     app.log.info({ provider, id: event.id }, 'webhook received');
 
-    await enqueue(provider, event);
-    return reply.code(202).send({ accepted: true });
+    const key = provider + ':' + event.id;
+    if (seen.has(key)) {
+      return reply.code(202).send({ accepted: true, duplicate: true });
+    }
+    seen.add(key);
+
+    await enqueue(provider, event);
+    return reply.code(202).send({ accepted: true, queued: seen.size });
   });
 }
+
+const seen = new Set<string>();
`.trim(),
    findings: [
      {
        // hunk 1-11 → line 9
        startLine: 9,
        endLine: 9,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Webhook signature check skipped for the `legacy` provider',
        rationale:
          'Line 9 short-circuits `verifySignature` whenever the caller sets `:provider` to `legacy`, so anyone who knows the path can post an unsigned webhook.',
        suggestion: 'Verify every provider; give `legacy` its own key rather than an exemption.',
        confidence: 0.96,
        acceptedAt: ACCEPTED_AT,
      },
      {
        // hunk 34-48 → line 44
        startLine: 44,
        endLine: 44,
        severity: 'SUGGESTION',
        category: 'bug',
        title: '202 response gains an undocumented `queued` field',
        rationale: 'Line 44 adds `queued` to a documented response body.',
        suggestion: 'Document the field or drop it from the public response.',
        confidence: 0.5,
        dismissedAt: DISMISSED_AT,
      },
      {
        // hunk 34-48 → lines 47-48
        startLine: 47,
        endLine: 48,
        severity: 'WARNING',
        category: 'perf',
        title: 'Deduplication set is never evicted',
        rationale:
          'Lines 47-48 introduce a module-level Set that gains one entry per webhook event and is never cleared, so it grows for the lifetime of the process.',
        suggestion: 'Bound it with a TTL cache, or dedupe in the queue instead of in memory.',
        confidence: 0.79,
        acceptedAt: ACCEPTED_AT,
      },
    ],
  },
  {
    // One hunk — new-side lines 10-20.
    path: 'src/config.ts',
    additions: 6,
    deletions: 0,
    patch: `
@@ -10,5 +10,11 @@ export const config = {
   port: Number(process.env.PORT ?? 3000),
   databaseUrl: process.env.DATABASE_URL!,
   stripeKey: 'sk_live_EXAMPLE_NOT_A_REAL_KEY',
   webhookSecret: process.env.WEBHOOK_SECRET!,
 };
+
+export const RATE_LIMIT = {
+  perSecond: 5,
+  burst: 20,
+  retryAfterSeconds: 60,
+};
`.trim(),
    findings: [
      {
        // hunk 10-20 → line 12
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
        acceptedAt: ACCEPTED_AT,
      },
      {
        // hunk 10-20 → lines 17-19
        startLine: 17,
        endLine: 19,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Rate-limit thresholds are hardcoded',
        rationale: 'Lines 17-19 fix the limiter thresholds in source, so changing them needs a deploy.',
        suggestion: 'Read them from the environment with these values as defaults.',
        confidence: 0.47,
        dismissedAt: DISMISSED_AT,
      },
    ],
  },
  {
    // One hunk — new-side lines 41-55.
    path: 'src/api/users.ts',
    additions: 9,
    deletions: 2,
    patch: `
@@ -41,8 +41,15 @@ export function registerUserRoutes(app: FastifyInstance): void {
 export function registerUserRoutes(app: FastifyInstance): void {
-  app.get('/users', async (req, reply) => {
+  app.get('/users', { preHandler: rateLimit }, async (req, reply) => {
     const { limit = 50 } = req.query as { limit?: number };
     const rows = await db.select().from(users).limit(limit);
-    const out = rows.map((u) => ({ ...u, teams: [] as Team[] }));
+    const out: UserWithTeams[] = [];
+    for (const u of rows) {
+      const teams = await db
+        .select()
+        .from(teamMembers)
+        .where(eq(teamMembers.userId, u.id));
+      out.push({ ...u, teams });
+    }
     return reply.send({ users: out });
   });
 }
`.trim(),
    findings: [
      {
        // hunk 41-55 → line 42
        startLine: 42,
        endLine: 42,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Route-level `preHandler` duplicates the global limiter',
        rationale: 'Line 42 attaches the limiter per route when the app already registers it globally.',
        suggestion: 'Drop the per-route hook and rely on the global registration.',
        confidence: 0.42,
        dismissedAt: DISMISSED_AT,
      },
      {
        // hunk 41-55 → lines 45-52
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
        acceptedAt: ACCEPTED_AT,
      },
    ],
  },
];

/** Skill bodies live in ./seed-skills.ts; the link order is the prompt order. */
const SEED_SKILLS: Array<{
  skill: Omit<typeof t.skills.$inferInsert, 'workspaceId'>;
  agents: string[];
}> = [
  {
    skill: {
      name: 'test-quality-rubric',
      description: 'Flag new branches that no test asserts on, and untested boundary values.',
      type: 'rubric',
      source: 'manual',
      body: TEST_QUALITY_RUBRIC,
      enabled: true,
      version: 1,
    },
    agents: ['Test Quality Reviewer'],
  },
  // The API Contract Reviewer's knowledge layer. Three of its four skills are
  // seeded; `deprecation-policy` arrives through the import preview
  // (docs/skills/deprecation-policy.md), because walking a foreign file through
  // the trust gate is the point of that path.
  //
  // Link order IS prompt order: what a breaking change IS comes before what a
  // response-shape change costs, which comes before what release it forces.
  {
    skill: {
      name: 'breaking-change',
      description: 'Flag a change that stops an existing caller from working: routes, signatures, shared types.',
      type: 'convention',
      source: 'manual',
      body: BREAKING_CHANGE,
      enabled: true,
      version: 1,
    },
    agents: ['API Contract Reviewer'],
  },
  {
    skill: {
      name: 'response-schema',
      description: 'Flag a response field removed, renamed, retyped, or changed in meaning while keeping its name.',
      type: 'convention',
      source: 'manual',
      body: RESPONSE_SCHEMA,
      enabled: true,
      version: 1,
    },
    agents: ['API Contract Reviewer'],
  },
  {
    skill: {
      name: 'semver-discipline',
      description: 'Decide what release a change forces, and check the diff bumped the version to match.',
      type: 'rubric',
      source: 'manual',
      body: SEMVER_DISCIPLINE,
      enabled: true,
      version: 1,
    },
    agents: ['API Contract Reviewer'],
  },
  // The Security Reviewer's knowledge layer. It was the one built-in agent that
  // linked no skill at all, which is the "before" side of the control
  // experiment shipped as a default — the exact thing the comment on the L02
  // agents above says not to do.
  //
  // Link order IS prompt order: what may never be persisted is absolute, so it
  // comes before what may be read, which is conditional on who is asking.
  {
    skill: {
      name: 'secret-handling',
      description: 'Flag a credential written to the database, to git, to a log, or to a response.',
      type: 'convention',
      source: 'manual',
      body: SECRET_HANDLING,
      enabled: true,
      version: 1,
    },
    agents: ['Security Reviewer'],
  },
  {
    skill: {
      name: 'tenant-scoping',
      description: 'Flag a query that matches on an id without also scoping to the caller’s workspace.',
      type: 'convention',
      source: 'manual',
      body: TENANT_SCOPING,
      enabled: true,
      version: 1,
    },
    agents: ['Security Reviewer'],
  },
];

async function seedSkills(db: Db, workspaceId: string): Promise<void> {
  // Next free `order` per agent. Every link used to be written at 0, which was
  // invisible while each agent had exactly one skill: `linkedSkills` sorts by
  // `order`, so three rows at 0 leave the tiebreak to whatever the planner
  // returns, and the prompt's skill order changes for no reason. Order is
  // meaningful — for the API Contract Reviewer, what a breaking change IS has to
  // come before what release it forces.
  const nextOrder = new Map<string, number>();

  for (const entry of SEED_SKILLS) {
    let [skill] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, entry.skill.name!)));

    if (!skill) {
      [skill] = await db
        .insert(t.skills)
        .values({ ...entry.skill, workspaceId } as typeof t.skills.$inferInsert)
        .returning();
      // v1 snapshot, so the skill's history starts where its version does.
      await db
        .insert(t.skillVersions)
        .values({ skillId: skill!.id, version: 1, body: skill!.body })
        .onConflictDoNothing();
    }

    for (const agentName of entry.agents) {
      const [agent] = await db
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
      if (!agent) continue;
      const order = nextOrder.get(agent.id) ?? 0;
      nextOrder.set(agent.id, order + 1);
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId: skill!.id, order })
        .onConflictDoNothing();
    }
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
