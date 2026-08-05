import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrMeta, PrDetail, PrReviewComment } from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullsService } from './service.js';

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET  /repos/:id/pulls    → list PRs for a repo (open + recently merged/closed,
 *                              synced from GitHub, persisted). `status` is the
 *                              derived review status, not GitHub's merge state.
 *   GET  /pulls/:id          → full PR detail (diff/files, commits, body)
 *   GET  /pulls/:id/comments → inline review comments, proxied live from GitHub
 *   POST /pulls/:id/comments → create one, immediately, on GitHub
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL and
 * owned by A2 — this module only imports and reads.
 *
 * Everything these handlers used to do inline — GitHub sync, the diff-stat
 * backfill, three read-time aggregations, the offline fallbacks — now lives in
 * `service.ts` over `repository.ts`. A handler parses, delegates, and lets the
 * error handler map the status code (onion §9).
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PullsService(app.container, app.log);

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listForRepo(workspaceId, req.params.id);
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getDetail(workspaceId, req.params.id);
  });

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listComments(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.createComment(workspaceId, req.params.id, req.body);
    },
  );
}
