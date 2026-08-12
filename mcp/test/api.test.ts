import { describe, expect, it } from 'vitest';
import { DEFAULT_API_URL, loadConfig } from '../src/config.js';
import {
  ApiError,
  describeApiError,
  isConnectionRefused,
  kindForStatus,
} from '../src/api/errors.js';
import { FakeApiClient } from '../src/api/fake-client.js';

describe('config', () => {
  it('defaults to the local API', () => {
    expect(loadConfig({}).apiUrl).toBe(DEFAULT_API_URL);
  });

  it('accepts each loopback spelling', () => {
    for (const host of ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001']) {
      expect(loadConfig({ DEVDIGEST_API_URL: host }).apiUrl).toContain('300');
    }
  });

  it('strips a trailing slash so call sites can concatenate', () => {
    expect(loadConfig({ DEVDIGEST_API_URL: 'http://localhost:3001/' }).apiUrl).toBe(
      'http://localhost:3001',
    );
  });

  // The API has no authentication at all, so a non-loopback base URL is a
  // silent exfiltration path — this is the only thing standing in front of it.
  it('REFUSES a non-loopback host', () => {
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'https://evil.example.com' })).toThrow(
      /loopback/i,
    );
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'http://10.0.0.5:3001' })).toThrow(/loopback/i);
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'http://localhost.evil.com' })).toThrow(
      /loopback/i,
    );
  });

  it('rejects a non-http scheme and unparseable input', () => {
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'file:///etc/passwd' })).toThrow();
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'not a url' })).toThrow(/not a valid URL/);
  });
});

describe('error taxonomy', () => {
  it('maps the statuses the API actually produces', () => {
    expect(kindForStatus(404, null)).toBe('not_found');
    expect(kindForStatus(422, 'validation_error')).toBe('validation');
    expect(kindForStatus(429, null)).toBe('rate_limited');
    expect(kindForStatus(500, 'internal_error')).toBe('server_error');
    expect(kindForStatus(418, null)).toBe('request_failed');
  });

  it('finds ECONNREFUSED through a wrapped fetch TypeError', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    expect(isConnectionRefused(err)).toBe(true);
    expect(isConnectionRefused(new Error('nope'))).toBe(false);
  });

  it('survives a self-referencing cause chain', () => {
    const err: { cause?: unknown } = {};
    err.cause = err;
    expect(isConnectionRefused(err)).toBe(false);
  });

  it('tells the caller how to start the API rather than printing a socket error', () => {
    const text = describeApiError(new ApiError('unreachable', 'GET /repos: fetch failed'));
    expect(text).toContain('./scripts/dev.sh');
  });

  it('explains the review route rate limit in terms of what it protects', () => {
    const text = describeApiError(new ApiError('rate_limited', 'boom', { status: 429 }));
    expect(text).toMatch(/10 calls per minute/);
  });
});

describe('FakeApiClient', () => {
  it('records calls in domain terms', async () => {
    const api = new FakeApiClient({ repos: [] });
    await api.listRepos();
    await api.listPulls('repo-1');
    expect(api.calls).toEqual(['listRepos()', 'listPulls(repo-1)']);
  });

  it('walks runTicks once per poll and then holds the last entry', async () => {
    const api = new FakeApiClient({
      runTicks: [[], [{ run_id: 'r1' } as never], [{ run_id: 'r2' } as never]],
    });
    expect(await api.listRuns('p')).toHaveLength(0);
    expect(await api.listRuns('p')).toHaveLength(1);
    expect(await api.listRuns('p')).toHaveLength(1);
    expect((await api.listRuns('p'))[0]).toEqual({ run_id: 'r2' });
  });

  it('can be told to fail one method', async () => {
    const api = new FakeApiClient({
      failures: { listAgents: new ApiError('unreachable', 'down') },
    });
    await expect(api.listAgents()).rejects.toThrow('down');
  });
});
