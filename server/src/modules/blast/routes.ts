import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * Blast Radius HTTP module (L04 homework).
 *
 *   GET /pulls/:id/blast → the symbols this PR changes, who calls them, and the
 *                          HTTP routes and cron jobs downstream of both
 *
 * WHY IT LIVES HERE AND NOT IN `repo-intel`. The data is repo-intel's, but the
 * question is a PR's: the route is keyed by `pulls.id`, its tenancy comes from
 * the pull request, and `repo-intel/routes.ts` registers repo-keyed operations
 * (`/repos/:id/index-state`, `/repos/:id/resync`). A feature is a module
 * (`server/AGENTS.md`), and this is a feature.
 *
 * `params` and `response` are both declared, so `/pulls/not-a-uuid/blast` is a
 * 422 before the handler body runs and the reply is serialized through a
 * compiled schema. Never `Schema.parse(req.params)` inside a handler.
 *
 * ACCESS CONTROL, in full — `:id` is the only attacker-controlled input, and it
 * is an opaque row id, which is the classic IDOR shape. Two things stand
 * between it and another tenant's code map, and neither is optional: `IdParams`
 * rejects a non-uuid at the edge, and the service's FIRST statement is
 * `getPull(workspaceId, prId)`, which 404s a PR in any other workspace. Nothing
 * is read before that lookup has proved ownership.
 *
 * NO RATE LIMIT, deliberately, and for the same reason `smart-diff` carries
 * none: `/pulls/:id/intent` is rate-limited because each call is a billed model
 * request, while this one spends nothing and makes four indexed reads. A
 * per-route ceiling here would misrepresent its cost. The global limit applies.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService(app.container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id, req.log);
    },
  );
}
