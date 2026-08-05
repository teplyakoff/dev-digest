import { inflateRawSync } from 'node:zlib';

/**
 * A deliberately minimal ZIP reader: list the central directory, then
 * decompress EXACTLY ONE named entry.
 *
 * Why not a library. The product claim is "nothing executable is read" — not
 * "nothing executable is executed". A general-purpose unzip expands the whole
 * archive (to memory or to disk) and hands you a tree; at that point the claim
 * is about what we do with the bytes, which is a promise. Listing names from the
 * central directory and inflating one entry makes it a property of the code: the
 * other entries are never passed to the decompressor at all.
 *
 * It also keeps the caps ours. Entry count, per-entry size and total size are
 * checked against the directory BEFORE anything is inflated, so a zip bomb is
 * refused rather than survived.
 *
 * Scope: STORE (0) and DEFLATE (8), the only methods in practice. No ZIP64, no
 * encryption, no multi-disk — all rejected loudly.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN_SIZE = 22;
/** The EOCD is last, followed only by an optional ≤64 KB comment. */
const MAX_COMMENT = 0xffff;

export interface ZipEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  localHeaderOffset: number;
  /** Directory entries are listed but never candidates for the body. */
  isDirectory: boolean;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipLimits {
  maxEntries: number;
  maxEntrySize: number;
  maxTotalSize: number;
}

/**
 * Read the central directory. Nothing is decompressed here — this is the list
 * the import preview shows as "ignored", and it is built from metadata only.
 */
export function listEntries(buf: Buffer, limits: ZipLimits): ZipEntry[] {
  const eocd = findEocd(buf);
  const total = buf.readUInt16LE(eocd + 10);
  const size = buf.readUInt32LE(eocd + 12);
  const offset = buf.readUInt32LE(eocd + 16);

  if (total === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported');
  }
  if (total > limits.maxEntries) {
    throw new ZipError(`Archive has ${total} entries; the limit is ${limits.maxEntries}`);
  }
  if (offset + size > buf.length) throw new ZipError('Central directory is out of bounds');

  const entries: ZipEntry[] = [];
  let p = offset;
  let uncompressedTotal = 0;

  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new ZipError('Malformed central directory');
    }
    const flags = buf.readUInt16LE(p + 8);
    // Bit 0 = encrypted. We cannot read it and must not pretend the listing is
    // complete, so the whole archive is refused.
    if (flags & 0x1) throw new ZipError('Encrypted archives are not supported');

    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const path = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (uncompressedSize > limits.maxEntrySize) {
      throw new ZipError(
        `Entry "${path}" expands to ${uncompressedSize} bytes; the limit is ${limits.maxEntrySize}`,
      );
    }
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > limits.maxTotalSize) {
      throw new ZipError(
        `Archive expands to more than ${limits.maxTotalSize} bytes; refusing to read it`,
      );
    }

    entries.push({
      path,
      compressedSize,
      uncompressedSize,
      method,
      localHeaderOffset,
      isDirectory: path.endsWith('/'),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Inflate ONE entry. The only place in the importer where archive bytes are
 * decompressed, and it is reached once per import with a path the caller chose.
 */
export function readEntry(buf: Buffer, entry: ZipEntry): string {
  const p = entry.localHeaderOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOCAL_SIG) {
    throw new ZipError(`Malformed local header for "${entry.path}"`);
  }
  // Name and extra lengths are read from the LOCAL header — the extra field
  // legitimately differs from the central directory's, and using the wrong one
  // lands the read a few bytes into the payload.
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);

  // The NAME, however, must agree. The entry was chosen by its central-directory
  // path, and that path is what the preview reports as `entry_path`; if the local
  // header names something else, the body we are about to return did not come
  // from the file we told the user we opened. That claim is the whole point of
  // the field, so a mismatch refuses rather than silently reporting the wrong
  // provenance.
  const localName = buf.toString('utf8', p + 30, p + 30 + nameLen);
  if (localName !== entry.path) {
    throw new ZipError(
      `Entry "${entry.path}" disagrees with its local header, which names "${localName}".`,
    );
  }

  const start = p + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new ZipError(`Entry "${entry.path}" is truncated`);

  const raw = buf.subarray(start, end);
  let out: Buffer;
  if (entry.method === 0) {
    out = Buffer.from(raw);
  } else if (entry.method === 8) {
    try {
      // `maxOutputLength` is the bomb guard: an entry whose header under-declares
      // its expanded size trips it here. zlib signals that with a RangeError, so
      // it has to be translated — left raw it escapes as a 500 rather than the
      // 422 that a bad upload deserves.
      out = inflateRawSync(raw, { maxOutputLength: entry.uncompressedSize });
    } catch {
      throw new ZipError(
        `Entry "${entry.path}" could not be decompressed — it does not match its declared size ` +
          `of ${entry.uncompressedSize} bytes.`,
      );
    }
  } else {
    throw new ZipError(`Entry "${entry.path}" uses unsupported compression method ${entry.method}`);
  }

  // A header that under-declares its size is how a bomb gets past a size check
  // that trusted it. `maxOutputLength` already caps the inflate; this catches
  // the mismatch explicitly rather than silently accepting a short read.
  if (out.length !== entry.uncompressedSize) {
    throw new ZipError(`Entry "${entry.path}" does not match its declared size`);
  }
  return out.toString('utf8');
}

function findEocd(buf: Buffer): number {
  if (buf.length < EOCD_MIN_SIZE) throw new ZipError('File is too small to be a ZIP archive');
  const from = Math.max(0, buf.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError('Not a ZIP archive (no end-of-central-directory record)');
}
