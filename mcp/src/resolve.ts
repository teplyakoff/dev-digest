import type { PrMeta, Repo } from '@devdigest/shared';
import type { ApiClient } from './api/types.js';

/**
 * Flexible identifier resolution: a model should be able to say
 * `teplyakoff/dev-digest#5` or paste a GitHub URL, not hunt for a UUID.
 *
 * The rule that makes this useful rather than merely tolerant: **a miss lists
 * the candidates it actually saw.** An error that says "not found" ends the
 * conversation; one that says "not found — I can see acme/payments-api and
 * teplyakoff/dev-digest" lets the caller correct itself in one turn.
 */

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_REPO = '[A-Za-z0-9._-]+/[A-Za-z0-9._-]+';

/** How many candidates an error message is allowed to enumerate. */
const MAX_CANDIDATES = 25;

export type RepoRef =
  | { kind: 'id'; id: string }
  | { kind: 'full_name'; fullName: string };

export type PullRef =
  | { kind: 'id'; id: string }
  | { kind: 'number'; fullName: string; number: number };

export function parseRepoRef(raw: string): RepoRef {
  const ref = raw.trim();
  if (ref.length === 0) throw new ResolveError('An empty repository reference cannot be resolved.');
  if (UUID.test(ref)) return { kind: 'id', id: ref };

  const url = ref.match(new RegExp(`github\\.com/(${OWNER_REPO})(?:[/#?].*)?$`, 'i'));
  if (url?.[1]) return { kind: 'full_name', fullName: stripGit(url[1]) };

  if (new RegExp(`^${OWNER_REPO}$`).test(ref)) return { kind: 'full_name', fullName: stripGit(ref) };

  throw new ResolveError(
    `Cannot read "${raw}" as a repository. Use a GitHub URL (https://github.com/owner/repo), ` +
      '`owner/repo`, or the repo UUID.',
  );
}

export function parsePullRef(raw: string): PullRef {
  const ref = raw.trim();
  if (ref.length === 0)
    throw new ResolveError('An empty pull-request reference cannot be resolved.');
  if (UUID.test(ref)) return { kind: 'id', id: ref };

  // https://github.com/owner/repo/pull/123 (with or without scheme, trailing
  // /files, #discussion_r… and query strings)
  const url = ref.match(
    new RegExp(`github\\.com/(${OWNER_REPO})/pulls?/(\\d+)`, 'i'),
  );
  if (url?.[1] && url[2]) {
    return { kind: 'number', fullName: stripGit(url[1]), number: Number(url[2]) };
  }

  // owner/repo#123 · owner/repo 123 · owner/repo/123 · owner/repo/pull/123
  const short = ref.match(new RegExp(`^(${OWNER_REPO})(?:#|\\s+|/pull/|/)(\\d+)$`));
  if (short?.[1] && short[2]) {
    return { kind: 'number', fullName: stripGit(short[1]), number: Number(short[2]) };
  }

  throw new ResolveError(
    `Cannot read "${raw}" as a pull request. Use a GitHub URL ` +
      '(https://github.com/owner/repo/pull/123), `owner/repo#123`, or the pull-request UUID.',
  );
}

function stripGit(fullName: string): string {
  return fullName.replace(/\.git$/i, '');
}

/**
 * Holds the per-process repo-list cache. A class rather than a module-level
 * `let`, because a module singleton is invisible at the call site (onion §6) and
 * because tests then need no reset hook. Constructed once in the composition
 * root, so "memoised per process" falls out of the object graph.
 *
 * The PULL list is deliberately NOT cached: PRs open, close and move between
 * two calls of a session, and a stale hit here resolves to the wrong review.
 */
export class Resolver {
  private repos: Repo[] | null = null;

  constructor(private readonly api: ApiClient) {}

  async repoList(signal?: AbortSignal): Promise<Repo[]> {
    if (!this.repos) this.repos = await this.api.listRepos(signal);
    return this.repos;
  }

  /** @returns the repo row, so callers get `full_name` for their messages too. */
  async repo(raw: string, signal?: AbortSignal): Promise<Repo> {
    const ref = parseRepoRef(raw);
    const repos = await this.repoList(signal);

    if (ref.kind === 'id') {
      const byId = repos.find((r) => r.id === ref.id);
      if (byId) return byId;
      throw new ResolveError(
        `No repository with id ${ref.id}. ${candidates(repos)}`,
      );
    }

    const matches = repos.filter(
      (r) => r.full_name.toLowerCase() === ref.fullName.toLowerCase(),
    );
    // Two rows with one `full_name` is possible across workspaces. Picking the
    // first would silently review a DIFFERENT repository than the caller named,
    // which is the one failure here nobody would notice.
    if (matches.length > 1) {
      throw new ResolveError(
        `"${ref.fullName}" is ambiguous — ${matches.length} repositories share that name. ` +
          `Pass one of these ids instead: ${matches.map((r) => r.id).join(', ')}.`,
      );
    }
    if (matches[0]) return matches[0];
    throw new ResolveError(`No repository "${ref.fullName}". ${candidates(repos)}`);
  }

  /** @returns the pull id plus the repo it belongs to. */
  async pull(
    raw: string,
    signal?: AbortSignal,
  ): Promise<{ pullId: string; repo: Repo | null; pull: PrMeta | null }> {
    const ref = parsePullRef(raw);
    if (ref.kind === 'id') return { pullId: ref.id, repo: null, pull: null };

    const repo = await this.repo(ref.fullName, signal);
    const pulls = await this.api.listPulls(repo.id, signal);
    const match = pulls.find((p) => p.number === ref.number);

    if (!match) {
      const seen = pulls
        .slice(0, MAX_CANDIDATES)
        .map((p) => `#${p.number}`)
        .join(', ');
      throw new ResolveError(
        `${repo.full_name} has no pull request #${ref.number}. ` +
          (seen.length > 0
            ? `Pull requests currently imported: ${seen}${pulls.length > MAX_CANDIDATES ? ', …' : ''}.`
            : 'No pull requests have been imported for it yet — import them from the DevDigest UI first.'),
      );
    }

    // `PrMeta.id` is `z.string().nullish()` (platform.ts:189). A null here is a
    // real state of the list endpoint, not a contract violation, so it has to
    // produce an answer rather than `Cannot read properties of null`.
    if (!match.id) {
      throw new ResolveError(
        `${repo.full_name}#${ref.number} exists but the API returned no id for it, so nothing can be ` +
          'run or read against it. Re-import or refresh the repository, then try again.',
      );
    }

    return { pullId: match.id, repo, pull: match };
  }
}

function candidates(repos: Repo[]): string {
  if (repos.length === 0) {
    return 'No repositories have been imported into this workspace yet — add one in the DevDigest UI first.';
  }
  const names = repos.slice(0, MAX_CANDIDATES).map((r) => r.full_name);
  return `Repositories in this workspace: ${names.join(', ')}${
    repos.length > MAX_CANDIDATES ? ', …' : ''
  }.`;
}
