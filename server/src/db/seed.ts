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
  SEMVER_DISCIPLINE,
  TEST_QUALITY_RUBRIC,
} from './seed-skills.js';
import { DEFAULT_WORKSPACE_NAME, SYSTEM_USER_EMAIL } from './constants.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the five built-in agents (General + Security +
 * Performance + Test Quality + API Contract), and the two L02 skills with their
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

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
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

  // ---- L02 skills + the agent links ----
  // `uncovered-branch-gate` is deliberately absent: it arrives through the
  // import preview, which is the whole point of that path.
  await seedSkills(db, workspaceId);

  return { workspaceId, userId };
}

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
