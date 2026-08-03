/** Limits and policy for skill import. Every one of these is a refusal, not a
 *  truncation — a partially-read archive would make the "ignored" list a lie. */

/** Max size of a bare `.md` upload. */
export const MAX_MARKDOWN_BYTES = 256 * 1024;

/** Max size of a `.zip` upload, compressed. */
export const MAX_ARCHIVE_BYTES = 1024 * 1024;

/** Archive expansion caps, checked against the central directory before any
 *  entry is inflated. */
export const ZIP_LIMITS = {
  maxEntries: 200,
  maxEntrySize: 1024 * 1024,
  maxTotalSize: 4 * 1024 * 1024,
} as const;

/** The conventional entry name, preferred at the shallowest depth. */
export const PREFERRED_ENTRY = 'SKILL.md';

/**
 * Frontmatter keys the importer honours. Everything else — `allowed-tools`,
 * `command`, `hooks`, `model`, whatever a foreign format carries — is reported
 * as dropped and never stored. An allowlist, so a new key in someone else's
 * format arrives inert rather than interpreted.
 */
export const FRONTMATTER_ALLOWLIST = ['name', 'description', 'type'] as const;

/** Reasons attached to ignored archive entries, so the UI renders words rather
 *  than a bare file list. */
export const IGNORE_REASONS = {
  notTheBody: 'not the skill body — never opened',
  directory: 'directory entry',
} as const;
