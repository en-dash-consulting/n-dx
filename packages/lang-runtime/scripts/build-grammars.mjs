#!/usr/bin/env node
/**
 * Build tree-sitter grammars to WASM from pinned releases.
 *
 *   node packages/lang-runtime/scripts/build-grammars.mjs [--out <dir>] [<name>...]
 *
 * Writes `<name>.wasm` for each named grammar (every one in {@link GRAMMARS}
 * when none is named) into `--out`, which defaults to
 * {@link GRAMMAR_BUILD_DIR}. Both `build/` directories are gitignored: no
 * `.wasm` file is ever committed.
 *
 * Every download is pinned here and only here — the grammar source archive and
 * the tree-sitter CLI binary for each platform — and each is checked against
 * its SHA-256 before use. The CLI is the prebuilt release binary, not an npm
 * package: the `tree-sitter-cli` package fetches the same binary without
 * verifying it, and the `tree-sitter-java` package ships a node-gyp native
 * binding, which n-dx does not use.
 *
 * `tree-sitter build --wasm` (CLI >= 0.26) downloads its own wasi-sdk
 * toolchain into the user cache on first use, so no Docker, emscripten or
 * native compiler is needed on the developer machine.
 *
 * A grammar whose tag omits `src/parser.c` is generated first with
 * `tree-sitter generate`, which evaluates the pinned `grammar.js`.
 *
 * Re-running is cheap: verified downloads are cached under this package's
 * `build/cache/`, and grammar sources are extracted under its `build/src/`.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_ROOT = join(PACKAGE_ROOT, "build");

/**
 * Where built grammars land when no `--out` is given: sourcevision's
 * `build/grammars`, where its SQL and Terraform readers read them until those
 * move into their packs. The Java and Go packs build into their own
 * `build/grammars` with `--out` (their `build:grammars` scripts).
 */
export const GRAMMAR_BUILD_DIR = resolve(PACKAGE_ROOT, "..", "sourcevision", "build", "grammars");
const CACHE_DIR = join(BUILD_ROOT, "cache");

/** tree-sitter CLI release that compiles grammars. Keep in step with `web-tree-sitter` in package.json. */
export const TREE_SITTER_CLI = {
  version: "0.27.0",
  /** SHA-256 of `tree-sitter-<platform>-<arch>.gz` from the GitHub release. */
  sha256: {
    "linux-arm": "d8823612567ca0ad0641ef53eb7a0662850d409285a1bc10f1dbc284a09c0225",
    "linux-arm64": "3a35a2dd961ad842384e982c75daf792c01d1a67e442fc3914d4de37bd8a59cb",
    "linux-x64": "20a1f39ec1c45f2211492dcb8881c802b643b554bb196869a29ac3778277fa77",
    "linux-x86": "f3fb3c74d31271032ff67474cc48c1969fba9fe748d4d0498ab2dd670e9e6794",
    "macos-arm64": "70f7573b2b2e5371a5b58cc5227d2ad981fd5374596b9874e770af486060774e",
    "macos-x64": "767528eaab3cca9d929fb96b4cb11cc9f03e09e293675151875c0fe5f79c06f0",
    "windows-arm64": "b53d97b1291a30236a25f7298d4b4b14ada8558099461e3769cf0fca6db6fdec",
    "windows-x64": "2d6c014b4e91d3d302ba7b30b3b625914027c3861ae7817e068a273e3f034550",
    "windows-x86": "daf34b1c63080dd76453b4911d62052dd90bce4faeccebe0a4ecf855d3ca7b7a",
  },
};

/** Grammars to build, keyed by output name. `sha256` covers the tag's source archive. */
export const GRAMMARS = {
  "tree-sitter-java": {
    repo: "tree-sitter/tree-sitter-java",
    version: "0.23.5",
    sha256: "cb199e0faae4b2c08425f88cbb51c1a9319612e7b96315a174a624db9bf3d9f0",
  },
  "tree-sitter-go": {
    repo: "tree-sitter/tree-sitter-go",
    version: "0.25.0",
    sha256: "2dc241b97872c53195e01b86542b411a3c1a6201d9c946c78d5c60c063bba1ef",
  },
  "tree-sitter-hcl": {
    repo: "tree-sitter-grammars/tree-sitter-hcl",
    version: "1.2.0",
    sha256: "a95bc6b00271e08dee9e63b895b2563dac802db0015fdf5a24a1b0244f2cb560",
  },
  "tree-sitter-sql": {
    repo: "DerekStride/tree-sitter-sql",
    version: "0.3.11",
    sha256: "1fe13cb1e50dd9da9f22aed3cb9430fc9dae05a734a6049926fc12f6d8ecd3ae",
  },
};

/** Absolute path of a built grammar in `outDir`, whether or not it exists yet. */
export function grammarWasmPath(name, outDir = GRAMMAR_BUILD_DIR) {
  return join(outDir, `${name}.wasm`);
}

const PLATFORMS = { darwin: "macos", linux: "linux", win32: "windows" };
const ARCHES = { arm64: "arm64", arm: "arm", x64: "x64", ia32: "x86" };

function cliAssetKey() {
  const key = `${PLATFORMS[process.platform]}-${ARCHES[process.arch]}`;
  if (!TREE_SITTER_CLI.sha256[key]) {
    throw new Error(`No pinned tree-sitter CLI for ${process.platform}/${process.arch}`);
  }
  return key;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Download `url` once into the cache, refusing bytes whose SHA-256 differs from `expected`. */
async function fetchVerified(url, expected, cacheName) {
  const cached = join(CACHE_DIR, cacheName);
  if (existsSync(cached)) {
    const bytes = readFileSync(cached);
    if (sha256(bytes) === expected) return bytes;
    rmSync(cached);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${url}\n  expected ${expected}\n  actual   ${actual}`);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, bytes);
  return bytes;
}

async function installCli() {
  const key = cliAssetKey();
  const { version } = TREE_SITTER_CLI;
  const exe = join(CACHE_DIR, `tree-sitter-${version}-${key}${process.platform === "win32" ? ".exe" : ""}`);
  const gz = await fetchVerified(
    `https://github.com/tree-sitter/tree-sitter/releases/download/v${version}/tree-sitter-${key}.gz`,
    TREE_SITTER_CLI.sha256[key],
    `tree-sitter-${version}-${key}.gz`,
  );
  writeFileSync(exe, gunzipSync(gz));
  chmodSync(exe, 0o755);
  return exe;
}

/**
 * Extract a gzipped tar into `dest`, dropping the archive's top-level folder.
 * Handles the ustar, pax (`x`/`g`) and GNU long-name (`L`) records GitHub
 * archives use; links and devices are skipped since grammar sources have none.
 */
export function extractTarGz(gz, dest) {
  const tar = gunzipSync(gz);
  const root = resolve(dest);
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, length) => header.toString("utf8", start, start + length).replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "x") {
      const path = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      if (path) longName = path[1];
      continue;
    }
    if (type === "L") {
      longName = body.toString("utf8").replace(/\0.*$/s, "");
      continue;
    }
    if (type === "g") continue;

    const prefix = field(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    const relative = name.split("/").slice(1).join("/");
    if (!relative) continue;
    const target = resolve(root, relative);
    if (!target.startsWith(root + sep)) throw new Error(`Archive entry escapes ${dest}: ${name}`);
    if (type === "5") mkdirSync(target, { recursive: true });
    else if (type === "0") {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
  }
}

async function buildGrammar(cli, name, { repo, version, sha256: expected }, outDir) {
  const archive = await fetchVerified(
    `https://github.com/${repo}/archive/refs/tags/v${version}.tar.gz`,
    expected,
    `${name}-${version}.tar.gz`,
  );
  const source = join(BUILD_ROOT, "src", `${name}-${version}`);
  rmSync(source, { recursive: true, force: true });
  extractTarGz(archive, source);

  // Some grammars (tree-sitter-sql) keep the generated parser out of their tags.
  if (!existsSync(join(source, "src", "parser.c"))) {
    const generated = spawnSync(cli, ["generate"], { cwd: source, stdio: "inherit" });
    if (generated.error) throw generated.error;
    if (generated.status !== 0) throw new Error(`tree-sitter generate failed for ${name} (exit ${generated.status})`);
  }

  mkdirSync(outDir, { recursive: true });
  const output = grammarWasmPath(name, outDir);
  const result = spawnSync(cli, ["build", "--wasm", "--output", output, source], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tree-sitter build --wasm failed for ${name} (exit ${result.status})`);
  console.log(`built ${output}`);
}

/**
 * The build a command line asks for: `--out <dir>` (resolved against the
 * working directory; default {@link GRAMMAR_BUILD_DIR}) and the grammar names
 * to build (default every one). Throws on an unknown name.
 */
export function parseBuildArgs(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { out: { type: "string" } }, allowPositionals: true });
  const unknown = positionals.filter((name) => !Object.hasOwn(GRAMMARS, name));
  if (unknown.length > 0) {
    throw new Error(`Unknown grammar ${unknown.join(", ")}; known: ${Object.keys(GRAMMARS).join(", ")}`);
  }
  return {
    outDir: values.out === undefined ? GRAMMAR_BUILD_DIR : resolve(values.out),
    names: positionals.length > 0 ? positionals : Object.keys(GRAMMARS),
  };
}

async function main() {
  const { outDir, names } = parseBuildArgs(process.argv.slice(2));
  const cli = await installCli();
  for (const name of names) {
    await buildGrammar(cli, name, GRAMMARS[name], outDir);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
