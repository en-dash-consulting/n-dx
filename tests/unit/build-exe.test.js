/**
 * Unit tests for the standalone executable build (scripts/build-exe.mjs) and
 * the payload half of its launcher (scripts/exe/launcher.cjs).
 *
 * Building a real executable takes a pnpm deploy and a ~100 MB Node binary,
 * so these cover the parts that can go wrong quietly: what is left out of the
 * payload, the pack/unpack round trip, and reading Node's release tarballs.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFromTar, isPrunable, packFiles, parseTargets, hostTarget, TARGETS } from "../../scripts/build-exe.mjs";

const { unpack } = createRequire(import.meta.url)("../../scripts/exe/launcher.cjs");

describe("isPrunable", () => {
  it("drops source maps and third-party declarations and Markdown", () => {
    expect(isPrunable("node_modules/zod/index.js.map")).toBe(true);
    expect(isPrunable("node_modules/zod/index.d.ts")).toBe(true);
    expect(isPrunable("node_modules/zod/index.d.cts")).toBe(true);
    expect(isPrunable("node_modules/zod/README.md")).toBe(true);
  });

  it("keeps what runs, including n-dx's own Markdown", () => {
    expect(isPrunable("node_modules/zod/index.js")).toBe(false);
    expect(isPrunable("node_modules/@n-dx/core/assistant-assets/project-guidance.md")).toBe(false);
    expect(isPrunable("node_modules/@n-dx/core/cli.js")).toBe(false);
  });

  it("keeps TypeScript's lib declarations, which the compiler API loads", () => {
    expect(isPrunable("node_modules/typescript/lib/lib.es2022.d.ts")).toBe(false);
  });
});

describe("packFiles → launcher unpack", () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("round-trips nested files byte for byte", () => {
    dir = mkdtempSync(join(tmpdir(), "ndx-exe-"));
    const files = [
      { rel: "node_modules/@n-dx/core/cli.js", data: Buffer.from("#!/usr/bin/env node\nconsole.log(1);\n") },
      { rel: "node_modules/zod/index.js", data: Buffer.from("export {};\n") },
      { rel: "empty.txt", data: Buffer.alloc(0) },
    ];
    unpack(packFiles(files), dir);
    for (const { rel, data } of files) {
      expect(readFileSync(join(dir, rel)).equals(data)).toBe(true);
    }
    if (process.platform !== "win32") {
      // A shebang marks a file executable.
      expect(statSync(join(dir, "node_modules/@n-dx/core/cli.js")).mode & 0o111).not.toBe(0);
    }
  });

  it("refuses an entry that escapes the target directory", () => {
    dir = mkdtempSync(join(tmpdir(), "ndx-exe-"));
    const payload = packFiles([{ rel: "../escape.js", data: Buffer.from("x") }]);
    expect(() => unpack(payload, join(dir, "rt"))).toThrow(/escapes/);
  });
});

/** A one-entry ustar archive. */
function tarWith(name, body, { prefix = "" } = {}) {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(body.length.toString(8).padStart(11, "0"), 124, "utf8");
  header.write("0", 156, "utf8");
  header.write("ustar", 257, "utf8");
  if (prefix) header.write(prefix, 345, "utf8");
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

/** A pax extended header naming the entry that follows. */
function paxPath(path) {
  const record = (() => {
    const tail = ` path=${path}\n`;
    let len = tail.length + 2;
    while (`${len}${tail}`.length !== len) len += 1;
    return `${len}${tail}`;
  })();
  const header = Buffer.alloc(512);
  header.write("PaxHeader", 0, "utf8");
  header.write(record.length.toString(8).padStart(11, "0"), 124, "utf8");
  header.write("x", 156, "utf8");
  const body = Buffer.alloc(Math.ceil(record.length / 512) * 512);
  body.write(record, 0, "utf8");
  return Buffer.concat([header, body]);
}

describe("extractFromTar", () => {
  it("finds the node binary by suffix", () => {
    const tar = tarWith("node-v24.0.0-linux-x64/bin/node", Buffer.from("ELF"));
    expect(extractFromTar(tar, "/bin/node").toString()).toBe("ELF");
  });

  it("joins the ustar prefix to the name", () => {
    const tar = tarWith("bin/node", Buffer.from("MACHO"), { prefix: "node-v24.0.0-darwin-arm64" });
    expect(extractFromTar(tar, "/bin/node").toString()).toBe("MACHO");
  });

  it("takes the name from a pax header", () => {
    const tar = Buffer.concat([paxPath("node-v24.0.0-linux-arm64/bin/node"), tarWith("truncated-name", Buffer.from("ARM"))]);
    expect(extractFromTar(tar, "/bin/node").toString()).toBe("ARM");
  });

  it("reports a missing entry", () => {
    const tar = tarWith("node-v24.0.0-linux-x64/README.md", Buffer.from("hi"));
    expect(() => extractFromTar(tar, "/bin/node")).toThrow(/not found/);
  });
});

describe("parseTargets", () => {
  it("defaults to this machine", () => {
    expect(parseTargets([])).toEqual([hostTarget()]);
  });

  it("accepts a list and 'all'", () => {
    expect(parseTargets(["--target=linux-x64,darwin-arm64"])).toEqual(["linux-x64", "darwin-arm64"]);
    expect(parseTargets(["--target=all"])).toEqual(TARGETS);
  });

  it("rejects an unknown target", () => {
    expect(() => parseTargets(["--target=freebsd-x64"])).toThrow(/unknown target/);
  });
});
