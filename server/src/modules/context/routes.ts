import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AttachmentSet, CreateContextDoc, SaveContextDoc } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';

/**
 * Project-context HTTP module (SPEC-06).
 *
 *   GET    /repos/:repoId/context/docs           → the page's list
 *   GET    /repos/:repoId/context/docs/:docId    → one document WITH its body
 *   POST   /repos/:repoId/context/docs           → import · new · upload
 *   PUT    /repos/:repoId/context/docs/:docId    → save the body
 *   DELETE /repos/:repoId/context/docs/:docId    → remove it
 *   GET    /repos/:repoId/context/store          → the status line
 *   GET    /repos/:repoId/context/candidates     → the import picker (409 without a clone)
 *   GET    /agents/:agentId/context-docs         → what this agent carries
 *   PUT    /agents/:agentId/context-docs         → replace that whole set
 *   GET    /skills/:skillId/context-docs         → what rides along with this skill
 *   PUT    /skills/:skillId/context-docs         → replace that whole set
 *
 * Every route declares its Zod `params` and `body`, so a malformed request is
 * rejected at the edge with a 422 before the handler runs — there is no
 * `Schema.parse(req.body)` in any handler here, and there should never be one.
 *
 * The attachment endpoints are a REPLACE, never a delta: the client sends the
 * whole id set for one target, and an empty array detaches everything. That is
 * what makes a lost update impossible to express rather than merely unlikely.
 *
 * Only `candidates` needs a clone. Everything else works on a repo that has
 * never been cloned, which is what AC-38 pins.
 */

const RepoParams = z.object({ repoId: z.string().uuid() });
const DocParams = z.object({ repoId: z.string().uuid(), docId: z.string().uuid() });
const AgentParams = z.object({ agentId: z.string().uuid() });
const SkillParams = z.object({ skillId: z.string().uuid() });

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Through the composition root, not `new ProjectContextService(...)` here: the
  // review executor needs the same instance, and a second one would be a second
  // place to wire.
  const service = app.container.projectContext;

  app.get('/repos/:repoId/context/docs', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.repoId);
  });

  app.get(
    '/repos/:repoId/context/docs/:docId',
    { schema: { params: DocParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.docId);
    },
  );

  app.post(
    '/repos/:repoId/context/docs',
    { schema: { params: RepoParams, body: CreateContextDoc } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const doc = await service.create(workspaceId, req.params.repoId, req.body);
      reply.status(201);
      return doc;
    },
  );

  app.put(
    '/repos/:repoId/context/docs/:docId',
    { schema: { params: DocParams, body: SaveContextDoc } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.save(workspaceId, req.params.docId, req.body.body);
    },
  );

  app.delete(
    '/repos/:repoId/context/docs/:docId',
    { schema: { params: DocParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.remove(workspaceId, req.params.docId);
    },
  );

  app.get('/repos/:repoId/context/store', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.store(workspaceId, req.params.repoId);
  });

  app.get(
    '/repos/:repoId/context/candidates',
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.candidates(workspaceId, req.params.repoId);
    },
  );

  app.get('/agents/:agentId/context-docs', { schema: { params: AgentParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.agentAttachments(workspaceId, req.params.agentId);
  });

  app.put(
    '/agents/:agentId/context-docs',
    { schema: { params: AgentParams, body: AttachmentSet } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setAgentDocs(workspaceId, req.params.agentId, req.body.doc_ids);
    },
  );

  app.get('/skills/:skillId/context-docs', { schema: { params: SkillParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.skillAttachments(workspaceId, req.params.skillId);
  });

  app.put(
    '/skills/:skillId/context-docs',
    { schema: { params: SkillParams, body: AttachmentSet } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setSkillDocs(workspaceId, req.params.skillId, req.body.doc_ids);
    },
  );
}
