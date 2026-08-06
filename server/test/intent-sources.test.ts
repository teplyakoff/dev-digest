import { describe, it, expect, vi } from 'vitest';
import type { GitHubClient, UnifiedDiff } from '@devdigest/shared';
import { MockGitHubClient, MockSourceReader } from '../src/adapters/mocks.js';
import {
  candidateRepoPaths,
  classifyCandidatePath,
  collectSources,
  externalUrls,
  linkedIssueNumber,
  selfRepoPathFromUrl,
} from '../src/modules/intent/pipeline/sources.js';
import {
  applyConfidenceFloor,
  capScopeItems,
  hasMaterialGap,
  hasSubstantiveSource,
  scopeFilterArmed,
} from '../src/modules/intent/helpers.js';

/**
 * The collector's safety layers and the server-computed provenance, without
 * Docker: ring-2 logic over injected ports (onion §12).
 *
 * The one that matters most is the denylist. Without it a PR body reading
 * "see .env for context" puts the TARGET repo's secrets into a model request and
 * into the persisted run trace, which is the repo-wide invariant that secrets
 * never touch the DB or git.
 */

const EMPTY_DIFF: UnifiedDiff = { raw: '', files: [] };

const DIFF: UnifiedDiff = {
  raw: '',
  files: [
    {
      path: 'src/limiter.ts',
      additions: 12,
      deletions: 0,
      hunks: [{ file: 'src/limiter.ts', oldStart: 1, oldLines: 0, newStart: 1, newLines: 12, newLineNumbers: [1] }],
    },
  ],
};

const CLONE = {
  'docs/plans/rate-limits.md': '# Rate limits\n\nCap public endpoints at 100 req/min.\n',
  '.env': 'STRIPE_KEY=sk_live_do_not_read_me\n',
  'src/limiter.ts': 'export const limit = 100;\n',
};

function collect(over: Partial<Parameters<typeof collectSources>[0]> = {}) {
  return collectSources({
    title: 'Add rate limiting',
    body: null,
    clonePath: '/clone',
    repo: { owner: 'acme', name: 'payments-api' },
    diff: DIFF,
    github: async () => new MockGitHubClient() as unknown as GitHubClient,
    sourceReader: new MockSourceReader(CLONE),
    ...over,
  });
}

describe('candidate path safety', () => {
  it('rejects .env and every secret-shaped name, and never attempts the read', async () => {
    expect(classifyCandidatePath('.env')).toBe('denied');
    expect(classifyCandidatePath('config/.env.production')).toBe('denied');
    expect(classifyCandidatePath('deploy/secrets.md')).toBe('denied');
    expect(classifyCandidatePath('ops/aws-credentials.txt')).toBe('denied');
    expect(classifyCandidatePath('certs/server.pem')).toBe('denied');
    expect(classifyCandidatePath('.github/workflows/ci.yml')).toBe('denied');

    // And end to end: the reader is never even called for a denied path.
    const read = vi.fn(async () => 'STRIPE_KEY=sk_live_x');
    const res = await collect({
      body: 'Context is in .env, see it for the keys.',
      sourceReader: { read },
    });
    expect(read).not.toHaveBeenCalled();
    const denied = res.sources.find((s) => s.kind === 'repo_file');
    expect(denied).toMatchObject({ ref: '.env', status: 'unavailable' });
    expect(res.missingContext.join(' ')).toContain('.env');
    expect(JSON.stringify(res.blocks)).not.toContain('sk_live');
  });

  it('allows only document extensions', () => {
    expect(classifyCandidatePath('docs/plans/x.md')).toBe('ok');
    expect(classifyCandidatePath('docs/spec.mdx')).toBe('ok');
    expect(classifyCandidatePath('notes/a.txt')).toBe('ok');
    // Not a document — skipped silently; it is almost always just a code path
    // the author mentioned in prose.
    expect(classifyCandidatePath('src/limiter.ts')).toBe('ext');
    expect(classifyCandidatePath('deploy/values.yaml')).toBe('ext');
  });

  it('reads an allowed plan file and records it as used', async () => {
    const res = await collect({ body: 'Implements docs/plans/rate-limits.md in full.' });
    expect(res.sources).toContainEqual({
      kind: 'repo_file',
      ref: 'docs/plans/rate-limits.md',
      status: 'used',
    });
    expect(res.blocks.find((b) => b.label.startsWith('repo-file:'))?.text).toContain('100 req/min');
    expect(res.missingContext).not.toContain(expect.stringContaining('rate-limits'));
  });

  it('records an unreadable path as unavailable instead of inventing it', async () => {
    const res = await collect({ body: 'See docs/plans/never-written.md for the design.' });
    expect(res.sources).toContainEqual({
      kind: 'repo_file',
      ref: 'docs/plans/never-written.md',
      status: 'unavailable',
      note: 'not found in the repository',
    });
    expect(res.missingContext.some((m) => m.includes('never-written.md'))).toBe(true);
    expect(res.blocks.some((b) => b.label.startsWith('repo-file:'))).toBe(false);
  });

  it('caps read attempts, so a body listing many paths costs a bounded number', async () => {
    const read = vi.fn(async () => null);
    const body = Array.from({ length: 40 }, (_, i) => `docs/p${i}.md`).join(' ');
    await collect({ body, sourceReader: { read } });
    expect(read.mock.calls.length).toBeLessThanOrEqual(8);
  });
});

describe('external links and linked issues', () => {
  it('records an external URL without fetching it', async () => {
    const res = await collect({ body: 'Background: https://wiki.internal/rate-limits' });
    expect(res.sources).toContainEqual({
      kind: 'link',
      ref: 'https://wiki.internal/rate-limits',
      status: 'unavailable',
      note: 'external links are not fetched',
    });
    expect(res.missingContext.some((m) => m.includes('wiki.internal'))).toBe(true);
    expect(externalUrls('a https://x.test/y b')).toEqual(['https://x.test/y']);
  });

  it('matches only the strict keyword form of a linked issue', () => {
    expect(linkedIssueNumber('Closes #301')).toBe(301);
    expect(linkedIssueNumber('fixes #7 and more')).toBe(7);
    // The GitHub adapter's own regex makes the keyword optional and would match
    // this as issue 482. Two regexes now exist, deliberately.
    expect(linkedIssueNumber('supersedes PR #482')).toBeNull();
  });

  it('records an unfetchable issue as unavailable', async () => {
    const res = await collect({
      body: 'Closes #301',
      github: async () =>
        ({ getIssue: async () => { throw new Error('Not Found'); } }) as unknown as GitHubClient,
    });
    expect(res.sources.find((s) => s.kind === 'linked_issue')).toMatchObject({
      ref: '#301',
      status: 'unavailable',
    });
    expect(res.missingContext.some((m) => m.includes('#301'))).toBe(true);
  });

  it('finds candidate paths in prose, backticks and markdown links', () => {
    const paths = candidateRepoPaths('see `docs/a.md` and [plan](docs/b.md) plus docs/a.md again');
    expect(paths).toEqual(['docs/a.md', 'docs/b.md']);
  });
});

/**
 * A GitHub link to a file in THIS repo is a link to a plan, and the file is in
 * the clone. Found on a real PR: twelve links, four of them this repo's own
 * `docs/plans/*.md`, none read — `REPO_PATH_PATTERN` will not match a path
 * preceded by `/`, so a linked plan was invisible while a typed one was not.
 *
 * The resolution reads the LOCAL clone. It must never become a fetch, and it
 * must never resolve a URL belonging to someone else — hence the negative cases.
 */
describe('self-referential GitHub links resolve to the clone', () => {
  const repo = { owner: 'acme', name: 'payments-api' };

  it('reads a blob URL for this repo instead of recording it as unfetchable', async () => {
    const res = await collect({
      body: 'Plan: https://github.com/acme/payments-api/blob/main/docs/plans/rate-limits.md',
    });
    expect(res.sources).toContainEqual({
      kind: 'repo_file',
      ref: 'docs/plans/rate-limits.md',
      status: 'used',
    });
    // and it is NOT also reported as an unfetched link
    expect(res.sources.some((s) => s.kind === 'link')).toBe(false);
    expect(res.missingContext).toEqual([]);
    expect(res.blocks.some((b) => b.text.includes('100 req/min'))).toBe(true);
  });

  it('handles the raw.githubusercontent host too', () => {
    expect(
      selfRepoPathFromUrl(
        'https://raw.githubusercontent.com/acme/payments-api/main/docs/plans/rate-limits.md',
        repo,
      ),
    ).toBe('docs/plans/rate-limits.md');
  });

  it('refuses another repo, another host, and a lookalike domain', () => {
    const cases = [
      'https://github.com/someone-else/other/blob/main/docs/a.md', // different repo
      'https://gitlab.com/acme/payments-api/blob/main/docs/a.md', // different host
      'https://github.com.evil.test/acme/payments-api/blob/main/docs/a.md', // lookalike
      'https://github.com/acme/payments-api/issues/12', // not a blob
      'https://github.com/acme/payments-api/blob/main', // no path
      'not a url at all',
    ];
    for (const url of cases) expect(selfRepoPathFromUrl(url, repo)).toBeNull();
  });

  it('still applies the denylist to a path recovered from a link', async () => {
    const res = await collect({
      body: 'context: https://github.com/acme/payments-api/blob/main/.env',
    });
    // Resolved, then REFUSED — and visibly so. Never read.
    expect(res.sources).toContainEqual({
      kind: 'repo_file',
      ref: '.env',
      status: 'unavailable',
      note: 'not an allowed document path',
    });
    expect(JSON.stringify(res.blocks)).not.toContain('sk_live');
  });
});

describe('server-computed provenance', () => {
  it('an empty body still yields title + files, and reports the gap', async () => {
    const res = await collect({ body: null });
    expect(res.sources.find((s) => s.kind === 'pr_title')?.status).toBe('used');
    expect(res.sources.find((s) => s.kind === 'changed_files')?.status).toBe('used');
    expect(res.sources.find((s) => s.kind === 'pr_body')?.status).toBe('unavailable');
    expect(res.missingContext).toContain('the PR has no description');
  });

  it('an empty diff is reported, not hidden', async () => {
    // This is the state seeded data produces: `pr_files.patch` is null, so the
    // reconstructed diff has no files. The card must say so.
    const res = await collect({ diff: EMPTY_DIFF });
    expect(res.missingContext).toContain('no diff available');
  });

  it('floors confidence to low when nothing beyond the title was read', async () => {
    const res = await collect({ body: null });
    expect(hasSubstantiveSource(res.sources)).toBe(false);
    expect(applyConfidenceFloor('high', res.sources)).toBe('low');
  });

  it('caps a confident claim to medium when a NAMED document could not be read', async () => {
    const res = await collect({ body: 'Adds limits. Plan: docs/plans/does-not-exist.md' });
    expect(hasSubstantiveSource(res.sources)).toBe(true);
    expect(hasMaterialGap(res.sources)).toBe(true);
    expect(applyConfidenceFloor('high', res.sources)).toBe('medium');
    // The floor never RAISES: a model hedging on rich inputs stays hedged.
    expect(applyConfidenceFloor('low', res.sources)).toBe('low');
  });

  it('does NOT cap confidence merely because the body contains a URL', async () => {
    const res = await collect({ body: 'Adds limits. See https://wiki.internal/x' });
    // Still recorded for the card — transparency is unchanged…
    expect(res.missingContext.some((m) => m.includes('wiki.internal'))).toBe(true);
    // …but a URL in prose is not a gap in the derivation.
    expect(hasMaterialGap(res.sources)).toBe(false);
    expect(applyConfidenceFloor('high', res.sources)).toBe('high');
  });
});

describe('caps and the scope-filter arming rule', () => {
  it('slices to 6 items and truncates each to 80 chars', () => {
    const capped = capScopeItems([...Array.from({ length: 9 }, (_, i) => `item ${i}`), 'x'.repeat(200)]);
    expect(capped).toHaveLength(6);
    expect(capped.every((i) => i.length <= 80)).toBe(true);
  });

  it('arms only on substantive sources, no gaps, and not-low confidence', () => {
    const base = {
      pr_id: 'p',
      summary: 's',
      in_scope: [],
      out_of_scope: [],
      sources: [
        { kind: 'pr_title' as const, ref: 't', status: 'used' as const },
        { kind: 'pr_body' as const, ref: 'b', status: 'used' as const },
      ],
      missing_context: [],
      confidence: 'high' as const,
      head_sha: 'abc',
      provider: 'openrouter',
      model: 'm',
      derived_at: '2026-08-06T00:00:00Z',
      tokens_in: 1,
      tokens_out: 1,
      cost_usd: 0,
    };
    expect(scopeFilterArmed(base)).toBe(true);
    // Any one condition failing disarms it. Never the other way round.
    expect(scopeFilterArmed({ ...base, confidence: 'low' })).toBe(false);
    expect(
      scopeFilterArmed({
        ...base,
        sources: [{ kind: 'pr_title', ref: 't', status: 'used' }],
      }),
    ).toBe(false);

    // A MATERIAL gap disarms: a named plan we could not read, or a ticket that
    // would not fetch, is the classifier working blind.
    for (const kind of ['repo_file', 'linked_issue'] as const) {
      expect(
        scopeFilterArmed({
          ...base,
          sources: [...base.sources, { kind, ref: 'x', status: 'unavailable' as const }],
          missing_context: ['x could not be read'],
        }),
      ).toBe(false);
    }
  });

  /**
   * The rule used to be `missing_context.length === 0`, which made the filter
   * DEAD CODE: measured on three real PRs of this repo, every one disarmed, and
   * on two of them the only gap was an unfetched link — one of them
   * `https://claude.com/claude-code`, the footer every Claude Code-authored PR
   * carries. This is the regression test for that, written from the real body.
   */
  it('stays armed when the only gap is an unfetched external link', async () => {
    const res = await collect({
      body: 'Renames the sync endpoint.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    });
    expect(res.missingContext).toHaveLength(1);
    expect(res.missingContext[0]).toContain('claude.com/claude-code');
    expect(hasMaterialGap(res.sources)).toBe(false);

    const record = {
      pr_id: 'p',
      summary: 's',
      in_scope: [],
      out_of_scope: [],
      sources: res.sources,
      missing_context: res.missingContext,
      confidence: 'medium' as const,
      head_sha: 'abc',
      provider: 'openrouter',
      model: 'm',
      derived_at: '2026-08-06T00:00:00Z',
      tokens_in: 1,
      tokens_out: 1,
      cost_usd: 0,
    };
    expect(scopeFilterArmed(record)).toBe(true);
  });
});
