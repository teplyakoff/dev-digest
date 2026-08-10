import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff HTTP module (L03 homework).
 *
 *   GET /pulls/:id/smart-diff → the PR's changed files, grouped core / wiring /
 *                               boilerplate and ordered by risk
 *
 * `params` and `response` are both declared, so `/pulls/not-a-uuid/smart-diff`
 * is a 422 before the handler body runs and the reply is serialized through a
 * compiled schema rather than `JSON.stringify`. Never `Schema.parse(req.params)`
 * inside a handler.
 *
 * ACCESS CONTROL, in full — the `:id` is the only attacker-controlled input on
 * this route, and it is an opaque row id, which is the classic IDOR shape. Two
 * things stand between it and another tenant's data, and neither is optional:
 * `IdParams` rejects anything that is not a uuid at the edge, and the service's
 * FIRST statement is `getPull(workspaceId, prId)`, which 404s a PR belonging to
 * any other workspace. Nothing is read before that lookup has proved ownership.
 *
 * NO RATE LIMIT, deliberately. `/pulls/:id/intent` carries one because each call
 * is a billed model request; this call spends nothing and makes two indexed
 * reads, so a per-route ceiling here would misrepresent its cost. The global
 * limit still applies.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SmartDiffService(app.container);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiffResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id, req.log);
    },
  );
}
