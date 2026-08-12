import { z } from 'zod';
import {
  Agent,
  ApiErrorBody,
  ConventionSkillDraft,
  ConventionsView,
  PrDetail,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
  type RunRequest,
} from '@devdigest/shared';
import { ApiError, isConnectionRefused, kindForStatus } from './errors.js';
import type { ApiClient } from './types.js';

/**
 * Ring 3 — the real adapter. The only file in this package that performs I/O.
 *
 * Two jobs, both from onion §10: speak the shared contracts on the way in and
 * out (never a `Response`, never a raw JSON blob), and translate every failure
 * — socket, status, envelope, contract drift — into an `ApiError` before it
 * travels inward.
 */

/** Per-request ceiling. A single REST call here is a local read; 30 s is generous. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Contract schemas carry `.default()` fields, so their INPUT type differs from
 * their output (zod skill, `type-input-vs-output`). The transport only ever
 * feeds them parsed JSON, so the input side is `unknown` here — pinning it to
 * `T` would reject every schema that has a default.
 */
type ApiSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

export class HttpApiClient implements ApiClient {
  constructor(private readonly baseUrl: string) {}

  // ---- the port ----------------------------------------------------------

  listRepos(signal?: AbortSignal): Promise<Repo[]> {
    return this.get('/repos', z.array(Repo), 'the repo list', signal);
  }

  listPulls(repoId: string, signal?: AbortSignal): Promise<PrMeta[]> {
    return this.get(`/repos/${enc(repoId)}/pulls`, z.array(PrMeta), 'the pull-request list', signal);
  }

  getPull(pullId: string, signal?: AbortSignal): Promise<PrDetail> {
    return this.get(`/pulls/${enc(pullId)}`, PrDetail, 'the pull request', signal);
  }

  listAgents(signal?: AbortSignal): Promise<Agent[]> {
    return this.get('/agents', z.array(Agent), 'the agent list', signal);
  }

  startReview(pullId: string, body: RunRequest, signal?: AbortSignal): Promise<ReviewRunResponse> {
    return this.request(
      'POST',
      `/pulls/${enc(pullId)}/review`,
      ReviewRunResponse,
      'the review-run response',
      { body, signal },
    );
  }

  listRuns(pullId: string, signal?: AbortSignal): Promise<RunSummary[]> {
    return this.get(`/pulls/${enc(pullId)}/runs`, z.array(RunSummary), 'the run list', signal);
  }

  listReviews(pullId: string, signal?: AbortSignal): Promise<ReviewRecord[]> {
    return this.get(`/pulls/${enc(pullId)}/reviews`, z.array(ReviewRecord), 'the reviews', signal);
  }

  getConventions(repoId: string, signal?: AbortSignal): Promise<ConventionsView> {
    return this.get(`/repos/${enc(repoId)}/conventions`, ConventionsView, 'the conventions', signal);
  }

  getConventionSkillDraft(repoId: string, signal?: AbortSignal): Promise<ConventionSkillDraft> {
    return this.get(
      `/repos/${enc(repoId)}/conventions/skill-draft`,
      ConventionSkillDraft,
      'the convention skill draft',
      signal,
    );
  }

  // ---- transport ---------------------------------------------------------

  private get<T>(
    path: string,
    schema: ApiSchema<T>,
    what: string,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.request('GET', path, schema, what, { signal });
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: ApiSchema<T>,
    what: string,
    opts: { body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal,
        headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      });
    } catch (err) {
      // A caller-driven abort is not an API failure — let it propagate as-is so
      // the poller can tell "the client cancelled" from "the server is down".
      if (opts.signal?.aborted) throw err;
      if (isConnectionRefused(err) || timeout.aborted) {
        throw new ApiError('unreachable', `${method} ${path}: ${(err as Error).message}`);
      }
      throw new ApiError('request_failed', `${method} ${path}: ${(err as Error).message}`);
    }

    const text = await res.text();
    if (!res.ok) throw toApiError(res.status, text, `${method} ${path}`);

    let json: unknown;
    try {
      json = text.length === 0 ? null : JSON.parse(text);
    } catch {
      throw new ApiError('contract_mismatch', `${what} was not valid JSON`, { status: res.status });
    }

    // safeParse, never parse: a contract drift must surface as a named,
    // actionable failure rather than a ZodError escaping through the tool layer
    // (zod skill, `parse-use-safeparse` / `parse-validate-early`).
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first && first.path.length > 0 ? ` at \`${first.path.join('.')}\`` : '';
      throw new ApiError(
        'contract_mismatch',
        `${what}${where}: ${first?.message ?? 'unexpected shape'}`,
        { status: res.status, details: parsed.error.issues.slice(0, 5) },
      );
    }
    return parsed.data;
  }
}

/** Path segments are ids from user text — never interpolate them raw. */
function enc(segment: string): string {
  return encodeURIComponent(segment);
}

function toApiError(status: number, text: string, where: string): ApiError {
  let code: string | null = null;
  let message = text.slice(0, 400) || `HTTP ${status}`;
  let details: unknown;

  try {
    const envelope = ApiErrorBody.safeParse(JSON.parse(text));
    if (envelope.success) {
      code = envelope.data.error.code;
      message = envelope.data.error.message;
      details = envelope.data.error.details;
    }
  } catch {
    // Not an envelope. `message` already holds the raw body, clamped.
  }

  return new ApiError(kindForStatus(status, code), `${where}: ${message}`, {
    status,
    code,
    details,
  });
}
