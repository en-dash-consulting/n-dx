#!/usr/bin/env node
/**
 * Build n-dx as a standalone executable for Windows, macOS and Linux.
 *
 *   node scripts/build-exe.mjs                      # this machine's platform
 *   node scripts/build-exe.mjs --target=linux-x64,darwin-arm64,win-x64
 *   node scripts/build-exe.mjs --target=all --skip-build
 *
 * Output: `dist-exe/<target>/ndx` (`ndx.exe` on Windows). Copy or rename it to
 * `rex`, `hench`, `sourcevision` or `sv` and it runs that tool directly.
 *
 * How it works (see scripts/exe/launcher.cjs for the runtime half):
 *
 *  1. `pnpm build`, then `pnpm deploy --prod` of @n-dx/core: the same files an
 *     npm install of @n-dx/core would contain.
 *  2. Lay them out as an npm install (`node_modules/@n-dx/core` beside its
 *     hoisted dependencies), drop files nothing runs (source maps, type
 *     declarations, third-party Markdown), and pack them into one
 *     brotli-compressed payload.
 *  3. Build a Node SEA blob from the launcher, the payload and a manifest, and
 *     inject it into a Node binary for each target. The blob is portable, but
 *     it must be injected into the same Node version that made it, so other
 *     targets' binaries are downloaded from nodejs.org at this Node's version
 *     and checked against its SHASUMS256.txt.
 *
 * macOS: a binary must be signed to run on Apple silicon. On a Mac this script
 * signs it ad hoc (`codesign --sign -`); built elsewhere, sign it on a Mac
 * before running or shipping it. Windows: postject invalidates node.exe's
 * Authenticode signature (the build prints a warning); sign with your own
 * certificate to ship.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { execFileSyncCli } from "../packages/core/win-spawn.js";
import { invokedDirectly } from "./lib/invoked-directly.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = join(ROOT, ".sea-build");
const OUT = join(ROOT, "dist-exe");
const LAUNCHER = join(ROOT, "scripts", "exe", "launcher.cjs");
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/** Targets nodejs.org publishes a plain binary for, named `<platform>-<arch>`. */
export const TARGETS = ["win-x64", "win-arm64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];

/** Scripts the launcher runs, by command name, relative to the runtime root. */
const ENTRIES = {
  ndx: "node_modules/@n-dx/core/cli.js",
  rex: "node_modules/@n-dx/core/bin/rex.js",
  hench: "node_modules/@n-dx/core/bin/hench.js",
  sourcevision: "node_modules/@n-dx/core/bin/sourcevision.js",
};

export function hostTarget() {
  const platform = process.platform === "win32" ? "win" : process.platform;
  return `${platform}-${process.arch}`;
}

function log(message) {
  process.stdout.write(`build-exe: ${message}\n`);
}

function run(cmd, args, opts = {}) {
  execFileSyncCli(cmd, args, { cwd: ROOT, stdio: "inherit", windowsHide: true, ...opts });
}

// ── Stage the install ────────────────────────────────────────────────────────

/**
 * Should a staged file be left out of the payload? Only files no runtime path
 * reads: source maps, type declarations (except TypeScript's own lib files,
 * which the compiler API loads) and third-party Markdown. n-dx's own Markdown
 * stays — assistant-assets are Markdown read at run time.
 *
 * @param {string} rel  Path relative to the runtime root, `/`-separated.
 */
export function isPrunable(rel) {
  if (rel.endsWith(".map")) return true;
  if (/\.d\.[cm]?ts$/.test(rel)) return !rel.startsWith("node_modules/typescript/lib/");
  const ours = rel.startsWith("node_modules/@n-dx/");
  if (!ours && /\.(md|markdown)$/i.test(rel)) return true;
  return false;
}

function stageInstall() {
  const deployDir = join(WORK, "deploy");
  const stageDir = join(WORK, "stage");
  rmSync(deployDir, { recursive: true, force: true });
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  log("deploying @n-dx/core with production dependencies");
  // Injected workspace packages let deploy install from pnpm-lock.yaml (the
  // legacy deploy re-resolves every version). Hoisted, so the tree has no
  // symlinks to carry. Relative output path: pnpm mis-joins an absolute path
  // on another Windows drive.
  run("pnpm", [
    "--filter", "@n-dx/core", "deploy", "--prod",
    "--config.inject-workspace-packages=true",
    "--config.node-linker=hoisted",
    relative(ROOT, deployDir),
  ]);

  // An npm install's layout: core in node_modules/@n-dx/core, its
  // dependencies hoisted beside it. Package-manager bookkeeping (.bin,
  // .pnpm, .modules.yaml) is dropped; nothing at run time reads it.
  const modules = join(stageDir, "node_modules");
  mkdirSync(join(modules, "@n-dx"), { recursive: true });
  for (const name of readdirSync(join(deployDir, "node_modules"))) {
    if (name.startsWith(".")) continue;
    if (name === "@n-dx") {
      for (const pkg of readdirSync(join(deployDir, "node_modules", "@n-dx"))) {
        renameSync(join(deployDir, "node_modules", "@n-dx", pkg), join(modules, "@n-dx", pkg));
      }
      continue;
    }
    renameSync(join(deployDir, "node_modules", name), join(modules, name));
  }
  rmSync(join(deployDir, "node_modules"), { recursive: true, force: true });
  renameSync(deployDir, join(modules, "@n-dx", "core"));

  for (const rel of Object.values(ENTRIES)) {
    if (!existsSync(join(stageDir, rel))) throw new Error(`staged install is missing ${rel}`);
  }
  ensureGrammars(modules);
  return stageDir;
}

/**
 * A language pack publishes its prebuilt tree-sitter grammars
 * (`build/grammars/*.wasm`), but the build directory is gitignored, so a fresh
 * checkout has none and the deploy copies none. Build each staged pack's
 * grammars that are missing (the build is pinned and cached; see
 * packages/lang-runtime/scripts/build-grammars.mjs) and copy them in.
 */
function ensureGrammars(modules) {
  const scope = join(modules, "@n-dx");
  for (const pkg of readdirSync(scope)) {
    const manifest = JSON.parse(readFileSync(join(scope, pkg, "package.json"), "utf8"));
    if (!(manifest.files ?? []).some((f) => f.startsWith("build/grammars"))) continue;
    const source = join(ROOT, "packages", pkg, "build", "grammars");
    const wasm = () => (existsSync(source) ? readdirSync(source).filter((f) => f.endsWith(".wasm")) : []);
    if (wasm().length === 0) {
      log(`building tree-sitter grammars for ${manifest.name}`);
      run("pnpm", ["--filter", manifest.name, "run", "build:grammars"]);
    }
    if (wasm().length === 0) throw new Error(`${manifest.name} built no grammars into ${relative(ROOT, source)}`);
    const target = join(scope, pkg, "build", "grammars");
    mkdirSync(target, { recursive: true });
    for (const file of wasm()) copyFileSync(join(source, file), join(target, file));
  }
}

function listFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join("/"));
    else throw new Error(`unsupported file type in staged install (symlink?): ${full}`);
  }
  return out;
}

/**
 * Pack files in the format scripts/exe/launcher.cjs unpacks: brotli of
 * `u32le indexLength | index JSON | file bytes`. A file that starts with a
 * shebang is marked executable.
 *
 * @param {{ rel: string, data: Buffer }[]} files  `rel` is `/`-separated.
 * @returns {Buffer}
 */
export function packFiles(files) {
  const index = files.map(({ rel, data }) => [rel, data.length, data[0] === 0x23 && data[1] === 0x21 ? 1 : 0]);
  const indexJson = Buffer.from(JSON.stringify({ files: index }), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(indexJson.length, 0);
  const total = files.reduce((n, f) => n + f.data.length, 0);
  return brotliCompressSync(Buffer.concat([header, indexJson, ...files.map((f) => f.data)]), {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
      [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: total,
    },
  });
}

function packPayload(stageDir) {
  const files = listFiles(stageDir)
    .filter((rel) => !isPrunable(rel))
    .sort()
    .map((rel) => ({ rel, data: readFileSync(join(stageDir, rel)) }));
  const total = files.reduce((n, f) => n + f.data.length, 0);
  log(`packing ${files.length} files (${(total / 1e6).toFixed(1)} MB)`);
  const payload = packFiles(files);
  log(`payload is ${(payload.length / 1e6).toFixed(1)} MB compressed`);
  return payload;
}

// ── SEA blob ─────────────────────────────────────────────────────────────────

function buildBlob(payload) {
  const seaDir = join(WORK, "sea");
  rmSync(seaDir, { recursive: true, force: true });
  mkdirSync(seaDir, { recursive: true });

  const version = JSON.parse(readFileSync(join(ROOT, "packages", "core", "package.json"), "utf8")).version;
  const manifest = {
    name: "@n-dx/core",
    version,
    hash: createHash("sha256").update(payload).digest("hex"),
    node: process.version,
    entries: ENTRIES,
  };
  writeFileSync(join(seaDir, "payload.br"), payload);
  writeFileSync(join(seaDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  copyFileSync(LAUNCHER, join(seaDir, "launcher.cjs"));
  writeFileSync(join(seaDir, "sea-config.json"), JSON.stringify({
    main: "launcher.cjs",
    output: "sea-prep.blob",
    disableExperimentalSEAWarning: true,
    // Both tie the blob to one platform; without them it injects into any target.
    useSnapshot: false,
    useCodeCache: false,
    assets: { "manifest.json": "manifest.json", "payload.br": "payload.br" },
  }, null, 2));
  run(process.execPath, ["--experimental-sea-config", "sea-config.json"], { cwd: seaDir });
  return { blob: readFileSync(join(seaDir, "sea-prep.blob")), manifest };
}

// ── Node binaries ────────────────────────────────────────────────────────────

/** Read one regular file out of a tar archive. Handles ustar, pax and GNU long names. */
export function extractFromTar(tar, wantedSuffix) {
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const prefix = field(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const body = tar.subarray(offset + 512, offset + 512 + size);
    longName = null;
    if (type === "L") longName = body.toString("utf8").replace(/\0.*$/s, "");
    else if (type === "x") {
      const match = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      if (match) longName = match[1];
    } else if ((type === "0" || type === "") && name.endsWith(wantedSuffix)) {
      return Buffer.from(body);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wantedSuffix} not found in archive`);
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** A Node binary for `target` at this Node's exact version. */
async function nodeBinaryFor(target) {
  if (target === hostTarget()) return readFileSync(process.execPath);

  const version = process.version;
  const cached = join(WORK, "node", version, target, target.startsWith("win") ? "node.exe" : "node");
  if (existsSync(cached)) return readFileSync(cached);

  const base = `https://nodejs.org/dist/${version}`;
  const file = target.startsWith("win") ? `${target}/node.exe` : `node-${version}-${target}.tar.gz`;
  log(`downloading Node ${version} for ${target}`);
  const sums = (await fetchBuffer(`${base}/SHASUMS256.txt`)).toString("utf8");
  const expected = sums.split("\n").map((l) => l.trim().split(/\s+/)).find(([, name]) => name === file)?.[0];
  if (!expected) throw new Error(`${file} is not listed in ${base}/SHASUMS256.txt`);
  const download = await fetchBuffer(`${base}/${file}`);
  const actual = createHash("sha256").update(download).digest("hex");
  if (actual !== expected) throw new Error(`checksum mismatch for ${file}: expected ${expected}, got ${actual}`);

  const binary = target.startsWith("win") ? download : extractFromTar(gunzipSync(download), "/bin/node");
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, binary);
  return binary;
}

// ── Assemble ─────────────────────────────────────────────────────────────────

async function buildTarget(target, blob) {
  const { inject } = (await import("postject")).default;
  const isMac = target.startsWith("darwin");
  const outDir = join(OUT, target);
  const outFile = join(outDir, target.startsWith("win") ? "ndx.exe" : "ndx");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, await nodeBinaryFor(target));
  chmodSync(outFile, 0o755);

  const signHere = isMac && process.platform === "darwin";
  if (signHere) run("codesign", ["--remove-signature", outFile]);
  await inject(outFile, "NODE_SEA_BLOB", blob, {
    sentinelFuse: SEA_FUSE,
    ...(isMac ? { machoSegmentName: "NODE_SEA" } : {}),
  });
  if (signHere) run("codesign", ["--sign", "-", outFile]);
  else if (isMac) log(`${target}: not signed — run \`codesign --sign - ndx\` on a Mac before using it`);

  log(`${target}: ${relative(ROOT, outFile)} (${(statSync(outFile).size / 1e6).toFixed(1)} MB)`);
}

export function parseTargets(argv) {
  const flag = argv.find((a) => a.startsWith("--target="));
  if (!flag) return [hostTarget()];
  const value = flag.slice("--target=".length);
  const targets = value === "all" ? TARGETS : value.split(",").map((t) => t.trim()).filter(Boolean);
  for (const t of targets) {
    if (!TARGETS.includes(t)) throw new Error(`unknown target "${t}" — expected one of: ${TARGETS.join(", ")}, all`);
  }
  return targets;
}

async function main(argv) {
  const targets = parseTargets(argv);
  if (!argv.includes("--skip-build")) {
    log("building workspace packages");
    run("pnpm", ["build"]);
  }
  const stageDir = stageInstall();
  const { blob, manifest } = buildBlob(packPayload(stageDir));
  for (const target of targets) await buildTarget(target, blob);
  log(`done — n-dx ${manifest.version} on Node ${manifest.node}`);
}

if (invokedDirectly(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`build-exe: ${err.message}\n`);
    process.exit(1);
  });
}
