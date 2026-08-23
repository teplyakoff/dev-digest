import type {
  AttachedDoc,
  ContextDoc,
  ContextDocBody,
  ContextStoreStatus,
  CreateContextDoc,
  ImportCandidates,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { ContextRepository, type DocMeta } from './repository.js';
import {
  CONTEXT_DOC_EXTENSIONS,
  MAX_DOC_BYTES,
  MAX_LISTED_DOCS,
  MAX_STORE_BYTES,
} from './constants.js';
import {
  candidatesFrom,
  isImportablePath,
  looksBinary,
  orderedSpecs,
  tokenCountsFor,
  type ScannedFile,
} from './helpers.js';

/**
 * The project-context store: a repository's curated `.md` documents, the three
 * ways to fill it, and the resolution that feeds a review's `specs` slot.
 *
 * Orchestration only. The SQL is in `repository.ts`, the rules are in
 * `helpers.ts`, and everything this service reaches outside its own module goes
 * through the composition root — `container.sourceReader`, `container.tokenizer`,
 * `container.agentsRepo` — never through a sibling module's folder.
 *
 * **This service writes nothing to the filesystem.** It reads a clone through
 * `SourceReader` and writes only to the database. That is not a stylistic
 * preference: `adapters/git/simple-git.ts` resyncs a clone with `git reset
 * --hard origin/<branch>`, so a store kept in the working tree would be deleted
 * by the next poll without a word. `test_context_no_clone_writes` asserts the
 * absence structurally, because no behavioural test can prove a path is not
 * there.
 *
 * **No model is called on any path here.** The store is plumbing; the only model
 * call in this feature's neighbourhood is the review itself, which happens
 * elsewhere and reads what this service resolved.
 */
export class ProjectContextService {
  private repo: ContextRepository;

  constructor(private container: Container) {
    // Through the composition root, not `new ContextRepository(container.db)`:
    // the container owns the single instance, and a service that built its own
    // would leave `container.contextRepo` as wiring nothing ever reaches.
    this.repo = container.contextRepo;
  }

  // ---- reads ---------------------------------------------------------------

  /** Every document in a repo's store, priced, without bodies. */
  async list(workspaceId: string, repoId: string): Promise<ContextDoc[]> {
    await this.requireRepo(workspaceId, repoId);
    const rows = await this.repo.listDocs(workspaceId, repoId);
    return tokenCountsFor(rows, this.container.tokenizer);
  }

  /** One document with its body — the editor's load. */
  async get(workspaceId: string, docId: string): Promise<ContextDocBody> {
    const row = await this.repo.getDoc(workspaceId, docId);
    if (!row) throw new NotFoundError('Context document not found');
    const [meta] = tokenCountsFor([row], this.container.tokenizer);
    return { ...meta!, body: row.body };
  }

  /**
   * The store's status line: how many documents, how many bytes.
   *
   * Not a chunk count and not an index state — those describe a feature that was
   * deliberately not built, and a status line that reported them would be a
   * standing promise of something that never arrives.
   */
  async store(workspaceId: string, repoId: string): Promise<ContextStoreStatus> {
    await this.requireRepo(workspaceId, repoId);
    const rows = await this.repo.listDocs(workspaceId, repoId);
    return {
      docs: rows.length,
      total_bytes: await this.repo.storeBytes(workspaceId, repoId),
    };
  }

  /**
   * The `.md` files in the repo's clone, offered for import.
   *
   * A repo with no clone is a 409 and not a 500: "you have not cloned this yet"
   * is an answer, and the page renders it as one. Note the asymmetry that AC-38
   * pins — this is the ONLY endpoint that needs a clone. Creating, editing and
   * attaching documents all work on a repo that has never been cloned.
   */
  async candidates(workspaceId: string, repoId: string): Promise<ImportCandidates> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!repo.clonePath) {
      throw new ConflictError('This repo has not been cloned yet.', { code: 'not_cloned' });
    }

    const { entries, truncated } = await this.container.sourceReader.list(repo.clonePath, {
      extensions: CONTEXT_DOC_EXTENSIONS,
      maxEntries: MAX_LISTED_DOCS,
    });

    // Size comes from the directory entry, so an oversized file is REFUSED
    // WITHOUT BEING READ. The previous shape read every candidate whole and held
    // all of them at once to answer one boolean per file — with up to
    // `MAX_LISTED_DOCS` files from a clone whose contents an outsider
    // influences, that is heap exhaustion through a read-only endpoint.
    //
    // Only files already within the bound are decoded, only to learn whether
    // they are UTF-8, and only the ANSWER is kept — never the text.
    const scanned = new Map<string, ScannedFile>();
    for (const { path, bytes } of entries) {
      if (bytes > MAX_DOC_BYTES) {
        scanned.set(path, { bytes, unreadable: false });
        continue;
      }
      const decoded = await this.container.sourceReader.read(repo.clonePath, path);
      scanned.set(path, { bytes, unreadable: decoded === null || looksBinary(decoded) });
    }

    return candidatesFrom(
      entries.map((e) => e.path),
      scanned,
      { maxEntries: MAX_LISTED_DOCS, truncated },
    );
  }

  // ---- writes --------------------------------------------------------------

  /**
   * Create a document — imported from the clone, empty, or from text the browser
   * read out of an uploaded file.
   *
   * Import and upload are not separate code paths. An upload arrives as text
   * through the same JSON body as a hand-typed document, so the server grows no
   * multipart parser and no binary-parse surface, and one integration test
   * covers all three ways in.
   */
  async create(
    workspaceId: string,
    repoId: string,
    input: CreateContextDoc,
  ): Promise<ContextDocBody> {
    const repo = await this.requireRepo(workspaceId, repoId);

    let name: string;
    let body: string;

    if (input.kind === 'import') {
      if (!repo.clonePath) {
        throw new ConflictError('This repo has not been cloned yet.', { code: 'not_cloned' });
      }
      // THE SAME RULE THE PICKER APPLIES, before anything is read.
      //
      // `path` arrives in the request body. Without this the endpoint would read
      // any file inside the clone — including `.git/config`, which the picker
      // never offers and which carries the GitHub token as a URL password. It
      // would have come back in the response, been stored in `context_docs.body`
      // and been sent to a model provider: the "secrets never touch the DB or
      // git" invariant broken by two code paths disagreeing about one input.
      if (!isImportablePath(input.path)) {
        throw new ValidationError('That file cannot be imported from this repo.', {
          code: 'not_importable',
        });
      }

      const decoded = await this.container.sourceReader.read(repo.clonePath, input.path);
      // Re-checked rather than trusted from the picker: its answer is a
      // snapshot, and the file can have grown or been replaced since the scan.
      if (decoded === null) {
        throw new ValidationError('That file cannot be imported (outside_clone).', {
          reason: 'outside_clone',
        });
      }
      const bytes = Buffer.byteLength(decoded, 'utf8');
      if (bytes > MAX_DOC_BYTES) {
        throw new ValidationError('That file cannot be imported (too_large).', {
          reason: 'too_large',
        });
      }
      if (looksBinary(decoded)) {
        throw new ValidationError('That file cannot be imported (not_utf8).', {
          reason: 'not_utf8',
        });
      }
      name = input.name ?? basename(input.path);
      body = decoded;
    } else {
      name = input.name;
      body = input.body;
    }

    await this.assertWithinBounds(workspaceId, repoId, body, { replacingBytes: 0 });

    try {
      const row = await this.repo.createDoc(workspaceId, repoId, name, body);
      const [meta] = tokenCountsFor([row], this.container.tokenizer);
      return { ...meta!, body: row.body };
    } catch (err) {
      // The per-repo unique index is the only thing that can fail here, and
      // "that name is taken" is a 409 rather than a 422: the input's shape is
      // fine, the world disagrees.
      if (isUniqueViolation(err)) {
        throw new ConflictError(`A document named "${name}" already exists in this repo.`, {
          code: 'duplicate_name',
        });
      }
      throw err;
    }
  }

  /**
   * Replace a document's body.
   *
   * Both bounds are checked BEFORE the write, and a refusal leaves the stored
   * body byte-identical. A check placed after the write would pass every test
   * that only looks at the status code and fail the one that reads the document
   * back — which is exactly the assertion AC-36 makes.
   */
  async save(workspaceId: string, docId: string, body: string): Promise<ContextDocBody> {
    const existing = await this.repo.getDoc(workspaceId, docId);
    if (!existing) throw new NotFoundError('Context document not found');

    await this.assertWithinBounds(workspaceId, existing.repoId, body, {
      replacingBytes: Buffer.byteLength(existing.body, 'utf8'),
    });

    const row = await this.repo.replaceBody(workspaceId, docId, body);
    if (!row) throw new NotFoundError('Context document not found');
    const [meta] = tokenCountsFor([row], this.container.tokenizer);
    return { ...meta!, body: row.body };
  }

  async remove(workspaceId: string, docId: string): Promise<{ deleted: true }> {
    const ok = await this.repo.deleteDoc(workspaceId, docId);
    if (!ok) throw new NotFoundError('Context document not found');
    return { deleted: true };
  }

  // ---- attachments ---------------------------------------------------------

  /**
   * Replace an agent's whole attachment set.
   *
   * An agent id from another workspace answers 404, not 403: whether that agent
   * exists at all is not this tenant's business, and a 403 would confirm it does.
   */
  async setAgentDocs(
    workspaceId: string,
    agentId: string,
    docIds: string[],
  ): Promise<AttachedDoc[]> {
    if (!(await this.repo.agentExists(workspaceId, agentId))) {
      throw new NotFoundError('Agent not found');
    }
    await this.repo.setAgentDocs(workspaceId, agentId, docIds);
    return this.attachedFor(workspaceId, await this.repo.agentDocIds(workspaceId, agentId));
  }

  /** Replace a skill's whole attachment set. Same 404 rule as the agent path. */
  async setSkillDocs(
    workspaceId: string,
    skillId: string,
    docIds: string[],
  ): Promise<AttachedDoc[]> {
    if (!(await this.repo.skillExists(workspaceId, skillId))) {
      throw new NotFoundError('Skill not found');
    }
    await this.repo.setSkillDocs(workspaceId, skillId, docIds);
    return this.attachedFor(workspaceId, await this.repo.skillDocIds(workspaceId, skillId));
  }

  /** What is attached to one agent right now, including documents since deleted. */
  async agentAttachments(workspaceId: string, agentId: string): Promise<AttachedDoc[]> {
    if (!(await this.repo.agentExists(workspaceId, agentId))) {
      throw new NotFoundError('Agent not found');
    }
    return this.attachedFor(workspaceId, await this.repo.agentDocIds(workspaceId, agentId));
  }

  /** What is attached to one skill right now. */
  async skillAttachments(workspaceId: string, skillId: string): Promise<AttachedDoc[]> {
    if (!(await this.repo.skillExists(workspaceId, skillId))) {
      throw new NotFoundError('Skill not found');
    }
    return this.attachedFor(workspaceId, await this.repo.skillDocIds(workspaceId, skillId));
  }

  // ---- the prompt's `specs` slot -------------------------------------------

  /**
   * The bodies one agent carries into a review of one repo, in prompt order.
   *
   * Two sources, one list: what is attached to the agent, plus what is attached
   * to each of the agent's ENABLED skills. A globally disabled skill contributes
   * nothing, exactly as its own body already contributes nothing — the master
   * switch means the same thing for everything the skill brings with it.
   *
   * `total` counts attachments that are IN SCOPE for this repo: documents that
   * resolve to it, plus ids that resolve to nothing at all (the document was
   * deleted). An id resolving to a DIFFERENT repo's document is neither loaded
   * nor counted — reporting `0/3` on every review of another repository would
   * describe a fault that is not there.
   *
   * `loaded` counts the ones that resolved. `total - loaded` is therefore exactly
   * the number of dangling attachments, which is what the run log reports.
   */
  async specsForAgent(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<{ bodies: string[]; names: string[]; loaded: number; total: number }> {
    const links = await this.container.agentsRepo.linkedSkills(agentId);
    const enabledSkillIds = links.filter((l) => l.skill.enabled).map((l) => l.skill.id);

    const [agentDocs, skillDocs, agentIds, skillIdSets] = await Promise.all([
      this.repo.docsForAgent(workspaceId, agentId, repoId),
      this.repo.docsForSkills(workspaceId, enabledSkillIds, repoId),
      this.repo.agentDocIds(workspaceId, agentId),
      Promise.all(enabledSkillIds.map((id) => this.repo.skillDocIds(workspaceId, id))),
    ]);

    const ordered = orderedSpecs<DocMeta>(agentDocs, skillDocs);

    const attachedIds = new Set([...agentIds, ...skillIdSets.flat()]);
    const resolved = new Set(ordered.map((d) => d.id));
    // Ids that resolve to no document AT ALL are dangling and counted; ids that
    // resolve to another repo's document are out of scope and are not.
    const known = new Set(
      (await this.repo.docsByIds(workspaceId, [...attachedIds])).map((d) => d.id),
    );
    const dangling = [...attachedIds].filter((id) => !known.has(id)).length;

    return {
      bodies: ordered.map((d) => d.body),
      names: ordered.map((d) => d.name),
      loaded: resolved.size,
      total: resolved.size + dangling,
    };
  }

  // ---- internals -----------------------------------------------------------

  private async requireRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<{ id: string; clonePath: string | null }> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /**
   * Both size bounds, checked before any write.
   *
   * The store bound is checked against the RESULTING size, not against the
   * request: replacing a 60 kB body with a 1 kB one must not be refused because
   * the store is near its limit, and a check on the incoming size alone would
   * refuse it. `replacingBytes` is what makes that arithmetic correct.
   */
  private async assertWithinBounds(
    workspaceId: string,
    repoId: string,
    body: string,
    opts: { replacingBytes: number },
  ): Promise<void> {
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > MAX_DOC_BYTES) {
      throw new ValidationError(
        `That document is ${bytes.toLocaleString('en-US')} bytes; the limit for one document is ${MAX_DOC_BYTES.toLocaleString('en-US')}.`,
        { code: 'doc_too_large', bytes, limit: MAX_DOC_BYTES },
      );
    }
    const current = await this.repo.storeBytes(workspaceId, repoId);
    const resulting = current - opts.replacingBytes + bytes;
    if (resulting > MAX_STORE_BYTES) {
      throw new ValidationError(
        `This repo's context store would reach ${resulting.toLocaleString('en-US')} bytes; the limit for a store is ${MAX_STORE_BYTES.toLocaleString('en-US')}.`,
        { code: 'store_too_large', bytes: resulting, limit: MAX_STORE_BYTES },
      );
    }
  }

  /**
   * Attachment rows resolved to documents, with the dangling ones kept and
   * marked `missing`.
   *
   * Kept rather than dropped so a person can detach a document that no longer
   * exists. A silently filtered list would leave the row in the database with no
   * way to reach it from the page.
   */
  private async attachedFor(workspaceId: string, docIds: string[]): Promise<AttachedDoc[]> {
    const rows = await this.repo.docsByIds(workspaceId, docIds);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const priced = new Map(
      tokenCountsFor(rows, this.container.tokenizer).map((d) => [d.id, d]),
    );

    return docIds
      .map((id): AttachedDoc => {
        const meta = priced.get(id);
        if (meta && byId.has(id)) return { ...meta, missing: false };
        return {
          id,
          name: '(deleted document)',
          bytes: 0,
          tokens: 0,
          updated_at: new Date(0).toISOString(),
          missing: true,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }
}

/** The last path segment — an imported document's default name. */
function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/** Postgres unique-violation SQLSTATE, which is how a duplicate name surfaces. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
