import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrIntentView } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';

/**
 * PR Intent HTTP module (L03).
 *
 *   GET  /pulls/:id/intent   → the card's read; `{intent: null}` before the first
 *                              derivation, never a 404
 *   POST /pulls/:id/intent   → re-derive now (synchronous — see `service.ts`)
 *
 * `params` and `response` are declared on both, so an invalid id is a 422 before
 * the handler runs and the reply is serialized through a compiled schema rather
 * than `JSON.stringify`. Never `Schema.parse(req.body)` inside a handler.
 *
 * An unknown PR — or one in another workspace — is a 404 from the service's
 * workspace-scoped lookup. A PR whose repo has no clone is NOT an error: it
 * derives, recording every `repo_file` source as unavailable.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new IntentService(app.container);

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: PrIntentView } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.view(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/intent',
    {
      schema: { params: IdParams, response: { 200: PrIntentView } },
      // Each call is a real, billed model request against input a PR author
      // controls, so the ceiling is per-route rather than left to the global
      // limit. 10/min is generous for a button a human clicks and cheap to
      // exceed for anything that isn't.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.derive(workspaceId, req.params.id, req.log);
    },
  );
}
