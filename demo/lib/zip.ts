import { deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP writer, so the import fixture is BUILT here rather than checked in
 * as an opaque blob. The point of the import scene is that a person can read
 * exactly what the archive contained and compare it against the "ignored" list
 * the preview renders — a binary in git would defeat that.
 *
 * Mirrors `server/test/helpers/zip-fixture.ts`, minus the malformed-archive
 * knobs that only the refusal tests need. STORE/DEFLATE, no ZIP64.
 */

export interface ZipEntry {
  path: string;
  content: string;
}

export function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.path, "utf8");
    const raw = Buffer.from(e.content, "utf8");
    const payload = deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 14); // crc — the reader does not check it
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // deflate
    central.writeUInt32LE(0, 16); // crc
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + payload.length;
  }

  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);

  return Buffer.concat([localBuf, centralBuf, eocd]);
}
