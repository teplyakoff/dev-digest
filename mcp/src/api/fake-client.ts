import type {
  Agent,
  BlastResponse,
  ConventionSkillDraft,
  ConventionsView,
  PrDetail,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunRequest,
  RunSummary,
} from '@devdigest/shared';
import { ApiError } from './errors.js';
import type { ApiClient } from './types.js';

/**
 * Ring 3 — the test double, and it lives in `src/` deliberately.
 *
 * onion §12 / James Shore's nullable infrastructure: *"Nullables look like test
 * doubles, but they're actually production code."* Shipping it here means it is
 * type-checked with everything else, so widening `ApiClient` breaks this file at
 * compile time instead of letting canned fixtures drift away from the port.
 *
 * It records what it was ASKED to do in domain terms (`calls`) rather than
 * counting mock invocations, which is §12's other rule.
 */

type MethodName = keyof ApiClient;

export interface FakeApiData {
  repos: Repo[];
  /** repo id → its pull requests. */
  pulls: Record<string, PrMeta[]>;
  /** pull id → the detail read. */
  pullDetails: Record<string, PrDetail>;
  agents: Agent[];
  /** pull id → the persisted reviews (one row per AGENT). */
  reviews: Record<string, ReviewRecord[]>;
  /** repo id → conventions view. */
  conventions: Record<string, ConventionsView>;
  /**
   * pull id → its impact map. Absent means the DEGRADED map below, not a
   * throw: the real route answers 200 for an unindexed repository, and a
   * double that threw instead would let a handler ship without ever having
   * been exercised on the state most repositories are actually in.
   */
  blast: Record<string, BlastResponse>;
  /** repo id → the merged skill draft. */
  skillDrafts: Record<string, ConventionSkillDraft>;
  /**
   * One entry per `listRuns` call, in order; the LAST entry repeats forever.
   * That is what lets a test script `running → running → done` — or a run that
   * never settles — with no timers of its own.
   */
  runTicks: RunSummary[][];
  /** What `startReview` answers. `reviews` is `[]` here for the same reason it is on the server. */
  reviewRun: ReviewRunResponse | null;
  /** Force a method to fail, for the error-path tests. */
  failures: Partial<Record<MethodName, ApiError>>;
}

/**
 * What the server answers for a repository it has never indexed: a well-formed
 * map that computed nothing, with the reason spelled out.
 */
const DEGRADED_BLAST: BlastResponse = {
  status: 'degraded',
  reason:
    'This repository has not been indexed yet, so nothing is known about who calls this code.',
  changed_files: [],
  symbols: [],
  endpoints: [],
  crons: [],
  indexed_sha: null,
  counts: { symbols: 0, callers: 0, endpoints: 0 },
};

const EMPTY: FakeApiData = {
  repos: [],
  pulls: {},
  pullDetails: {},
  agents: [],
  reviews: {},
  conventions: {},
  blast: {},
  skillDrafts: {},
  runTicks: [],
  reviewRun: null,
  failures: {},
};

export class FakeApiClient implements ApiClient {
  readonly data: FakeApiData;
  /** Every call in order, e.g. `listRuns(pr-1)`. Assert on this, not on spies. */
  readonly calls: string[] = [];
  private runTick = 0;

  constructor(data: Partial<FakeApiData> = {}) {
    this.data = { ...EMPTY, ...data };
  }

  async listRepos(): Promise<Repo[]> {
    this.record('listRepos');
    return this.data.repos;
  }

  async listPulls(repoId: string): Promise<PrMeta[]> {
    this.record('listPulls', repoId);
    return this.data.pulls[repoId] ?? [];
  }

  async getPull(pullId: string): Promise<PrDetail> {
    this.record('getPull', pullId);
    const found = this.data.pullDetails[pullId];
    if (!found) throw new ApiError('not_found', `pull ${pullId}`, { status: 404 });
    return found;
  }

  async listAgents(): Promise<Agent[]> {
    this.record('listAgents');
    return this.data.agents;
  }

  async startReview(pullId: string, body: RunRequest): Promise<ReviewRunResponse> {
    this.record('startReview', `${pullId} ${JSON.stringify(body)}`);
    if (!this.data.reviewRun) {
      throw new ApiError('server_error', 'FakeApiClient has no reviewRun configured', { status: 500 });
    }
    return this.data.reviewRun;
  }

  async listRuns(pullId: string): Promise<RunSummary[]> {
    this.record('listRuns', pullId);
    const ticks = this.data.runTicks;
    if (ticks.length === 0) return [];
    const idx = Math.min(this.runTick, ticks.length - 1);
    this.runTick += 1;
    return ticks[idx] ?? [];
  }

  async listReviews(pullId: string): Promise<ReviewRecord[]> {
    this.record('listReviews', pullId);
    return this.data.reviews[pullId] ?? [];
  }

  async getBlast(pullId: string): Promise<BlastResponse> {
    this.record('getBlast', pullId);
    return this.data.blast[pullId] ?? DEGRADED_BLAST;
  }

  async getConventions(repoId: string): Promise<ConventionsView> {
    this.record('getConventions', repoId);
    return this.data.conventions[repoId] ?? { scan: null, candidates: [] };
  }

  async getConventionSkillDraft(repoId: string): Promise<ConventionSkillDraft> {
    this.record('getConventionSkillDraft', repoId);
    const draft = this.data.skillDrafts[repoId];
    if (!draft) throw new ApiError('not_found', `skill draft for repo ${repoId}`, { status: 404 });
    return draft;
  }

  private record(method: MethodName, arg = ''): void {
    this.calls.push(arg ? `${method}(${arg})` : `${method}()`);
    const failure = this.data.failures[method];
    if (failure) throw failure;
  }
}
