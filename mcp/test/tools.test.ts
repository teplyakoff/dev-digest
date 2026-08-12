import { describe, expect, it } from 'vitest';
import { FakeApiClient, type FakeApiData } from '../src/api/fake-client.js';
import type { Deps } from '../src/deps.js';
import { Resolver } from '../src/resolve.js';
import { TOOLS } from '../src/tools/index.js';
import { getBlastRadius } from '../src/tools/get-blast-radius.js';
import { getConventions } from '../src/tools/get-conventions.js';
import { getFindings } from '../src/tools/get-findings.js';
import { listAgents } from '../src/tools/list-agents.js';
import type { ToolExtra } from '../src/tools/types.js';
import { makeAgent, makeCandidate, makeFinding, makePr, makeRepo, makeReview } from './fixtures.js';

function ctx(data: Partial<FakeApiData> = {}): { deps: Deps; api: FakeApiClient; extra: ToolExtra } {
  const api = new FakeApiClient(data);
  return {
    api,
    deps: { api, resolver: new Resolver(api) },
    extra: { signal: new AbortController().signal, sendNotification: async () => {} },
  };
}

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join('\n');

/** A repo whose extractor HAS run — the precondition for reading a skill draft. */
function withScan(): Partial<FakeApiData> {
  return {
    repos: [makeRepo()],
    conventions: {
      'repo-1': {
        scan: {
          id: 's1',
          repo_id: 'repo-1',
          indexed_sha: 'deadbeefcafe',
          sampled_files: [],
          config_files: [],
          proposed: 4,
          kept: 2,
          dropped: [],
          provider: 'openai',
          model: 'gpt-5.4',
          tokens_in: 10,
          tokens_out: 20,
          cost_usd: 0,
          created_at: '2026-08-11T10:00:00.000Z',
        },
        candidates: [makeCandidate()],
      },
    },
  };
}

describe('the tool registry', () => {
  // Every extra tool costs 200-550 tokens in EVERY session in this repo.
  it('holds exactly five tools with unique names', () => {
    expect(TOOLS).toHaveLength(5);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(5);
  });

  it('declares exactly one outputSchema, on the run tool', () => {
    const withOutput = TOOLS.filter((t) => t.config.outputSchema !== undefined);
    expect(withOutput.map((t) => t.name)).toEqual(['run_agent_on_pull_request']);
  });

  it('marks exactly one tool as not read-only', () => {
    const writers = TOOLS.filter((t) => !t.config.annotations.readOnlyHint);
    expect(writers.map((t) => t.name)).toEqual(['run_agent_on_pull_request']);
  });

  it('keeps every description within six lines', () => {
    for (const t of TOOLS) {
      expect(t.config.description.split('\n').length, t.name).toBeLessThanOrEqual(6);
    }
  });
});

describe('list_agents', () => {
  it('returns enabled agents by default and omits the system prompt', async () => {
    const { deps, extra } = ctx({
      agents: [makeAgent(), makeAgent({ id: 'a2', name: 'Off', enabled: false })],
    });
    const out = text(await listAgents.handler({}, deps, extra));
    expect(out).toContain('General Reviewer');
    expect(out).not.toContain('Off —');
    expect(out).not.toContain('You are a careful reviewer.');
  });

  // The SDK validates before the handler, but a handler must also stand alone —
  // that is what makes `.default()` observable in a unit test.
  it('applies its defaults when called with no arguments at all', async () => {
    const { deps, extra } = ctx({ agents: [makeAgent()] });
    expect(text(await listAgents.handler(undefined, deps, extra))).toContain('General Reviewer');
  });

  it('includes the prompt on request, wrapped as untrusted', async () => {
    const { deps, extra } = ctx({ agents: [makeAgent()] });
    const out = text(await listAgents.handler({ include_prompt: true }, deps, extra));
    expect(out).toContain('<untrusted source="agent-system-prompt:General Reviewer">');
  });

  it('distinguishes "none enabled" from "none exist"', async () => {
    const off = ctx({ agents: [makeAgent({ enabled: false })] });
    expect(text(await listAgents.handler({}, off.deps, off.extra))).toMatch(/switched off/);
    const none = ctx({ agents: [] });
    expect(text(await listAgents.handler({}, none.deps, none.extra))).toMatch(/No review agents/);
  });

  it('rejects an unknown argument rather than ignoring it', async () => {
    const { deps, extra } = ctx({ agents: [makeAgent()] });
    const res = await listAgents.handler({ enabledOnly: true }, deps, extra);
    expect(res.isError).toBe(true);
  });

  it('reports an unreachable API with the command that fixes it', async () => {
    const { deps, extra, api } = ctx({});
    api.data.failures.listAgents = new (await import('../src/api/errors.js')).ApiError(
      'unreachable',
      'GET /agents: fetch failed',
    );
    const res = await listAgents.handler({}, deps, extra);
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('./scripts/dev.sh');
  });
});

describe('get_findings', () => {
  const base = () =>
    ctx({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr()] },
      reviews: {
        'pr-1': [
          // Three agents, one PR. The newest row has ZERO findings — the exact
          // shape that made `reviews.find(...)` report 0 on a PR that had 13
          // (server/INSIGHTS.md:343-356).
          makeReview({ id: 'rev-3', agent_name: 'API Contract Reviewer', findings: [] }),
          makeReview({
            id: 'rev-2',
            agent_name: 'Test Quality Reviewer',
            findings: [
              makeFinding({ id: 'f-2', severity: 'CRITICAL', category: 'security', file: 'server/src/auth.ts' }),
            ],
          }),
          makeReview({
            id: 'rev-1',
            agent_name: 'General Reviewer',
            findings: [makeFinding({ id: 'f-1' })],
          }),
          // A summary row must not contribute findings.
          makeReview({ id: 'sum-1', kind: 'summary', findings: [makeFinding({ id: 'f-ignored' })] }),
        ],
      },
    });

  it('UNIONS every kind:"review" row instead of picking the latest', async () => {
    const { deps, extra } = base();
    const out = text(await getFindings.handler({ pull_request: 'acme/payments-api#482' }, deps, extra));
    expect(out).toContain('2 matching finding(s) of 2 total');
    expect(out).toContain('3 agent(s)');
    expect(out).toContain('f-ignored'.replace('f-ignored', 'Unbounded retry loop'));
  });

  it('ignores summary rows', async () => {
    const { deps, extra } = base();
    const out = text(
      await getFindings.handler(
        { pull_request: 'acme/payments-api#482', response_format: 'detailed' },
        deps,
        extra,
      ),
    );
    expect(out).not.toContain('f-ignored');
  });

  it('filters by severity and by path', async () => {
    const { deps, extra } = base();
    const bySeverity = text(
      await getFindings.handler(
        { pull_request: 'acme/payments-api#482', severity: 'CRITICAL' },
        deps,
        extra,
      ),
    );
    expect(bySeverity).toContain('1 matching finding(s) of 2 total');
    const byPath = text(
      await getFindings.handler(
        { pull_request: 'acme/payments-api#482', path_contains: 'auth' },
        deps,
        extra,
      ),
    );
    expect(byPath).toContain('server/src/auth.ts');
  });

  it('separates "never reviewed" from "nothing matched"', async () => {
    const empty = ctx({ repos: [makeRepo()], pulls: { 'repo-1': [makePr()] }, reviews: {} });
    expect(
      text(await getFindings.handler({ pull_request: 'acme/payments-api#482' }, empty.deps, empty.extra)),
    ).toMatch(/no findings recorded/);

    const { deps, extra } = base();
    expect(
      text(
        await getFindings.handler(
          { pull_request: 'acme/payments-api#482', category: 'style' },
          deps,
          extra,
        ),
      ),
    ).toMatch(/none match the filters/);
  });

  it('respects limit and offset and says so', async () => {
    const { deps, extra } = base();
    const out = text(
      await getFindings.handler(
        { pull_request: 'acme/payments-api#482', limit: 1, offset: 1 },
        deps,
        extra,
      ),
    );
    expect(out).toContain('Showing 1 from offset 1');
  });
});

describe('get_conventions', () => {
  it('reports "the extractor never ran" as its own state, not as "no conventions"', async () => {
    const { deps, extra } = ctx({
      repos: [makeRepo()],
      conventions: { 'repo-1': { scan: null, candidates: [] } },
    });
    const out = text(await getConventions.handler({ repo: 'acme/payments-api' }, deps, extra));
    expect(out).toMatch(/never run/);
    expect(out).toContain('conventions/extract');
  });

  it('projects rule + evidence line reference, wrapped as untrusted', async () => {
    const { deps, extra } = ctx({
      repos: [makeRepo()],
      conventions: {
        'repo-1': {
          scan: {
            id: 's1',
            repo_id: 'repo-1',
            indexed_sha: 'deadbeefcafe',
            sampled_files: [],
            config_files: [],
            proposed: 4,
            kept: 2,
            dropped: [],
            provider: 'openai',
            model: 'gpt-5.4',
            tokens_in: 10,
            tokens_out: 20,
            cost_usd: 0,
            created_at: '2026-08-11T10:00:00.000Z',
          },
          candidates: [makeCandidate(), makeCandidate({ id: 'c-2', status: 'pending' })],
        },
      },
    });
    const out = text(await getConventions.handler({ repo: 'acme/payments-api' }, deps, extra));
    expect(out).toContain('<untrusted source="repository-conventions">');
    expect(out).toContain('server/src/modules/repos/repository.ts:12-18');
    // status defaults to `accepted`, so the pending candidate is filtered out.
    expect(out).toContain('1 convention(s) of 2');
  });

  it('degrades when the skill draft is missing, and still answers', async () => {
    const { deps, extra } = ctx(withScan());
    const res = await getConventions.handler(
      { repo: 'acme/payments-api', include_skill_draft: true },
      deps,
      extra,
    );

    // The draft 404s until something has been accepted. Enrichment degrades,
    // the read does not fail (onion §10) — but it is logged, never silent.
    expect(res.isError).toBeUndefined();
    expect(text(res)).not.toContain('Merged skill body');
    expect((deps.api as FakeApiClient).calls).toContain('getConventionSkillDraft(repo-1)');
  });

  it('does NOT degrade when the failure is the caller cancelling', async () => {
    const controller = new AbortController();
    const api = new FakeApiClient(withScan());
    const deps: Deps = { api, resolver: new Resolver(api) };
    controller.abort();

    const res = await getConventions.handler(
      { repo: 'acme/payments-api', include_skill_draft: true },
      deps,
      { signal: controller.signal, sendNotification: async () => {} },
    );

    // "No skill draft" would be the wrong answer to a question nobody is
    // waiting for. A cancellation has to surface, not be absorbed as degradation.
    expect(res.isError).toBe(true);
  });
});

describe('get_blast_radius', () => {
  it('is registered and visible, not hidden', () => {
    expect(TOOLS.map((t) => t.name)).toContain('get_blast_radius');
  });

  it('ALWAYS fails, invents nothing, and points at what does work', async () => {
    const { deps, extra } = ctx({});
    const res = await getBlastRadius.handler(
      { repo: 'acme/payments-api', path: 'server/src/auth.ts' },
      deps,
      extra,
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/not implemented/i);
    expect(text(res)).toContain('get_findings');
    // It must not have called the API at all.
    expect((deps.api as FakeApiClient).calls).toEqual([]);
  });
});
