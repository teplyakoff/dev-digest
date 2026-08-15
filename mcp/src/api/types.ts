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

/**
 * Ring 1 — the port.
 *
 * onion §4: the inside declares the interface, the outside satisfies it, and a
 * port that has no test double is decorative. Two implementations ship in
 * `src/`: `HttpApiClient` (`client.ts`) and `FakeApiClient` (`fake-client.ts`).
 * Both `implements ApiClient`, which is the whole point — change the shape of
 * one and the compiler breaks the other instead of letting the fixtures drift
 * apart silently.
 *
 * Every parameter and return type is a `@devdigest/shared` contract type, never
 * a `Response`, never a driver row (§5). Failures arrive as `ApiError` from
 * `errors.ts`, never as whatever `fetch` threw.
 */
export interface ApiClient {
  /** `GET /repos` — every repo in the workspace. */
  listRepos(signal?: AbortSignal): Promise<Repo[]>;

  /** `GET /repos/:id/pulls` — the PR list for one repo. */
  listPulls(repoId: string, signal?: AbortSignal): Promise<PrMeta[]>;

  /** `GET /pulls/:id` — one PR with its files and commits. */
  getPull(pullId: string, signal?: AbortSignal): Promise<PrDetail>;

  /** `GET /agents` — review agents, with `skills_count` denormalized on. */
  listAgents(signal?: AbortSignal): Promise<Agent[]>;

  /**
   * `POST /pulls/:id/review` — SINGULAR. The plural `/pulls/:id/reviews` is the
   * read. This returns as soon as the runs are created: `reviews` is ALWAYS
   * `[]`, whatever the contract's docstring used to claim. Blocking is the
   * caller's job (see `usecases/run-review.ts`).
   */
  startReview(pullId: string, body: RunRequest, signal?: AbortSignal): Promise<ReviewRunResponse>;

  /**
   * `GET /pulls/:id/runs` — EVERY run this PR ever had, any status. A poller
   * must filter to the ids `startReview` handed back or it settles on history.
   */
  listRuns(pullId: string, signal?: AbortSignal): Promise<RunSummary[]>;

  /**
   * `GET /pulls/:id/reviews` — one row per AGENT, not per review pass. Callers
   * union every `kind: 'review'` row; picking "the latest" reports the agent
   * that finished last, which is routinely the one with zero findings
   * (`server/INSIGHTS.md:343-356`).
   */
  listReviews(pullId: string, signal?: AbortSignal): Promise<ReviewRecord[]>;

  /**
   * `GET /pulls/:id/blast` — the PR's impact map, read from the server's code
   * index. ALWAYS a 200: "this repository is not indexed" arrives as
   * `status: 'degraded'` with a `reason`, never as an error status, so a caller
   * can tell "nothing calls this" apart from "nothing is known about this".
   */
  getBlast(pullId: string, signal?: AbortSignal): Promise<BlastResponse>;

  /** `GET /repos/:id/conventions` — `{ scan: null }` means never extracted. */
  getConventions(repoId: string, signal?: AbortSignal): Promise<ConventionsView>;

  /** `GET /repos/:id/conventions/skill-draft` — the merge of ACCEPTED candidates. */
  getConventionSkillDraft(repoId: string, signal?: AbortSignal): Promise<ConventionSkillDraft>;
}

/**
 * The MCP result shape the handlers return. Structural — no SDK type crosses
 * inward (§5), which is why a handler can be unit-tested with no SDK at all.
 *
 * The index signature is not decoration: the SDK's own `CallToolResult` carries
 * `[x: string]: unknown` (it is an open protocol object), and without a matching
 * one here the two are not assignable and the composition root would need a
 * cast to bridge them.
 */
export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}
