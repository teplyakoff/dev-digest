import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApiClient, type FakeApiData } from '../src/api/fake-client.js';
import type { Deps } from '../src/deps.js';
import { backoffFor, pollUntil } from '../src/poll.js';
import { Resolver } from '../src/resolve.js';
import { runAgentOnPullRequest } from '../src/tools/run-agent.js';
import type { ToolExtra } from '../src/tools/types.js';
import { makeAgent, makeFinding, makePr, makeRepo, makeReview, makeRun } from './fixtures.js';

/**
 * ZERO real HTTP and ZERO spend: everything goes through `FakeApiClient`, and
 * the 2 s / 5 s / 10 s backoff is walked with vitest's fake timers rather than
 * waited out.
 */

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join('\n');

function ctx(data: Partial<FakeApiData>, controller = new AbortController()) {
  const api = new FakeApiClient({
    repos: [makeRepo()],
    pulls: { 'repo-1': [makePr()] },
    agents: [makeAgent()],
    reviewRun: {
      pr_id: 'pr-1',
      runs: [{ run_id: 'run-new', agent_id: 'agent-1', agent_name: 'General Reviewer' }],
      // Always [] — the server fires the runs and returns (F1).
      reviews: [],
    },
    ...data,
  });
  const deps: Deps = { api, resolver: new Resolver(api) };
  const sent: unknown[] = [];
  const extra: ToolExtra = {
    signal: controller.signal,
    sendNotification: async (n) => {
      sent.push(n);
    },
  };
  return { api, deps, extra, sent, controller };
}

/** Runs the handler to completion while driving the fake clock. */
async function withClock<T>(work: Promise<T>): Promise<T> {
  const done = work.then((v) => ({ v }));
  for (let i = 0; i < 400; i++) {
    await vi.advanceTimersByTimeAsync(1_000);
    const settled = await Promise.race([done, Promise.resolve(null)]);
    if (settled) return settled.v;
  }
  return (await done).v;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('backoff', () => {
  it('is 2 s → 5 s → 10 s and then holds at 10 s', () => {
    expect([0, 1, 2, 3, 50].map(backoffFor)).toEqual([2_000, 5_000, 10_000, 10_000, 10_000]);
  });
});

describe('pollUntil cancellation', () => {
  /*
   * There are two cancellation windows, not one, and only the sleep-window was
   * covered before: an abort that lands mid-request REJECTS the fetch instead
   * of resolving it. Letting that rejection escape surfaced a cancelled call as
   * "Unexpected failure: This operation was aborted" with no run ids in it.
   * `FakeApiClient` ignores `signal`, so this is pinned at the poller.
   */
  it('reports an abort that lands while the request is in flight', async () => {
    const controller = new AbortController();
    const outcome = await pollUntil<string>({
      fetch: (s) =>
        new Promise<string>((_resolve, reject) => {
          s.addEventListener('abort', () => reject(new Error('The operation was aborted')), {
            once: true,
          });
          controller.abort();
        }),
      done: () => false,
      maxWaitMs: 60_000,
      signal: controller.signal,
    });

    expect(outcome.status).toBe('aborted');
    expect(outcome.ticks).toBe(0);
  });

  it('still propagates a genuine fetch failure rather than calling it a cancellation', async () => {
    await expect(
      pollUntil<string>({
        fetch: () => Promise.reject(new Error('boom')),
        done: () => false,
        maxWaitMs: 60_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('boom');
  });
});

describe('run_agent_on_pull_request', () => {
  it('polls running → running → done and summarises', async () => {
    const { deps, extra, api } = ctx({
      runTicks: [
        [makeRun({ run_id: 'run-new', status: 'running' })],
        [makeRun({ run_id: 'run-new', status: 'running' })],
        [
          makeRun({
            run_id: 'run-new',
            status: 'done',
            score: 72,
            blockers: 1,
            findings_count: 2,
            cost_usd: 0.0015,
            duration_ms: 41_000,
            grounding: '2/3 passed',
          }),
        ],
      ],
      reviews: {
        'pr-1': [
          makeReview({
            run_id: 'run-new',
            findings: [
              makeFinding({ id: 'f-1', severity: 'SUGGESTION' }),
              makeFinding({ id: 'f-2', severity: 'CRITICAL', title: 'Missing tenant scope' }),
            ],
          }),
        ],
      },
    });

    const res = await withClock(
      runAgentOnPullRequest.handler({ pull_request: 'acme/payments-api#482' }, deps, extra),
    );

    expect(res.isError).toBeUndefined();
    const out = text(res);
    expect(out).toContain('2 finding(s) — 1 CRITICAL, 0 WARNING, 1 SUGGESTION');
    expect(out).toContain('score 72');
    expect(out).toContain('$0.001500');
    // CRITICAL first, and the preview is wrapped as untrusted.
    expect(out).toContain('<untrusted source="pull-request-findings">');
    expect(out.indexOf('Missing tenant scope')).toBeLessThan(out.indexOf('Unbounded retry loop'));

    expect(res.structuredContent).toEqual({
      status: 'completed',
      run_ids: ['run-new'],
      findings_total: 2,
      critical: 1,
      warning: 0,
      suggestion: 1,
    });

    // The expected call sequence: resolve, resolve agent, POST, poll×3, read back.
    expect(api.calls).toEqual([
      'listRepos()',
      'listPulls(repo-1)',
      'listAgents()',
      'startReview(pr-1 {"agentId":"agent-1"})',
      'listRuns(pr-1)',
      'listRuns(pr-1)',
      'listRuns(pr-1)',
      'listReviews(pr-1)',
    ]);
  });

  // Without the run-id filter the loop settles on the OLD `done` run and
  // reports the previous review's findings as if they were new.
  it('ignores a pre-existing done run and waits for the one it started', async () => {
    const old = makeRun({ run_id: 'run-old', status: 'done', score: 99, findings_count: 0 });
    const { deps, extra } = ctx({
      runTicks: [
        [old, makeRun({ run_id: 'run-new', status: 'running' })],
        [old, makeRun({ run_id: 'run-new', status: 'done', score: 40, findings_count: 1 })],
      ],
      reviews: {
        'pr-1': [
          makeReview({ id: 'old-rev', run_id: 'run-old', findings: [makeFinding({ id: 'stale' })] }),
          makeReview({ id: 'new-rev', run_id: 'run-new', findings: [makeFinding({ id: 'fresh' })] }),
        ],
      },
    });

    const res = await withClock(
      runAgentOnPullRequest.handler({ pull_request: 'acme/payments-api#482' }, deps, extra),
    );
    const out = text(res);
    expect(out).toContain('score 40');
    expect(out).not.toContain('score 99');
    expect(res.structuredContent).toMatchObject({ findings_total: 1 });
  });

  it('times out with the run ids, does not cancel, and stays inside the budget', async () => {
    const { deps, extra } = ctx({
      runTicks: [[makeRun({ run_id: 'run-new', status: 'running' })]],
    });

    const res = await withClock(
      runAgentOnPullRequest.handler(
        { pull_request: 'acme/payments-api#482', max_wait_seconds: 30 },
        deps,
        extra,
      ),
    );

    expect(res.isError).toBe(true);
    expect(text(res)).toContain('run-new');
    expect(text(res)).toContain('get_findings');
    expect(text(res)).toMatch(/NOT cancelled/);
    // The ids are machine-readable here too. The SDK skips output validation
    // when `isError` is set but still forwards the payload, and a timeout is
    // exactly when a caller needs the run ids without parsing prose.
    expect(res.structuredContent).toMatchObject({ status: 'timeout', run_ids: ['run-new'] });
  });

  it('sends a progress notification per tick only when the client asked for one', async () => {
    const withToken = ctx({
      runTicks: [
        [makeRun({ run_id: 'run-new', status: 'running' })],
        [makeRun({ run_id: 'run-new', status: 'done', findings_count: 0 })],
      ],
    });
    withToken.extra._meta = { progressToken: 'tok-1' };
    await withClock(
      runAgentOnPullRequest.handler({ pull_request: 'acme/payments-api#482' }, withToken.deps, withToken.extra),
    );
    expect(withToken.sent).toHaveLength(1);
    expect(withToken.sent[0]).toMatchObject({
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', total: 1 },
    });

    const without = ctx({
      runTicks: [
        [makeRun({ run_id: 'run-new', status: 'running' })],
        [makeRun({ run_id: 'run-new', status: 'done', findings_count: 0 })],
      ],
    });
    await withClock(
      runAgentOnPullRequest.handler({ pull_request: 'acme/payments-api#482' }, without.deps, without.extra),
    );
    expect(without.sent).toHaveLength(0);
  });

  it('stops immediately when the caller aborts, and hands back the run id', async () => {
    const controller = new AbortController();
    const { deps, extra } = ctx(
      { runTicks: [[makeRun({ run_id: 'run-new', status: 'running' })]] },
      controller,
    );

    const work = runAgentOnPullRequest.handler(
      { pull_request: 'acme/payments-api#482' },
      deps,
      extra,
    );
    // Let the POST and the first poll happen, then cancel mid-backoff.
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    const res = await withClock(work);

    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/cancelled this tool call/);
    expect(text(res)).toContain('run-new');
    expect(res.structuredContent).toMatchObject({ status: 'cancelled', run_ids: ['run-new'] });
  });

  /*
   * Found by running the tool against a real PR, not by any test here: the
   * API's executor aborts a run at its own 10-minute deadline and writes
   * `failed`, which is TERMINAL — so the poll settles normally. That used to
   * be reported as `status: 'completed', findings_total: 0`, which reads as a
   * clean pull request. Every fixture in this file scripted `… → done`, so
   * nothing could see it.
   */
  it('does NOT call a run that failed "completed"', async () => {
    const { deps, extra } = ctx({
      runTicks: [
        [makeRun({ run_id: 'run-new', status: 'running' })],
        [
          makeRun({
            run_id: 'run-new',
            status: 'failed',
            error: 'Run exceeded the 10-minute deadline and was aborted',
            duration_ms: 600_015,
          }),
        ],
      ],
    });

    const res = await withClock(
      runAgentOnPullRequest.handler({ pull_request: 'acme/payments-api#482' }, deps, extra),
    );

    expect(res.isError).toBe(true);
    // `failed` is in the output enum, so the tool has to actually emit it —
    // a caller switching on `structuredContent.status` must not fall through
    // to `undefined` on the one outcome most worth branching on.
    expect(res.structuredContent).toMatchObject({ status: 'failed', run_ids: ['run-new'] });
    expect(text(res)).toMatch(/NO agent completed/);
    expect(text(res)).toContain('10-minute deadline');
    expect(text(res)).toContain('run-new');
    // The whole point: a caller must not read "no findings" as "no problems".
    expect(text(res)).toMatch(/has NOT been reviewed/);
    // And it must not have gone looking for findings that cannot exist.
    expect((deps.api as FakeApiClient).calls).not.toContain('listReviews(pr-1)');
  });

  it('reports a mixed all_agents outcome as partial, keeping the findings that exist', async () => {
    const { deps, extra } = ctx({
      reviewRun: {
        pr_id: 'pr-1',
        runs: [
          { run_id: 'run-a', agent_id: 'agent-1', agent_name: 'General Reviewer' },
          { run_id: 'run-b', agent_id: 'agent-2', agent_name: 'Security Reviewer' },
        ],
        reviews: [],
      },
      runTicks: [
        [
          makeRun({ run_id: 'run-a', status: 'done', score: 80 }),
          makeRun({ run_id: 'run-b', status: 'failed', error: 'provider refused the request' }),
        ],
      ],
      reviews: {
        'pr-1': [
          makeReview({ run_id: 'run-a', findings: [makeFinding({ title: 'Unbounded retry loop' })] }),
        ],
      },
    });

    const res = await withClock(
      runAgentOnPullRequest.handler(
        { pull_request: 'acme/payments-api#482', all_agents: true },
        deps,
        extra,
      ),
    );

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toMatchObject({ status: 'partial', findings_total: 1 });
    // The agent that DID finish keeps its findings...
    expect(text(res)).toContain('Unbounded retry loop');
    // ...and the one that did not is on the page, not inferred from a count.
    expect(text(res)).toMatch(/1 of them WITHOUT completing/);
    expect(text(res)).toContain('provider refused the request');
  });

  it('names the enabled agents when the requested one does not exist', async () => {
    const { deps, extra } = ctx({ agents: [makeAgent({ name: 'Security Reviewer' })] });
    const res = await withClock(
      runAgentOnPullRequest.handler(
        { pull_request: 'acme/payments-api#482', agent: 'Nope' },
        deps,
        extra,
      ),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Security Reviewer');
  });

  it('refuses to run a disabled agent instead of failing at the API', async () => {
    const { deps, extra, api } = ctx({ agents: [makeAgent({ enabled: false })] });
    const res = await withClock(
      runAgentOnPullRequest.handler(
        { pull_request: 'acme/payments-api#482', agent: 'General Reviewer' },
        deps,
        extra,
      ),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/disabled/);
    expect(api.calls.some((c) => c.startsWith('startReview'))).toBe(false);
  });

  it('caps max_wait_seconds at 900', async () => {
    const { deps, extra } = ctx({});
    const res = await withClock(
      runAgentOnPullRequest.handler(
        { pull_request: 'acme/payments-api#482', max_wait_seconds: 5_000 },
        deps,
        extra,
      ),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/Invalid arguments/);
  });
});
