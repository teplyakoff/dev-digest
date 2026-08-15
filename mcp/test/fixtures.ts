import type {
  Agent,
  BlastResponse,
  ConventionCandidate,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';

/** Fixture builders. Every field is a real contract field — no `as any` shortcuts. */

export function makeRepo(over: Partial<Repo> = {}): Repo {
  const full = over.full_name ?? 'acme/payments-api';
  const [owner = 'acme', name = 'payments-api'] = full.split('/');
  return {
    id: 'repo-1',
    workspace_id: 'ws-1',
    owner,
    name,
    full_name: full,
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...over,
  };
}

export function makePr(over: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pr-1',
    number: 482,
    title: 'Add idempotency keys to the payments endpoint',
    author: 'octocat',
    branch: 'feat/idempotency',
    base: 'main',
    head_sha: 'abc1234',
    additions: 120,
    deletions: 12,
    files_count: 4,
    status: 'needs_review',
    ...over,
  };
}

export function makeAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'General Reviewer',
    description: 'Reviews anything.',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    system_prompt: 'You are a careful reviewer.\n'.repeat(40),
    enabled: true,
    version: 3,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    skills_count: 2,
    ...over,
  };
}

export function makeFinding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'f-1',
    review_id: 'rev-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Unbounded retry loop',
    file: 'server/src/modules/payments/service.ts',
    start_line: 44,
    end_line: 51,
    rationale: 'The loop has no ceiling, so a persistent 500 spins forever.',
    suggestion: 'Cap the attempts and surface the failure.',
    confidence: 0.8,
    kind: 'finding',
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

export function makeReview(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'rev-1',
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'General Reviewer',
    kind: 'review',
    verdict: 'comment',
    summary: 'Mostly fine.',
    score: 72,
    model: 'deepseek/deepseek-v4-flash',
    grounding: '3/4 passed',
    created_at: '2026-08-11T10:00:00.000Z',
    findings: [],
    ...over,
  };
}

export function makeRun(over: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'General Reviewer',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    status: 'running',
    error: null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    findings_count: null,
    grounding: null,
    ran_at: '2026-08-11T10:00:00.000Z',
    score: null,
    blockers: null,
    ...over,
  };
}

export function makeCandidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: 'c-1',
    category: 'naming',
    rule: 'Repository methods are named getX / listX, never fetchX.',
    evidence_path: 'server/src/modules/repos/repository.ts',
    evidence_start_line: 12,
    evidence_end_line: 18,
    evidence_snippet: 'async listRepos(workspaceId: string) {',
    confidence: 0.9,
    status: 'accepted',
    skill_id: null,
    ...over,
  };
}

/**
 * A full impact map: two changed symbols, one of them called from two places,
 * and two endpoints at different distances from the diff.
 *
 * Modelled on the real shape `demo/contract-break` produces — a shared DTO
 * helper whose callers sit in the service next door, with the routes two hops
 * out — so the assertions here describe something the demo actually renders.
 */
export function makeBlast(over: Partial<BlastResponse> = {}): BlastResponse {
  return {
    status: 'full',
    reason: null,
    changed_files: ['server/src/modules/repos/helpers.ts'],
    symbols: [
      {
        name: 'toRepoDto',
        file: 'server/src/modules/repos/helpers.ts',
        kind: 'function',
        callers: [
          { file: 'server/src/modules/repos/service.ts', symbol: 'add', line: 92, rank: 0.9 },
          { file: 'server/src/modules/repos/service.ts', symbol: 'list', line: 107, rank: 0.9 },
        ],
        callers_total: 2,
      },
      {
        name: 'parseRepoUrl',
        file: 'server/src/modules/repos/helpers.ts',
        kind: 'function',
        callers: [],
        callers_total: 0,
      },
    ],
    endpoints: [
      {
        route: 'POST /repos',
        file: 'server/src/modules/repos/routes.ts',
        depth: 2,
        via: 'server/src/modules/repos/helpers.ts',
      },
    ],
    crons: [],
    indexed_sha: 'abc1234def5678',
    counts: { symbols: 2, callers: 2, endpoints: 1 },
    ...over,
  };
}
