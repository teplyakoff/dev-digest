import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBriefView } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * PR Brief HTTP module (L05).
 *
 *   GET  /pulls/:id/brief   → the card's read; `{brief: null}` before the first
 *                             build, never a 404
 *   POST /pulls/:id/brief   → build it now (synchronous — one model call, two on
 *                             a PR whose intent is stale)
 *
 * THE GET NEVER BUILDS. Opening a PR page must not spend money, so the read is a
 * read; the mirror of `GET /pulls/:id/intent`. That is also what makes the empty
 * state on the client (AC-53) reachable at all — something has to return a null
 * brief for a card to invite a build.
 *
 * `params` and `response` are declared on both, so an invalid uuid is a 422
 * BEFORE the handler runs and the reply is serialized through a compiled schema.
 * Never `Schema.parse(req.body)` inside a handler.
 *
 * Each handler does exactly three things: resolve the caller's context,
 * delegate, and let the error mapper turn a taxonomy error into a status code.
 * A brief that does not fit the token budget surfaces as the service's 409;
 * a PR in another workspace as its 404.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    // No rate limit: this spends nothing, exactly like `blast` and `smart-diff`.
    { schema: { params: IdParams, response: { 200: PrBriefView } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.view(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: PrBriefView } },
      // Each call is a real, billed model request against input a PR author
      // controls, so the ceiling is per-route rather than left to the global
      // limit. 10/min is generous for a button a human clicks and cheap to
      // exceed for anything that isn't.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.build(workspaceId, req.params.id, req.log);
    },
  );
}
