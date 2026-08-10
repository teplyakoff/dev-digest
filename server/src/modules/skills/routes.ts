import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillImportPreview, SkillName, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { MAX_ARCHIVE_BYTES } from './import/constants.js';

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * A1 — skills module (owner A1).
 *   GET    /skills                      → list (workspace-scoped, by name)
 *   GET    /skills/:id                  → one skill
 *   POST   /skills                      → create (snapshots body as v1)
 *   PUT    /skills/:id                  → update (body change bumps + snapshots)
 *   DELETE /skills/:id                  → delete (agent links cascade)
 *   GET    /skills/:id/versions         → body history (newest first)
 *   GET    /skills/:id/versions/:version→ one body snapshot
 *   GET    /skills/:id/agents           → agents that load this skill
 *   GET    /skills/:id/stats            → usage + what it has cost across runs
 *
 * The agent side of the link lives in the agents module
 * (`GET/POST /agents/:id/skills`) — it is A2's to own.
 */

const CreateSkillBody = z.object({
  name: SkillName,
  description: z.string().min(1),
  type: SkillType,
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: SkillName.optional(),
  description: z.string().min(1).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

/**
 * An upload, as base64 inside a Zod-validated JSON body rather than multipart.
 *
 * One code path serves `.md` and `.zip`, no multipart dependency, and the repo's
 * "routes declare Zod schemas" convention survives — a multipart route would
 * have to hand-roll its validation. The cost is base64's ~33% inflation, hence
 * the raised `bodyLimit` on both import routes.
 */
const ImportBody = z.object({
  filename: z.string().min(1).max(255),
  content_base64: z.string().min(1),
});

/** Base64 padding makes the encoded form ~4/3 of the bytes; leave headroom. */
const IMPORT_BODY_LIMIT = Math.ceil(MAX_ARCHIVE_BYTES * 1.4);

/**
 * Base64 → bytes, strictly. `Buffer.from(s, 'base64')` silently discards
 * anything it cannot decode, so a corrupted upload would otherwise arrive as a
 * shorter, plausible-looking buffer and be parsed as if it were the real file.
 */
function decodeUpload(base64: string): Buffer {
  const normalised = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const buf = Buffer.from(normalised, 'base64');
  if (buf.length === 0 || buf.toString('base64').replace(/=+$/, '') !== normalised.replace(/=+$/, '')) {
    throw new ValidationError('Upload could not be decoded — the file did not arrive intact.');
  }
  return buf;
}

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description,
      type: body.type,
      body: body.body,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get('/skills/:id/versions/:version', { schema: { params: VersionParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
    if (!version) throw new NotFoundError('Skill version not found');
    return version;
  });

  /**
   * Parse an upload and return what it contains — WITHOUT writing anything.
   * The response is the mandatory human gate: the body in full, and the list of
   * archive entries the importer refused to open.
   */
  app.post(
    '/skills/import/preview',
    { schema: { body: ImportBody }, bodyLimit: IMPORT_BODY_LIMIT },
    async (req) => {
      await getContext(app.container, req);
      return service.preview(req.body.filename, decodeUpload(req.body.content_base64));
    },
  );

  /** Persist a previewed skill. Lands disabled — see SkillsService.importConfirm. */
  app.post(
    '/skills/import/confirm',
    { schema: { body: SkillImportPreview }, bodyLimit: IMPORT_BODY_LIMIT },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.importConfirm(workspaceId, req.body);
      reply.status(201);
      return skill;
    },
  );

  app.get('/skills/:id/agents', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const usage = await service.usage(workspaceId, req.params.id);
    if (!usage) throw new NotFoundError('Skill not found');
    return usage;
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.stats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });
}
