/**
 * The gzipped tar format of an offline pack bundle (`sv pack bundle`), in Node
 * alone: no `tar` process, so no shell quoting, no GNU-vs-bsdtar differences
 * on Windows and no new dependency.
 *
 * It writes and reads only what a bundle holds: regular files and directories,
 * with a pax `path` record for a path longer than ustar's 100 bytes. Reading
 * refuses anything else (links, devices), a header whose checksum is wrong, a
 * truncated archive and any path that is absolute or climbs out with `..`, so
 * extracting an entry can only write inside the target directory.
 *
 * @module sourcevision/cli/commands/pack-archive
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/** One file or directory in an archive. `path` is relative, `/`-separated. */
export type ArchiveEntry =
  | { readonly type: "file"; readonly path: string; readonly mode: number; readonly data: Buffer }
  | { readonly type: "directory"; readonly path: string };

/** An archive that cannot be read; the message says why. */
export class ArchiveError extends Error {}

const BLOCK = 512;
const FILE_MODE = 0o644;
const EXEC_MODE = 0o755;
const DIR_MODE = 0o755;

/**
 * Every file and directory under `root`, sorted, with paths relative to it.
 * Symbolic links are followed. A `.bin` directory directly inside a
 * `node_modules` is left out: it holds only npm's command links, which a pack
 * never needs and which do not survive every platform.
 */
export function collectTree(root: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".bin" && rel.split("/").pop() === "node_modules") continue;
      const full = join(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        entries.push({ type: "directory", path });
        walk(full, path);
      } else if (stat.isFile()) {
        entries.push({ type: "file", path, mode: stat.mode & 0o111 ? EXEC_MODE : FILE_MODE, data: readFileSync(full) });
      }
    }
  };
  walk(root, "");
  return entries;
}

function writeString(header: Buffer, offset: number, length: number, value: string): void {
  header.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf-8");
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  writeString(header, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

function checksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  return sum;
}

function header(name: string, type: string, mode: number, size: number): Buffer {
  const block = Buffer.alloc(BLOCK);
  writeString(block, 0, 100, name);
  writeOctal(block, 100, 8, mode);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, 0);
  writeString(block, 156, 1, type);
  writeString(block, 257, 6, "ustar\0");
  writeString(block, 263, 2, "00");
  writeString(block, 148, 8, `${checksum(block).toString(8).padStart(6, "0")}\0 `);
  return block;
}

const padding = (size: number): Buffer => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/** A pax record, `<length> <key>=<value>\n`, where the length counts itself. */
function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body);
  while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
  return Buffer.from(`${length}${body}`, "utf-8");
}

/** `entries` as one gzipped tar. */
export function writeTarGz(entries: readonly ArchiveEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const name = entry.type === "directory" ? `${entry.path}/` : entry.path;
    if (Buffer.byteLength(name) > 100) {
      const pax = paxRecord("path", name);
      parts.push(header("PaxHeader", "x", FILE_MODE, pax.length), pax, padding(pax.length));
    }
    if (entry.type === "directory") {
      parts.push(header(name, "5", DIR_MODE, 0));
    } else {
      parts.push(header(name, "0", entry.mode, entry.data.length), entry.data, padding(entry.data.length));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts));
}

function readString(block: Buffer, offset: number, length: number): string {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? length : end).toString("utf-8");
}

function readOctal(block: Buffer, offset: number, length: number, at: number): number {
  const text = readString(block, offset, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new ArchiveError(`bad number in the header at byte ${at}`);
  return text ? parseInt(text, 8) : 0;
}

function parsePax(data: Buffer, at: number): Map<string, string> {
  const records = new Map<string, string>();
  let rest = data;
  while (rest.length > 0) {
    const space = rest.indexOf(0x20);
    const length = space > 0 ? Number(rest.subarray(0, space).toString()) : NaN;
    if (!Number.isInteger(length) || length <= space || length > rest.length) {
      throw new ArchiveError(`bad pax header at byte ${at}`);
    }
    const record = rest.subarray(space + 1, length - 1).toString("utf-8");
    const eq = record.indexOf("=");
    if (eq > 0) records.set(record.slice(0, eq), record.slice(eq + 1));
    rest = rest.subarray(length);
  }
  return records;
}

/** `path` made relative and `/`-separated, or an error when it is absolute or leaves the archive's root. */
function safePath(path: string): string {
  const trimmed = path.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (!trimmed || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new ArchiveError(`unsafe path ${JSON.stringify(path)}`);
  }
  if (trimmed.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new ArchiveError(`unsafe path ${JSON.stringify(path)}`);
  }
  return trimmed;
}

/** The entries of a gzipped tar. Throws {@link ArchiveError} for anything a bundle cannot hold. */
export function readTarGz(archive: Buffer): ArchiveEntry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive);
  } catch (error) {
    throw new ArchiveError(`not gzip data (${error instanceof Error ? error.message : String(error)})`);
  }
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  let longPath: string | undefined;
  for (;;) {
    if (offset + BLOCK > tar.length) throw new ArchiveError("truncated: it ends before the end-of-archive marker");
    const block = tar.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) return entries;
    if (readOctal(block, 148, 8, offset) !== checksum(block)) throw new ArchiveError(`bad header checksum at byte ${offset}`);
    const size = readOctal(block, 124, 12, offset);
    const type = String.fromCharCode(block[156]!);
    const dataStart = offset + BLOCK;
    if (dataStart + size > tar.length) throw new ArchiveError(`truncated inside the entry at byte ${offset}`);
    const data = tar.subarray(dataStart, dataStart + size);
    const prefix = readString(block, 345, 155);
    const name = longPath ?? (prefix ? `${prefix}/${readString(block, 0, 100)}` : readString(block, 0, 100));

    if (type === "x") {
      longPath = parsePax(data, offset).get("path") ?? longPath;
    } else if (type === "L") {
      longPath = readString(data, 0, data.length);
    } else if (type === "g") {
      // A global pax header: nothing a bundle relies on.
    } else {
      longPath = undefined;
      if (type === "0" || type === "\0") {
        const mode = readOctal(block, 100, 8, offset) & 0o111 ? EXEC_MODE : FILE_MODE;
        entries.push({ type: "file", path: safePath(name), mode, data: Buffer.from(data) });
      } else if (type === "5") {
        // `tar -C dir .` writes the root itself as `./`; it carries nothing.
        if (!/^(\.\/)*\.?$/.test(name)) entries.push({ type: "directory", path: safePath(name) });
      } else {
        throw new ArchiveError(`unsupported entry ${JSON.stringify(name)} (tar type ${JSON.stringify(type)})`);
      }
    }
    offset = dataStart + size + padding(size).length;
  }
}
