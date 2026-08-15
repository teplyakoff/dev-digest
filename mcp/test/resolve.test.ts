import { describe, expect, it } from 'vitest';
import { FakeApiClient } from '../src/api/fake-client.js';
import { Resolver, parsePullRef, parseRepoRef } from '../src/resolve.js';
import { makePr, makeRepo } from './fixtures.js';

describe('parseRepoRef', () => {
  it('reads a UUID, a full name and a URL', () => {
    expect(parseRepoRef('7b1e2f80-1c3d-4a5b-8e9f-0a1b2c3d4e5f')).toEqual({
      kind: 'id',
      id: '7b1e2f80-1c3d-4a5b-8e9f-0a1b2c3d4e5f',
    });
    expect(parseRepoRef('acme/payments-api')).toEqual({
      kind: 'full_name',
      fullName: 'acme/payments-api',
    });
    expect(parseRepoRef('https://github.com/acme/payments-api')).toEqual({
      kind: 'full_name',
      fullName: 'acme/payments-api',
    });
    expect(parseRepoRef('https://github.com/acme/payments-api.git')).toEqual({
      kind: 'full_name',
      fullName: 'acme/payments-api',
    });
  });

  it('refuses what it cannot read, and says what it accepts', () => {
    expect(() => parseRepoRef('payments')).toThrow(/owner\/repo/);
    expect(() => parseRepoRef('  ')).toThrow(/empty/);
  });
});

describe('parsePullRef', () => {
  it('reads every shape a model is likely to produce', () => {
    const expected = { kind: 'number', fullName: 'acme/payments-api', number: 482 };
    for (const ref of [
      'https://github.com/acme/payments-api/pull/482',
      'https://github.com/acme/payments-api/pull/482/files',
      'github.com/acme/payments-api/pull/482#discussion_r1',
      'acme/payments-api#482',
      'acme/payments-api/482',
      'acme/payments-api/pull/482',
      'acme/payments-api 482',
    ]) {
      expect(parsePullRef(ref), ref).toEqual(expected);
    }
    expect(parsePullRef('7b1e2f80-1c3d-4a5b-8e9f-0a1b2c3d4e5f').kind).toBe('id');
  });

  it('refuses a bare number — it names no repository', () => {
    expect(() => parsePullRef('482')).toThrow(/Cannot read/);
  });
});

describe('Resolver', () => {
  it('memoises the repo list across calls but never the pull list', async () => {
    const api = new FakeApiClient({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr()] },
    });
    const resolver = new Resolver(api);
    await resolver.pull('acme/payments-api#482');
    await resolver.pull('acme/payments-api#482');
    expect(api.calls.filter((c) => c === 'listRepos()')).toHaveLength(1);
    expect(api.calls.filter((c) => c === 'listPulls(repo-1)')).toHaveLength(2);
  });

  it('resolves a full name to the pull id', async () => {
    const api = new FakeApiClient({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr({ id: 'pull-uuid' })] },
    });
    const got = await new Resolver(api).pull('https://github.com/acme/payments-api/pull/482');
    expect(got.pullId).toBe('pull-uuid');
    expect(got.repo?.full_name).toBe('acme/payments-api');
  });

  it('passes a UUID straight through without a lookup', async () => {
    const api = new FakeApiClient({});
    const got = await new Resolver(api).pull('7b1e2f80-1c3d-4a5b-8e9f-0a1b2c3d4e5f');
    expect(got.pullId).toBe('7b1e2f80-1c3d-4a5b-8e9f-0a1b2c3d4e5f');
    expect(api.calls).toEqual([]);
  });

  // The self-correction property: an error a model can act on names what it saw.
  it('lists the repositories it saw when the name misses', async () => {
    const api = new FakeApiClient({
      repos: [makeRepo(), makeRepo({ id: 'repo-2', full_name: 'teplyakoff/dev-digest' })],
    });
    await expect(new Resolver(api).repo('acme/other')).rejects.toThrow(
      /acme\/payments-api, teplyakoff\/dev-digest/,
    );
  });

  it('lists the PR numbers it saw when the number misses', async () => {
    const api = new FakeApiClient({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr({ number: 482 }), makePr({ id: 'pr-2', number: 501 })] },
    });
    await expect(new Resolver(api).pull('acme/payments-api#999')).rejects.toThrow(
      /#482, #501/,
    );
  });

  it('says the workspace is empty rather than "not found"', async () => {
    await expect(new Resolver(new FakeApiClient({})).repo('acme/payments-api')).rejects.toThrow(
      /No repositories have been imported/,
    );
  });

  // Silently picking one of two identically named repos would review a
  // DIFFERENT repository than the caller asked about, and look like success.
  it('refuses to guess between two repos with the same full_name', async () => {
    const api = new FakeApiClient({
      repos: [makeRepo({ id: 'repo-a' }), makeRepo({ id: 'repo-b', workspace_id: 'ws-2' })],
    });
    await expect(new Resolver(api).repo('acme/payments-api')).rejects.toThrow(
      /ambiguous.*repo-a, repo-b/s,
    );
  });

  // PrMeta.id is z.string().nullish() — a null is a real state, not a crash.
  it('turns a null PrMeta.id into an actionable message', async () => {
    const api = new FakeApiClient({
      repos: [makeRepo()],
      pulls: { 'repo-1': [makePr({ id: null })] },
    });
    await expect(new Resolver(api).pull('acme/payments-api#482')).rejects.toThrow(
      /returned no id/,
    );
  });
});
