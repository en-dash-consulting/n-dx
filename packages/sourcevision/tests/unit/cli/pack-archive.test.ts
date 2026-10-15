/** The Node-only tar of an offline pack bundle: round trips, long paths, and what reading refuses. */

import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { readTarGz, writeTarGz, type ArchiveEntry } from "../../../src/cli/commands/pack-archive.js";

const file = (path: string, text: string, mode = 0o644): ArchiveEntry => ({ type: "file", path, mode, data: Buffer.from(text) });

/** A one-entry ustar block for `name`, with a valid checksum, so a test can feed hostile headers. */
function rawTar(name: string, type = "0", body = ""): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, "utf-8");
  block.write("0000644\0", 100);
  block.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
  block.write(type, 156);
  block.write("ustar\0", 257);
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const data = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  data.write(body);
  return gzipSync(Buffer.concat([block, data, Buffer.alloc(1024)]));
}

describe("pack archive", () => {
  it("round-trips files, directories, modes and paths longer than 100 bytes", () => {
    const deep = `node_modules/${"a-long-directory-name/".repeat(8)}grammar.wasm`;
    const entries: ArchiveEntry[] = [
      { type: "directory", path: "node_modules" },
      file("node_modules/x/package.json", "{}"),
      file("node_modules/x/run.sh", "#!/bin/sh\n", 0o755),
      file(deep, "\0asm\x01"),
      file("with space/é.txt", "ünïcode"),
    ];
    expect(Buffer.byteLength(deep)).toBeGreaterThan(100);
    expect(readTarGz(writeTarGz(entries))).toEqual(entries);
  });

  it("refuses data that is not gzip, and a tar with no end-of-archive marker", () => {
    expect(() => readTarGz(Buffer.from("plain"))).toThrow(/not gzip data/);
    const tar = gunzipSync(writeTarGz([file("a", "b")]));
    expect(() => readTarGz(gzipSync(tar.subarray(0, 1024)))).toThrow(/truncated/);
  });

  it("refuses a header whose checksum is wrong", () => {
    const tar = gunzipSync(writeTarGz([file("a", "b")]));
    tar[0] = "z".charCodeAt(0);
    expect(() => readTarGz(gzipSync(tar))).toThrow(/bad header checksum at byte 0/);
  });

  it("refuses paths that are absolute or climb out, and entries that are not files or directories", () => {
    expect(() => readTarGz(rawTar("../escape"))).toThrow(/unsafe path "\.\.\/escape"/);
    expect(() => readTarGz(rawTar("a/../../b"))).toThrow(/unsafe path/);
    expect(() => readTarGz(rawTar("/etc/passwd"))).toThrow(/unsafe path/);
    expect(() => readTarGz(rawTar("C:/x"))).toThrow(/unsafe path/);
    expect(() => readTarGz(rawTar("link", "2"))).toThrow(/unsupported entry "link" \(tar type "2"\)/);
  });

  it("skips the root directory entry that `tar -C dir .` writes", () => {
    expect(readTarGz(rawTar("./", "5"))).toEqual([]);
    expect(readTarGz(rawTar("./a.txt", "0", "hi"))).toEqual([file("a.txt", "hi")]);
  });
});
