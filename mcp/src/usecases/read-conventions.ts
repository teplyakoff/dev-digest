import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionScan,
  ConventionStatus,
} from '@devdigest/shared';
import { ApiError } from '../api/errors.js';
import type { ApiClient } from '../api/types.js';
// A plain `{ warn(msg, fields?) }` object, not a logging library's type — §5's
// rule for a cross-cutting value that crosses inward, and there is nothing here
// to mock.
import { log } from '../log.js';
import type { Resolver } from '../resolve.js';

/** Ring 2 — resolve → read → (optionally) a second read → filter → paginate. */

export interface ConventionsQuery {
  repo: string;
  status: ConventionStatus | 'all';
  category?: ConventionCategory | undefined;
  limit: number;
  offset: number;
  includeSkillDraft: boolean;
}

export interface ConventionsPage {
  label: string;
  /** null = the extractor has never run for this repo. NOT the same as "no conventions". */
  scan: ConventionScan | null;
  total: number;
  matched: number;
  items: ConventionCandidate[];
  /** Present only when asked for; unbounded by design (`knowledge.ts:451-471`). */
  skillDraftBody: string | null;
}

export async function readConventions(
  query: ConventionsQuery,
  api: ApiClient,
  resolver: Resolver,
  signal?: AbortSignal,
): Promise<ConventionsPage> {
  const repo = await resolver.repo(query.repo, signal);
  const view = await api.getConventions(repo.id, signal);

  const matched = view.candidates.filter(
    (c) =>
      (query.status === 'all' || c.status === query.status) &&
      (!query.category || c.category === query.category),
  );

  let skillDraftBody: string | null = null;
  if (query.includeSkillDraft && view.scan) {
    try {
      const draft = await api.getConventionSkillDraft(repo.id, signal);
      skillDraftBody = draft.body;
    } catch (err) {
      // Enrichment degrades, the operation does not fail (onion §10). The draft
      // 404s when nothing has been accepted yet, which is a normal state, not
      // an error worth failing the whole read over.
      //
      // Two things this catch must NOT do, both of them §10's other half.
      // Swallow silently: a degraded answer that leaves no trace is
      // indistinguishable from a complete one, so it goes to stderr. And
      // swallow a cancellation: if the CALLER aborted, "no skill draft" is not
      // a degraded answer, it is the wrong answer to a question nobody is
      // waiting for any more.
      if (signal?.aborted) throw err;
      log.warn('convention skill draft unavailable — continuing without it', {
        repo: repo.full_name,
        reason: err instanceof ApiError ? err.kind : String(err),
      });
      skillDraftBody = null;
    }
  }

  return {
    label: repo.full_name,
    scan: view.scan,
    total: view.candidates.length,
    matched: matched.length,
    items: matched.slice(query.offset, query.offset + query.limit),
    skillDraftBody,
  };
}
