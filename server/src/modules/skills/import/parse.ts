import type { SkillImportPreview, SkillType } from '@devdigest/shared';
import { SKILL_NAME_PATTERN, SkillType as SkillTypeSchema } from '@devdigest/shared';
import { ValidationError } from '../../../platform/errors.js';
import { DEFAULT_SKILL_TYPE } from '../constants.js';
import {
  FRONTMATTER_ALLOWLIST,
  IGNORE_REASONS,
  MAX_ARCHIVE_BYTES,
  MAX_MARKDOWN_BYTES,
  PREFERRED_ENTRY,
  ZIP_LIMITS,
} from './constants.js';
import { listEntries, readEntry, ZipError, type ZipEntry } from './zip.js';

/**
 * Parse an uploaded skill into a preview. PURE (no DB, no fs, no network), so
 * every rule below is unit-testable without Docker.
 *
 * The whole point of this module is the trust boundary: an upload is someone
 * else's instructions, and the preview it returns is what a human reads before
 * those instructions go anywhere near an agent's prompt. It therefore reports
 * what it refused to open, rather than quietly doing the right thing.
 */

export interface ParseInput {
  filename: string;
  content: Buffer;
}

export function parseSkillUpload(input: ParseInput): SkillImportPreview {
  const kind = detectKind(input.filename);
  return kind === 'archive' ? parseArchive(input) : parseMarkdown(input);
}

// ---- markdown --------------------------------------------------------------

function parseMarkdown({ filename, content }: ParseInput): SkillImportPreview {
  if (content.length > MAX_MARKDOWN_BYTES) {
    throw new ValidationError(
      `That file is ${content.length} bytes; the limit for a markdown skill is ${MAX_MARKDOWN_BYTES}.`,
    );
  }
  return toPreview({
    filename,
    kind: 'markdown',
    bytes: content.length,
    entryPath: null,
    raw: content.toString('utf8'),
    ignored: [],
    fallbackName: basename(filename),
  });
}

// ---- archive ---------------------------------------------------------------

function parseArchive({ filename, content }: ParseInput): SkillImportPreview {
  if (content.length > MAX_ARCHIVE_BYTES) {
    throw new ValidationError(
      `That archive is ${content.length} bytes; the limit is ${MAX_ARCHIVE_BYTES}.`,
    );
  }

  let entries: ZipEntry[];
  try {
    entries = listEntries(content, ZIP_LIMITS);
  } catch (err) {
    if (err instanceof ZipError) throw new ValidationError(err.message);
    throw err;
  }

  // An archive containing a traversal or absolute path is refused WHOLE, not
  // entry-by-entry. We are not extracting anything, so nothing could escape —
  // but an archive built to escape is not one to keep parsing, and skipping the
  // bad entry would put a reassuring "ignored" line where a refusal belongs.
  const hostile = entries.find((e) => isUnsafePath(e.path));
  if (hostile) {
    throw new ValidationError(
      `Refusing this archive: "${hostile.path}" is an absolute or path-traversing entry.`,
    );
  }

  const candidates = entries.filter((e) => !e.isDirectory && e.path.toLowerCase().endsWith('.md'));
  const chosen = chooseEntry(candidates);

  const ignored = entries
    .filter((e) => e !== chosen)
    .map((e) => ({
      path: e.path,
      reason: e.isDirectory ? IGNORE_REASONS.directory : IGNORE_REASONS.notTheBody,
    }));

  let raw: string;
  try {
    raw = readEntry(content, chosen);
  } catch (err) {
    if (err instanceof ZipError) throw new ValidationError(err.message);
    throw err;
  }

  return toPreview({
    filename,
    kind: 'archive',
    bytes: content.length,
    entryPath: chosen.path,
    raw,
    ignored,
    fallbackName: basename(chosen.path),
  });
}

/**
 * `SKILL.md` at the shallowest depth wins; failing that, the only `.md` in the
 * archive. Anything else is ambiguous, and guessing which of several files is
 * "the skill" is exactly the decision that belongs to a person.
 */
function chooseEntry(candidates: ZipEntry[]): ZipEntry {
  if (candidates.length === 0) {
    throw new ValidationError('No markdown file in that archive — a skill needs one.');
  }
  const preferred = candidates
    .filter((e) => basename(e.path).toLowerCase() === PREFERRED_ENTRY.toLowerCase())
    .sort((a, b) => depth(a.path) - depth(b.path));
  if (preferred.length > 0) return preferred[0]!;
  if (candidates.length === 1) return candidates[0]!;

  throw new ValidationError(
    `That archive has ${candidates.length} markdown files and no ${PREFERRED_ENTRY}. ` +
      `Repackage it with one, or import the file directly. Found: ${candidates
        .map((c) => c.path)
        .join(', ')}`,
  );
}

// ---- shared ----------------------------------------------------------------

interface ToPreviewInput {
  filename: string;
  kind: 'markdown' | 'archive';
  bytes: number;
  entryPath: string | null;
  raw: string;
  ignored: { path: string; reason: string }[];
  fallbackName: string;
}

function toPreview(input: ToPreviewInput): SkillImportPreview {
  const { body, frontmatter } = splitFrontmatter(input.raw);
  if (body.trim().length === 0) {
    throw new ValidationError('That file has no skill body — only frontmatter or whitespace.');
  }

  const used: string[] = [];
  const dropped: string[] = [];
  for (const key of Object.keys(frontmatter)) {
    if ((FRONTMATTER_ALLOWLIST as readonly string[]).includes(key)) used.push(key);
    else dropped.push(key);
  }

  const warnings: string[] = [];
  const name = resolveName(frontmatter.name, input.fallbackName, warnings);
  const type = resolveType(frontmatter.type, warnings);
  const description =
    frontmatter.description?.trim() || firstSentence(body) || `Imported from ${input.filename}`;

  return {
    name,
    description,
    type,
    body,
    source: 'imported_file',
    origin: { filename: input.filename, kind: input.kind, bytes: input.bytes },
    entry_path: input.entryPath,
    ignored: input.ignored,
    frontmatter: { used, dropped },
    warnings,
  };
}

/**
 * Frontmatter as a flat `key: value` map — deliberately NOT a YAML parser.
 * We honour three scalar keys; anything structured is something we would not
 * store anyway, and a real YAML parser is a much larger attack surface for a
 * feature whose entire premise is that foreign files get minimal handling.
 */
export function splitFrontmatter(raw: string): {
  body: string;
  frontmatter: Record<string, string>;
} {
  // Escaped, not a literal BOM: an invisible character in a regex is unreadable
  // in review and trips no-irregular-whitespace.
  const text = raw.replace(/^\uFEFF/, '');
  if (!/^---\r?\n/.test(text)) return { body: text.trim(), frontmatter: {} };

  const end = text.indexOf('\n---', 4);
  if (end === -1) return { body: text.trim(), frontmatter: {} };

  const block = text.slice(4, end);
  const rest = text.slice(text.indexOf('\n', end + 1) + 1);

  const frontmatter: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    frontmatter[m[1]!] = stripQuotes(m[2]!.trim());
  }
  return { body: rest.trim(), frontmatter };
}

/**
 * Frontmatter `name:` first, the filename second.
 *
 * The two outcomes get DIFFERENT warnings on purpose. Saying a frontmatter name
 * "was normalised to <filename slug>" when it was actually rejected points the
 * reader at the wrong string — they go and fix a `name:` that was never the
 * source of the value they are looking at.
 */
function resolveName(
  candidate: string | undefined,
  fallback: string,
  warnings: string[],
): string {
  const usable = (slug: string) =>
    SKILL_NAME_PATTERN.test(slug) && slug.length >= 2 && slug.length <= 64;

  if (candidate !== undefined) {
    const slug = slugify(candidate);
    if (usable(slug)) {
      if (slug !== candidate) warnings.push(`Name "${candidate}" was normalised to "${slug}".`);
      return slug;
    }
  }

  const fromFile = slugify(fallback);
  if (usable(fromFile)) {
    if (candidate !== undefined) {
      warnings.push(
        `Frontmatter name "${candidate}" is not a usable skill name — using "${fromFile}", from the filename.`,
      );
    }
    return fromFile;
  }

  throw new ValidationError(
    'Could not derive a skill name from that file. Add a `name:` to its frontmatter, or rename the file.',
  );
}

function resolveType(candidate: string | undefined, warnings: string[]): SkillType {
  if (candidate === undefined) return DEFAULT_SKILL_TYPE;
  const parsed = SkillTypeSchema.safeParse(candidate.trim().toLowerCase());
  if (parsed.success) return parsed.data;
  warnings.push(`Unknown type "${candidate}" — imported as "${DEFAULT_SKILL_TYPE}".`);
  return DEFAULT_SKILL_TYPE;
}

/** First sentence of the first non-heading line — a usable default description. */
function firstSentence(body: string): string {
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('```'));
  if (!line) return '';
  const stop = line.indexOf('. ');
  return (stop === -1 ? line : line.slice(0, stop + 1)).slice(0, 200);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function detectKind(filename: string): 'markdown' | 'archive' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.zip')) return 'archive';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  throw new ValidationError('Only .md and .zip files can be imported as skills.');
}

/** Absolute, drive-qualified, or containing a `..` segment. */
function isUnsafePath(path: string): boolean {
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return true;
  return path.split(/[/\\]/).includes('..');
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function depth(path: string): number {
  return path.split('/').length;
}

function stripQuotes(value: string): string {
  const m = /^(['"])(.*)\1$/.exec(value);
  return m ? m[2]! : value;
}
