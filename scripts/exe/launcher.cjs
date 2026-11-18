"use strict";

/**
 * n-dx standalone executable — the Node SEA entry point.
 *
 * `scripts/build-exe.mjs` injects this file, a manifest and a compressed copy
 * of a production install into a Node binary (Node's Single Executable
 * Application support). The result is one file, `ndx` / `ndx.exe`, that needs
 * no Node.js and no npm on the machine it runs on.
 *
 * ## Why the binary unpacks a runtime instead of running from memory
 *
 * n-dx is many programs, not one: the orchestrator spawns rex, sourcevision,
 * hench and the web server as `process.execPath <script.js> ...args`, and
 * those spawn further children the same way. A SEA can only run its one
 * embedded script, so the install is unpacked once per version into a cache
 * directory and run from there, unchanged, exactly as an npm install would.
 *
 * ## Why this binary also behaves like `node`
 *
 * Inside the executable `process.execPath` is the executable itself, so every
 * `spawn(process.execPath, [script, ...args])` in n-dx comes back here. When
 * the first argument is an existing `.js` / `.mjs` / `.cjs` file, the binary
 * runs that script as `node` would. Anything else is an n-dx command. n-dx
 * never passes Node flags to its own children, so plain `<script> args` is
 * the whole contract.
 *
 * ## Payload format (written by scripts/build-exe.mjs)
 *
 * Asset `manifest.json`: `{ name, version, hash, node, entries }`, where
 * `hash` is the sha256 of the `payload.br` asset and `entries` maps a command
 * name to its script, relative to the runtime root.
 *
 * Asset `payload.br`: brotli of `u32le indexLength | index JSON | file bytes`,
 * where the index is `{ files: [[relPath, size, executable], ...] }` and the
 * file bytes follow in index order.
 *
 * Builtins only: a SEA's embedded script cannot `require` from disk.
 */

const sea = require("node:sea");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const zlib = require("node:zlib");

const COMPLETE_MARKER = ".ndx-runtime-complete";
const SCRIPT_EXTENSION = /\.(c|m)?js$/i;

/** Executable basenames that run a single tool, busybox-style. */
const TOOL_ALIASES = { rex: "rex", hench: "hench", sourcevision: "sourcevision", sv: "sourcevision" };

function fail(message) {
  process.stderr.write(`n-dx: ${message}\n`);
  process.exit(1);
}

function readManifest() {
  try {
    return JSON.parse(sea.getAsset("manifest.json", "utf8"));
  } catch (err) {
    fail(`this executable is damaged: its manifest cannot be read (${err.message})`);
  }
}

/** Where unpacked runtimes live. `NDX_EXE_CACHE` overrides the OS default. */
function cacheRoot() {
  if (process.env.NDX_EXE_CACHE) return path.resolve(process.env.NDX_EXE_CACHE);
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "n-dx", "runtime");
  }
  if (process.platform === "darwin") return path.join(home, "Library", "Caches", "n-dx", "runtime");
  return path.join(process.env.XDG_CACHE_HOME || path.join(home, ".cache"), "n-dx", "runtime");
}

function unpack(payload, targetDir) {
  const data = zlib.brotliDecompressSync(payload);
  const indexLength = data.readUInt32LE(0);
  const index = JSON.parse(data.subarray(4, 4 + indexLength).toString("utf8"));
  let offset = 4 + indexLength;
  const made = new Set();
  for (const [relPath, size, executable] of index.files) {
    const target = path.join(targetDir, relPath);
    // The payload is ours, but a path that escapes the runtime is refused
    // rather than trusted.
    if (path.relative(targetDir, target).startsWith("..")) {
      throw new Error(`payload entry escapes the runtime directory: ${relPath}`);
    }
    const dir = path.dirname(target);
    if (!made.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      made.add(dir);
    }
    fs.writeFileSync(target, data.subarray(offset, offset + size), { mode: executable ? 0o755 : 0o644 });
    offset += size;
  }
  if (offset !== data.length) throw new Error("payload is truncated or has trailing bytes");
}

/**
 * Unpack the runtime on first use of this build. Unpacking goes to a sibling
 * directory that is renamed into place, so a concurrent first run, or one
 * interrupted part-way, never leaves a half-written runtime that looks done.
 */
function ensureRuntime(manifest) {
  const root = cacheRoot();
  const runtimeDir = path.join(root, `${manifest.version}-${manifest.hash.slice(0, 16)}`);
  if (fs.existsSync(path.join(runtimeDir, COMPLETE_MARKER))) return runtimeDir;

  const payload = Buffer.from(sea.getRawAsset("payload.br"));
  const actual = createHash("sha256").update(payload).digest("hex");
  if (actual !== manifest.hash) fail("this executable is damaged: its payload checksum does not match");

  if (process.stderr.isTTY) process.stderr.write(`n-dx: unpacking runtime ${manifest.version} to ${runtimeDir} (first run only)\n`);
  fs.mkdirSync(root, { recursive: true });
  const staging = `${runtimeDir}.partial-${process.pid}-${Date.now().toString(36)}`;
  try {
    unpack(payload, staging);
    fs.writeFileSync(path.join(staging, COMPLETE_MARKER), `${manifest.hash}\n`);
    try {
      fs.renameSync(staging, runtimeDir);
    } catch (err) {
      if (fs.existsSync(path.join(runtimeDir, COMPLETE_MARKER))) {
        // Another process finished first; its copy is identical.
        fs.rmSync(staging, { recursive: true, force: true });
      } else {
        // A directory without the marker is an interrupted or tampered unpack.
        fs.rmSync(runtimeDir, { recursive: true, force: true });
        fs.renameSync(staging, runtimeDir);
      }
    }
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    fail(`could not unpack the runtime into ${root} (${err.code || err.message}) — make it writable, or set NDX_EXE_CACHE to a directory that is`);
  }
  return runtimeDir;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function main() {
  const manifest = readManifest();
  const args = process.argv.slice(2);

  if (args[0] === "--standalone-info") {
    const info = { version: manifest.version, node: process.version, hash: manifest.hash, executable: process.execPath, runtime: ensureRuntime(manifest) };
    process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
    return;
  }

  const runtimeDir = ensureRuntime(manifest);
  let entry;
  let rest;
  if (args.length > 0 && SCRIPT_EXTENSION.test(args[0]) && isFile(path.resolve(args[0]))) {
    // Node mode: n-dx spawning one of its own scripts through process.execPath.
    entry = path.resolve(args[0]);
    rest = args.slice(1);
  } else {
    const invokedAs = path.basename(process.execPath).replace(/\.exe$/i, "").toLowerCase();
    entry = path.join(runtimeDir, manifest.entries[TOOL_ALIASES[invokedAs] || "ndx"]);
    rest = args;
  }

  // Read by @n-dx/core to report the install kind and the right upgrade path.
  process.env.NDX_STANDALONE_ROOT = runtimeDir;
  process.env.NDX_STANDALONE_EXE = process.execPath;
  process.argv = [process.execPath, entry, ...rest];

  import(pathToFileURL(entry).href).catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

// Outside the executable the file is a module, so tests can unpack what
// scripts/build-exe.mjs packs.
if (sea.isSea()) main();
else module.exports = { unpack };
