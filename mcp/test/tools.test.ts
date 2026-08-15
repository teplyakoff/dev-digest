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
import {
  makeAgent,
  makeBlast,
  makeCandidate,
  makeFinding,
  makePr,
  makeRepo,
  makeReview,
} from './fixtures.js';

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

  /*
   * The projection is the contract, so the field that is NOT there needs a test
   * as much as the fields that are — nothing else fails when someone adds
   * `${a.provider}/` back into the head line while making it read better.
   */
  it('never projects the agent’s provider', async () => {
    const { deps, extra } = ctx({
      agents: [makeAgent({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' })],
    });
    const out = text(await listAgents.handler({ enabled_only: false }, deps, extra));
    expect(out).toContain('deepseek/deepseek-v4-flash');
    expect(out).not.toContain('openrouter');
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
          // Three agents, one PR, ONE run each — so every distinct `agent_id`
          // must survive `all_runs: false`. The newest row has ZERO findings:
          // the exact shape that made `reviews.find(...)` report 0 on a PR that
          // had 13 (server/INSIGHTS.md:343-356).
          makeReview({
            id: 'rev-3',
            agent_id: 'agent-3',
            agent_name: 'API Contract Reviewer',
            findings: [],
          }),
          makeReview({
            id: 'rev-2',
            agent_id: 'agent-2',
            agent_name: 'Test Quality Reviewer',
            findings: [
              makeFinding({ id: 'f-2', severity: 'CRITICAL', category: 'security', file: 'server/src/auth.ts' }),
            ],
          }),
          makeReview({
            id: 'rev-1',
            agent_id: 'agent-1',
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

  /*
   * `all_runs`. The two axes this tool has to keep apart: union ACROSS AGENTS
   * always, take the newest run WITHIN one agent by default. Every test below
   * pins one half against the other.
   */

  /** One agent, two runs — the re-run found nothing where the first found a CRITICAL. */
  const rerun = () =>
    ctx({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr()] },
      reviews: {
        'pr-1': [
          makeReview({
            id: 'rev-1b',
            run_id: 'run-2',
            created_at: '2026-08-11T12:00:00.000Z',
            findings: [],
          }),
          makeReview({
            id: 'rev-1a',
            run_id: 'run-1',
            created_at: '2026-08-11T10:00:00.000Z',
            findings: [makeFinding({ id: 'f-old', title: 'Superseded finding' })],
          }),
        ],
      },
    });

  it('hides an agent’s superseded run by default, and says how many it hid', async () => {
    const { deps, extra } = rerun();
    const out = text(await getFindings.handler({ pull_request: 'acme/payments-api#482' }, deps, extra));
    expect(out).not.toContain('Superseded finding');
    // A shrunken total must never read as "reviewed and clean" with no caveat.
    expect(out).toContain('1 superseded review row(s) not counted');
    expect(out).toContain('all_runs: true');
    // …and "reviewed, found nothing" is not the same answer as "never reviewed".
    expect(out).not.toMatch(/Nothing has reviewed/);
  });

  it('returns the superseded run under all_runs: true', async () => {
    const { deps, extra } = rerun();
    const out = text(
      await getFindings.handler(
        { pull_request: 'acme/payments-api#482', all_runs: true },
        deps,
        extra,
      ),
    );
    expect(out).toContain('Superseded finding');
    expect(out).toContain('1 matching finding(s) of 1 total');
    expect(out).not.toContain('superseded review row(s) not counted');
  });

  it('picks the newest run by created_at, not by the order the API returned', async () => {
    const { deps, extra } = ctx({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr()] },
      reviews: {
        'pr-1': [
          // Deliberately OLDEST FIRST — the opposite of `reviewsForPull`'s own
          // `createdAt DESC`, so a handler that trusted arrival order fails here.
          makeReview({
            id: 'rev-old',
            created_at: '2026-08-11T10:00:00.000Z',
            findings: [makeFinding({ id: 'f-old', title: 'Superseded finding' })],
          }),
          makeReview({
            id: 'rev-new',
            created_at: '2026-08-11T12:00:00.000Z',
            findings: [makeFinding({ id: 'f-new', title: 'Current finding' })],
          }),
        ],
      },
    });
    const out = text(await getFindings.handler({ pull_request: 'acme/payments-api#482' }, deps, extra));
    expect(out).toContain('Current finding');
    expect(out).not.toContain('Superseded finding');
  });

  it('dedupes per agent, never across them', async () => {
    const { deps, extra } = base();
    // A second run of ONE of the three agents must not evict the other two.
    const { deps: d2, extra: e2 } = ctx({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr()] },
      reviews: {
        'pr-1': [
          makeReview({
            id: 'rev-2b',
            agent_id: 'agent-2',
            agent_name: 'Test Quality Reviewer',
            created_at: '2026-08-11T12:00:00.000Z',
            findings: [makeFinding({ id: 'f-2b', title: 'Re-run finding' })],
          }),
          makeReview({
            id: 'rev-2a',
            agent_id: 'agent-2',
            agent_name: 'Test Quality Reviewer',
            created_at: '2026-08-11T10:00:00.000Z',
            findings: [makeFinding({ id: 'f-2a', title: 'Superseded finding' })],
          }),
          makeReview({
            id: 'rev-1',
            agent_id: 'agent-1',
            agent_name: 'General Reviewer',
            created_at: '2026-08-11T09:00:00.000Z',
            findings: [makeFinding({ id: 'f-1', title: 'Other agent finding' })],
          }),
        ],
      },
    });
    const out = text(await getFindings.handler({ pull_request: 'acme/payments-api#482' }, d2, e2));
    expect(out).toContain('2 agent(s)');
    expect(out).toContain('Re-run finding');
    expect(out).toContain('Other agent finding');
    expect(out).not.toContain('Superseded finding');
    // The untouched fixture still unions all three of its agents.
    expect(
      text(await getFindings.handler({ pull_request: 'acme/payments-api#482' }, deps, extra)),
    ).toContain('3 agent(s)');
  });

  it('keeps every orphaned review row instead of collapsing them into one', async () => {
    // A deleted agent leaves `agent_id` AND `agent_name` null. Keying those
    // together would silently drop all but the newest orphan.
    const { deps, extra } = ctx({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr()] },
      reviews: {
        'pr-1': [
          makeReview({
            id: 'rev-x',
            agent_id: null,
            agent_name: null,
            created_at: '2026-08-11T12:00:00.000Z',
            findings: [makeFinding({ id: 'f-x', title: 'Orphan one' })],
          }),
          makeReview({
            id: 'rev-y',
            agent_id: null,
            agent_name: null,
            created_at: '2026-08-11T10:00:00.000Z',
            findings: [makeFinding({ id: 'f-y', title: 'Orphan two' })],
          }),
        ],
      },
    });
    const out = text(await getFindings.handler({ pull_request: 'acme/payments-api#482' }, deps, extra));
    expect(out).toContain('Orphan one');
    expect(out).toContain('Orphan two');
    expect(out).not.toContain('superseded review row(s) not counted');
  });

  it('rejects an unknown argument rather than ignoring it', async () => {
    const { deps, extra } = base();
    const res = await getFindings.handler(
      { pull_request: 'acme/payments-api#482', allRuns: true },
      deps,
      extra,
    );
    expect(res.isError).toBe(true);
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

/**
 * This block used to assert the opposite — that the tool ALWAYS failed and
 * never called the API — because there was no blast-radius route to call. There
 * is one now (`GET /pulls/:id/blast`), so the stub's promise has been kept:
 * "add the route on the server, then replace this body."
 *
 * What did NOT change is the principle underneath it. An unindexed repository
 * still comes back as an error, because "no callers found" is a claim about the
 * code and an absent index has not earned it.
 */
describe('get_blast_radius', () => {
  const PR_ARG = { pull_request: 'acme/payments-api#482' };

  function blastCtx(map = makeBlast()) {
    return ctx({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr({ id: 'pr-1', number: 482 })] },
      blast: { 'pr-1': map },
    });
  }

  it('is registered and visible, not hidden', () => {
    expect(TOOLS.map((t) => t.name)).toContain('get_blast_radius');
  });

  it('reports each changed symbol with its callers, cited by file and line', async () => {
    const { deps, extra } = blastCtx();
    const res = await getBlastRadius.handler(PR_ARG, deps, extra);

    expect(res.isError).toBeFalsy();
    const out = text(res);
    expect(out).toContain('acme/payments-api#482');
    expect(out).toContain('toRepoDto');
    expect(out).toContain('server/src/modules/repos/service.ts:92');
    expect(out).toContain('server/src/modules/repos/service.ts:107');
    // Read through the same route the UI renders.
    expect((deps.api as FakeApiClient).calls).toContain('getBlast(pr-1)');
  });

  it('distinguishes an endpoint the PR changes from one it merely reaches', async () => {
    const { deps, extra } = blastCtx(
      makeBlast({
        endpoints: [
          { route: 'POST /repos', file: 'routes.ts', depth: 0, via: 'routes.ts' },
          { route: 'GET /repos/:id', file: 'routes.ts', depth: 2, via: 'helpers.ts' },
        ],
      }),
    );
    const out = text(await getBlastRadius.handler(PR_ARG, deps, extra));
    expect(out).toContain('POST /repos — routes.ts (in a changed file)');
    expect(out).toContain('2 hop(s) downstream of helpers.ts');
  });

  it('ERRORS on an unindexed repository instead of reporting "no callers"', async () => {
    // The fake answers the server's real degraded body when it holds no map.
    const { deps, extra } = ctx({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr({ id: 'pr-1', number: 482 })] },
    });
    const res = await getBlastRadius.handler(PR_ARG, deps, extra);

    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/not been indexed/i);
    // THE ASSERTION THAT MATTERS: an absence of data must never be phrased as a
    // finding about the code, because the reader is another model.
    expect(text(res)).not.toMatch(/no callers found/i);
    expect(text(res)).toMatch(/resync|re-?analyze/i);
  });

  it('carries the caveat when the index is incomplete, and still answers', async () => {
    const { deps, extra } = blastCtx(
      makeBlast({ status: 'partial', reason: 'The index for this repository is incomplete.' }),
    );
    const res = await getBlastRadius.handler(PR_ARG, deps, extra);
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('INCOMPLETE: The index for this repository is incomplete.');
    expect(text(res)).toContain('toRepoDto');
  });

  it('filters to one symbol, and says so when that symbol is not in the diff', async () => {
    const { deps, extra } = blastCtx();
    const hit = text(await getBlastRadius.handler({ ...PR_ARG, symbol: 'toRepoDto' }, deps, extra));
    expect(hit).toContain('toRepoDto');
    expect(hit).not.toContain('parseRepoUrl');
    // The header counts the FILTERED symbols' callers. Quoting the PR-wide
    // total beside one symbol invites attributing all of them to it.
    expect(hit).toContain('1 changed symbol(s), 2 caller(s)');

    const { deps: d2, extra: e2 } = blastCtx();
    const miss = await getBlastRadius.handler({ ...PR_ARG, symbol: 'nope' }, d2, e2);
    expect(miss.isError).toBe(true);
    // Naming what IS there beats a bare "not found" — the caller can retry.
    expect(text(miss)).toContain('toRepoDto');
  });

  it('says the server capped the list, and only when it actually did', async () => {
    const capped = blastCtx(makeBlast({ counts: { symbols: 63, callers: 2, endpoints: 1 } }));
    expect(text(await getBlastRadius.handler(PR_ARG, capped.deps, capped.extra))).toContain(
      'The server capped this at 2 of 63',
    );

    const whole = blastCtx();
    expect(text(await getBlastRadius.handler(PR_ARG, whole.deps, whole.extra))).not.toContain(
      'capped',
    );

    // With `symbol` set the short list is the FILTER's doing, so calling it a
    // server cap would blame the wrong thing.
    const filtered = blastCtx(makeBlast({ counts: { symbols: 63, callers: 2, endpoints: 1 } }));
    const out = text(
      await getBlastRadius.handler(
        { ...PR_ARG, symbol: 'toRepoDto' },
        filtered.deps,
        filtered.extra,
      ),
    );
    expect(out).not.toContain('capped');
  });

  it('rejects an unknown argument rather than ignoring it', async () => {
    const { deps, extra } = blastCtx();
    const res = await getBlastRadius.handler({ ...PR_ARG, path: 'src/auth.ts' }, deps, extra);
    // The tool is PR-keyed now; a `path` is the old stub's argument, and
    // silently dropping it would answer a question nobody asked.
    expect(res.isError).toBe(true);
  });
});
