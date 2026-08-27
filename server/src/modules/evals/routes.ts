import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseUpsert } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalService } from './service.js';
import { BATCH_RATE_LIMIT } from './constants.js';

/**
 * L06 / SPEC-08 — eval-pipeline HTTP module. Transport only: parse, delegate,
 * map the status code (onion §9). No loop and no `try/catch` around anything
 * but a status decision lives in this file.
 *
 *   POST   /findings/:id/eval-case      → seed a case from a decided finding
 *   GET    /agents/:id/eval-cases       → the whole set, one response, no paging
 *   POST   /eval-cases                  → hand-written case
 *   PUT    /eval-cases/:id              → edit one
 *   DELETE /eval-cases/:id              → remove one
 *   POST   /agents/:id/eval-batches     → run the set (rate-limited, 3/min)
 *   GET    /agents/:id/eval-batches     → the batch history, NEWEST FIRST
 *   GET    /agents/:id/eval-dashboard   → aggregates + trend + recent runs + banner
 *   GET    /eval-batches/compare?a=&b=  → two batches side by side
 *   GET    /eval-batches/:id            → one batch row
 *   GET    /eval-batches/:id/runs       → that batch's per-case rows
 *
 * Status codes, and who decides them:
 *   404 — the service could not find the row IN THIS WORKSPACE. That is the
 *         whole of AC-28: another tenant's case, batch or run is indistinguishable
 *         from one that does not exist, because the repository's joins never let
 *         it be selected in the first place.
 *   409 — a batch for this agent is already running (there is no queue; UX-5).
 *   422 — an undecided finding, a finding whose file has no stored patch, an
 *         empty case set, or `owner_kind: 'skill'`. All four are the service's
 *         `ValidationError`; the number is transport's translation.
 *   429 — the fourth batch request inside a minute (NFR-4).
 *
 * `params`, `body` and `querystring` are declared on every route, so malformed
 * input is a 422 before the handler runs. There is no `Schema.parse(req.body)`
 * here and there should never be one.
 */

const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container);

  // ---- cases --------------------------------------------------------------

  app.post('/findings/:id/eval-case', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.createCaseFromFinding(workspaceId, req.params.id);
    reply.status(201);
    return result;
  });

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listCases(workspaceId, req.params.id);
  });

  app.post('/eval-cases', { schema: { body: EvalCaseUpsert } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const created = await service.createCase(workspaceId, req.body);
    reply.status(201);
    return created;
  });

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseUpsert } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.deleteCase(workspaceId, req.params.id);
    return { deleted: req.params.id };
  });

  // ---- batches ------------------------------------------------------------

  app.post(
    '/agents/:id/eval-batches',
    {
      schema: { params: IdParams },
      // One click here is N billed model calls, which is the `security` skill's
      // "AI generation" category — 3 per minute, the tightest limit in this API
      // and the same shape as `modules/intent/routes.ts:44` (NFR-4).
      config: { rateLimit: BATCH_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const batch = await service.startBatch(workspaceId, req.params.id, req.log);
      // 202: the row exists and is `running`; the work has not finished. The
      // client polls the dashboard or the batch row for the rest.
      reply.status(202);
      return batch;
    },
  );

  /**
   * The batch history the compare flow selects from. Same path as the POST
   * above, different method: one is "run the set", the other is "what has been
   * run".
   *
   * NEWEST FIRST, and that ordering is depended upon — the client pairs its two
   * selected rows as `(older, newer)` by `started_at` and `/eval-batches/compare`
   * reports `b − a`, so reversing this list would flip the sign of every delta
   * and show an improvement as a regression. Capped at `BATCH_HISTORY_LIMIT`
   * (50) in one unpaginated response, per NFR-14 — no cursor, no page param.
   *
   * Unrated: it is a workspace-scoped read with no model call behind it, unlike
   * the POST on the same path.
   */
  app.get('/agents/:id/eval-batches', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listBatches(workspaceId, req.params.id);
  });

  app.get('/agents/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboard(workspaceId, req.params.id);
  });

  // Declared before `/:id` for the reader's sake; Fastify's radix tree resolves
  // the static segment first either way.
  app.get('/eval-batches/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.compare(workspaceId, req.query.a, req.query.b);
  });

  app.get('/eval-batches/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getBatch(workspaceId, req.params.id);
  });

  app.get('/eval-batches/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runsForBatch(workspaceId, req.params.id);
  });
}
