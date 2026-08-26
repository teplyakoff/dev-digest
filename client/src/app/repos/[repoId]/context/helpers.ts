/** Pure helpers for the Project Context page. */

import type { AttachedDoc, ContextDoc } from "@/lib/types";

/**
 * The largest `.md` this page will read into memory before uploading.
 *
 * Mirrors the server's `MAX_DOC_BYTES` deliberately, and the duplication is the
 * point: checking `File.size` BEFORE calling `FileReader` is what stops the
 * browser from loading a 500 MB file into memory just to be told 422. The server
 * still owns the real bound — this is a courtesy, not the enforcement.
 */
export const MAX_UPLOAD_BYTES = 64_000;

export class UploadTooLargeError extends Error {
  constructor() {
    super("That file is too large to upload.");
    this.name = "UploadTooLargeError";
  }
}

/**
 * Read an uploaded `.md` as text, so it can be POSTed through the same JSON
 * endpoint a hand-typed document uses.
 *
 * Reading here rather than posting multipart is what keeps the server free of a
 * binary-parse surface and collapses all three ways of adding a document onto
 * one code path.
 */
export async function readUploadedDoc(file: File): Promise<{ name: string; body: string }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadTooLargeError();
  const body = await file.text();
  return { name: file.name, body };
}

/** Human-readable byte size for the status line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The store's totals, derived for a status line the server has not sent yet. */
export function totalsOf(docs: ContextDoc[]): { docs: number; bytes: number } {
  return { docs: docs.length, bytes: docs.reduce((n, d) => n + d.bytes, 0) };
}

/** Summed tokens of one target's attachments. Missing documents count as zero. */
export function attachedTokens(attached: AttachedDoc[]): number {
  return attached.reduce((n, d) => n + (d.missing ? 0 : d.tokens), 0);
}

/**
 * Toggle one id in an attachment set, returning the WHOLE resulting set.
 *
 * Whole set, never a delta: the endpoint replaces, so the caller has to send
 * every id it wants kept. A helper that returned "the id that changed" would
 * make the wrong call the easy one.
 */
export function toggleAttachment(current: string[], docId: string): string[] {
  return current.includes(docId) ? current.filter((id) => id !== docId) : [...current, docId];
}
