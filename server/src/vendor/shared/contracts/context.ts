import { z } from 'zod';

/**
 * contracts/context — the project-context document store (SPEC-06).
 *
 * A repository's context store is a flat set of `.md` documents held in the
 * DATABASE, not in the clone. `simple-git.ts` resyncs a clone with
 * `git reset --hard origin/<branch>`, which would delete a file written there
 * without a word — so "where does the text live" is a correctness question, not
 * a preference.
 *
 * Documents are attached to agents and to skills. An attachment decides only
 * WHETHER a body is included in a review's prompt; it never decides at what
 * trust level. Every body reaches the model through `PromptParts.specs`, which
 * the engine wraps in `wrapUntrusted('spec-N', …)` — both origins (text imported
 * out of a clone, and text a person typed) are untrusted, and neither is engine
 * configuration.
 */

/** A document's metadata — everything the list needs, without the body. */
export const ContextDoc = z.object({
  id: z.string(),
  /** Unique per repo. The name the prompt orders by and the trace records. */
  name: z.string(),
  /** Byte length of the body as UTF-8, which is what the size bounds count. */
  bytes: z.number().int(),
  /**
   * Tokens the body costs, from `container.tokenizer`. Reporting only: the
   * tokenizer never throws and falls back to `ceil(chars/4)`, so this number is
   * an estimate for a non-`cl100k_base` model and nothing on screen says so.
   */
  tokens: z.number().int(),
  /**
   * How many agents would RECEIVE this document on their next run — attached to
   * the agent directly, or riding along on an ENABLED skill that agent links.
   * An agent reached both ways counts once.
   *
   * "Would receive", not "is attached to": the number has to agree with the run
   * log's `Project context: n/m document(s) loaded`, and a count of direct
   * attachments alone would read `0` for a document that two agents are about
   * to be sent through a skill.
   */
  agents: z.number().int(),
  updated_at: z.string(),
});
export type ContextDoc = z.infer<typeof ContextDoc>;

/** One document WITH its text — the single-document read and the editor's load. */
export const ContextDocBody = ContextDoc.extend({
  body: z.string(),
});
export type ContextDocBody = z.infer<typeof ContextDocBody>;

/**
 * The store's status line: how many documents and how many bytes in total.
 *
 * Deliberately NOT a chunk count or an index state. Chunking and embeddings are
 * a non-goal of SPEC-06 and `code_chunks` stays empty; a status line that
 * reported either would describe a feature nobody built.
 */
export const ContextStoreStatus = z.object({
  docs: z.number().int(),
  total_bytes: z.number().int(),
});
export type ContextStoreStatus = z.infer<typeof ContextStoreStatus>;

/** Why a candidate cannot be imported. Machine-readable so the UI can explain it. */
export const ImportSkipReason = z.enum(['too_large', 'not_utf8', 'outside_clone']);
export type ImportSkipReason = z.infer<typeof ImportSkipReason>;

/**
 * One `.md` found in the clone, offered for import.
 *
 * A DISCRIMINATED UNION on `status`, so `skipped` carries a `reason` and `ok`
 * cannot. Two independent fields expressed the same intent only in prose, and
 * prose is not what the client reads: the picker indexes a translation key by
 * `reason`, so the state the old shape permitted — `skipped` with no reason —
 * rendered as the literal string `picker.skipped.undefined`. The server never
 * produced it; the contract is what stops that from being one refactor away.
 *
 * A skipped candidate is still RETURNED, with its reason, rather than filtered
 * out — "your file is not in the list" is a question the picker should answer
 * rather than raise.
 */
export const ImportCandidate = z.discriminatedUnion('status', [
  z.object({
    path: z.string(),
    bytes: z.number().int(),
    status: z.literal('ok'),
  }),
  z.object({
    path: z.string(),
    bytes: z.number().int(),
    status: z.literal('skipped'),
    reason: ImportSkipReason,
  }),
]);
export type ImportCandidate = z.infer<typeof ImportCandidate>;

/**
 * The candidate list, and whether the cap cut it short.
 *
 * `truncated` is a first-class field rather than a length comparison the client
 * has to make: the cap lives in the server's constants, and a client that
 * re-derived it would be a second copy of a number that is allowed to move.
 */
export const ImportCandidates = z.object({
  candidates: z.array(ImportCandidate),
  truncated: z.boolean(),
});
export type ImportCandidates = z.infer<typeof ImportCandidates>;

/**
 * The whole attachment set for one agent or one skill — a REPLACE, never a delta.
 *
 * The client sends every id it wants attached, including the ones that were
 * already there. A delta protocol would leave the server's replace semantics
 * correct and the result wrong, which is the failure mode this shape removes.
 */
export const AttachmentSet = z.object({
  doc_ids: z.array(z.string()),
});
export type AttachmentSet = z.infer<typeof AttachmentSet>;

/**
 * A document as seen from an attachment.
 *
 * `missing: true` means the row is attached but the document has been deleted
 * from the store. It is shown rather than silently dropped so the attachment can
 * still be removed by a person — and a run skips it and completes normally.
 */
export const AttachedDoc = ContextDoc.extend({
  missing: z.boolean(),
});
export type AttachedDoc = z.infer<typeof AttachedDoc>;

/** How a new document is created: imported from the clone, empty, or from text. */
export const CreateContextDoc = z.discriminatedUnion('kind', [
  /** Import: the server reads the clone through `SourceReader` at this path. */
  z.object({
    kind: z.literal('import'),
    path: z.string().min(1),
    name: z.string().min(1).max(200).optional(),
  }),
  /**
   * Create and upload land on the SAME shape on purpose. An upload is read by
   * the browser with `FileReader` and POSTed as text, so the server grows no
   * multipart path and no binary-parse surface, and all three creation routes
   * are covered by one server code path.
   */
  z.object({
    kind: z.literal('text'),
    name: z.string().min(1).max(200),
    body: z.string(),
  }),
]);
export type CreateContextDoc = z.infer<typeof CreateContextDoc>;

/** The editor's save — the whole body, replacing whatever is stored. */
export const SaveContextDoc = z.object({
  body: z.string(),
});
export type SaveContextDoc = z.infer<typeof SaveContextDoc>;
