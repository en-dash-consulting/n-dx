#!/usr/bin/env node
/**
 * Build tree-sitter grammars to WASM from pinned releases.
 *
 *   node packages/lang-runtime/scripts/build-grammars.mjs --out <dir> [<name>...]
 *
 * Writes `<name>.wasm` for each named grammar (every one in {@link GRAMMARS}
 * when none is named) into `--out`, which is required: each grammar belongs
 * to exactly one language pack, and its `build:grammars` script names the
 * grammar and the pack's own `build/grammars`. Every `build/` directory is
 * gitignored: no `.wasm` file is ever committed.
 *
 * Every download is pinned here and only here — the grammar source archive,
 * the tree-sitter CLI binary, and the wasi-sdk (clang) and binaryen (wasm-opt)
 * archives `tree-sitter build --wasm` compiles with, per platform — and each
 * is checked against its SHA-256 before use. The CLI is the prebuilt release
 * binary, not an npm package: the `tree-sitter-cli` package fetches the same
 * binary without verifying it, and the `tree-sitter-java` package ships a
 * node-gyp native binding, which n-dx does not use.
 *
 * Left alone, the CLI downloads wasi-sdk and binaryen itself with `curl` into
 * the user cache and checks neither. This script fetches the versions the CLI
 * expects, verifies them, extracts them under `build/cache/`, and hands them
 * to the CLI through `TREE_SITTER_WASI_SDK_PATH` and
 * `TREE_SITTER_BINARYEN_PATH`, so the CLI downloads nothing. No Docker,
 * emscripten or native compiler is needed on the developer machine; `tar` is
 * (macOS, Linux and Windows 10+ ship one).
 *
 * A grammar whose tag omits `src/parser.c` is generated first with
 * `tree-sitter generate`, which evaluates the pinned `grammar.js`.
 *
 * Re-running is cheap: verified downloads are cached under this package's
 * `build/cache/`, and grammar sources are extracted under its `build/src/`.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_ROOT = join(PACKAGE_ROOT, "build");

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

/**
 * The toolchains `tree-sitter build --wasm` compiles with, at the versions the
 * pinned CLI expects (its `crates/loader/wasi-sdk-version` and
 * `binaryen-version`). `sha256` is keyed by the CLI's own platform name for
 * the archive (`ARCH_OS` in `crates/loader/src/loader.rs`) and covers the
 * `.tar.gz` that `url` names on the GitHub release.
 */
export const WASM_TOOLCHAIN = {
  "wasi-sdk": {
    version: "34.0",
    sha256: {
      "arm64-linux": "f7e243dff54d60bcc576e94d6166b69f410f2500ae4a9ceef34315be10e77971",
      "arm64-macos": "9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9",
      "arm64-windows": "45e1c71f3e965621e7b98ebe1d37b0e4b1f77f3e8072113ffb4534e67b1a4b7c",
      "x86_64-linux": "b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4",
      "x86_64-macos": "87d27fa8adc68dee59bfbf2e22a6d34ef717c34d6bf1d8af2a56fc929d9ce0eb",
      "x86_64-windows": "cccb5c323a9b34f0349a9b09e8804a0a7632c68c3310f4b5f437ed57d7e71d8f",
    },
    url: (version, platform) =>
      `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${version.split(".")[0]}/wasi-sdk-${version}-${platform}.tar.gz`,
  },
  binaryen: {
    version: "132",
    sha256: {
      "arm64-linux": "c58562417836c5d0493d89bdefc434933bdc097db641b483df86bcfa557a107f",
      "arm64-macos": "98aad827847af7ef990ed7098d885725c8e5b5aae75073403635617ae4e259aa",
      "arm64-windows": "1dd7dfac7d4a6021619e6f75dd8475e528d75928d3f0b084f4068fabac694442",
      "x86_64-linux": "195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572",
      "x86_64-macos": "40c3de90bb3766bd0282a895e139a6f50253dba49b4f5bb89e66faca162d832e",
      "x86_64-windows": "2089428ec98c899b45ee5d00636ddd6e2da8636cc473ef50b165cc25793ef7cb",
    },
    // binaryen names 64-bit ARM Linux `aarch64`; the CLI renames it the same way.
    url: (version, platform) =>
      `https://github.com/WebAssembly/binaryen/releases/download/version_${version}/binaryen-version_${version}-${platform.replace("arm64-linux", "aarch64-linux")}.tar.gz`,
  },
};

/**
 * The toolchain platform for each platform the CLI is pinned for, or `null`
 * where the CLI runs but cannot build WASM (it has no wasi-sdk there).
 */
export const TOOLCHAIN_PLATFORM = {
  "linux-arm": null,
  "linux-arm64": "arm64-linux",
  "linux-x64": "x86_64-linux",
  "linux-x86": null,
  "macos-arm64": "arm64-macos",
  "macos-x64": "x86_64-macos",
  "windows-arm64": "arm64-windows",
  "windows-x64": "x86_64-windows",
  "windows-x86": null,
};

/** The variable through which the CLI takes each toolchain instead of downloading it. */
const TOOLCHAIN_ENV = { "wasi-sdk": "TREE_SITTER_WASI_SDK_PATH", binaryen: "TREE_SITTER_BINARYEN_PATH" };

/**
 * `env` plus the variables that point the CLI at the extracted toolchains
 * (`dirs`, keyed like {@link WASM_TOOLCHAIN}). With them set, the CLI looks
 * only in `<dir>/bin` and fails rather than download when a tool is missing.
 */
export function toolchainEnv(dirs, env = process.env) {
  const result = { ...env };
  for (const [name, variable] of Object.entries(TOOLCHAIN_ENV)) {
    if (!dirs[name]) throw new Error(`No ${name} directory for ${variable}`);
    result[variable] = dirs[name];
  }
  return result;
}

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
  "tree-sitter-python": {
    repo: "tree-sitter/tree-sitter-python",
    version: "0.25.0",
    sha256: "4609a3665a620e117acf795ff01b9e965880f81745f287a16336f4ca86cf270c",
  },
  "tree-sitter-sql": {
    repo: "DerekStride/tree-sitter-sql",
    version: "0.3.11",
    sha256: "1fe13cb1e50dd9da9f22aed3cb9430fc9dae05a734a6049926fc12f6d8ecd3ae",
  },
};

/** Absolute path of a built grammar in `outDir`, whether or not it exists yet. */
export function grammarWasmPath(name, outDir) {
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
 * Fetch and verify one toolchain archive and extract it under the cache.
 * Returns the extracted directory, which holds `bin/`. It is extracted again
 * unless it records the verified archive's SHA-256. Extraction uses the system
 * `tar`, as the CLI does: the archives hold symlinks (`bin/clang`) and are too
 * large to unpack in memory.
 */
async function installToolchain(name, cliKey) {
  const platform = TOOLCHAIN_PLATFORM[cliKey];
  if (!platform) throw new Error(`tree-sitter cannot build WASM on ${process.platform}/${process.arch}: it has no wasi-sdk for it`);
  const { version, sha256: pins, url } = WASM_TOOLCHAIN[name];
  const expected = pins[platform];
  const base = `${name}-${version}-${platform}`;
  const archive = `${base}.tar.gz`;
  await fetchVerified(url(version, platform), expected, archive);

  const dir = join(CACHE_DIR, base);
  const marker = join(dir, ".n-dx-sha256");
  if (existsSync(marker) && readFileSync(marker, "utf8") === expected) return dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Paths relative to the cache: GNU tar on Windows reads `C:...` as a remote host.
  const extracted = spawnSync("tar", ["-xzf", archive, "--strip-components=1", "-C", base], { cwd: CACHE_DIR, stdio: "inherit" });
  if (extracted.error) throw extracted.error;
  if (extracted.status !== 0) throw new Error(`tar failed to extract ${archive} (exit ${extracted.status})`);
  writeFileSync(marker, expected);
  return dir;
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

async function buildGrammar(cli, env, name, { repo, version, sha256: expected }, outDir) {
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
    const generated = spawnSync(cli, ["generate"], { cwd: source, env, stdio: "inherit" });
    if (generated.error) throw generated.error;
    if (generated.status !== 0) throw new Error(`tree-sitter generate failed for ${name} (exit ${generated.status})`);
  }

  mkdirSync(outDir, { recursive: true });
  const output = grammarWasmPath(name, outDir);
  const result = spawnSync(cli, ["build", "--wasm", "--output", output, source], { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tree-sitter build --wasm failed for ${name} (exit ${result.status})`);
  console.log(`built ${output}`);
}

/**
 * The build a command line asks for: `--out <dir>` (required; resolved against
 * the working directory) and the grammar names to build (default every one).
 * Throws without `--out` and on an unknown name.
 */
export function parseBuildArgs(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { out: { type: "string" } }, allowPositionals: true });
  if (values.out === undefined) {
    throw new Error("--out <dir> is required: run `pnpm --filter <pack> build:grammars` to build a pack's grammar into its build/grammars");
  }
  const unknown = positionals.filter((name) => !Object.hasOwn(GRAMMARS, name));
  if (unknown.length > 0) {
    throw new Error(`Unknown grammar ${unknown.join(", ")}; known: ${Object.keys(GRAMMARS).join(", ")}`);
  }
  return {
    outDir: resolve(values.out),
    names: positionals.length > 0 ? positionals : Object.keys(GRAMMARS),
  };
}

async function main() {
  const { outDir, names } = parseBuildArgs(process.argv.slice(2));
  const cli = await installCli();
  const key = cliAssetKey();
  const env = toolchainEnv({
    "wasi-sdk": await installToolchain("wasi-sdk", key),
    binaryen: await installToolchain("binaryen", key),
  });
  for (const name of names) {
    await buildGrammar(cli, env, name, GRAMMARS[name], outDir);
  }
}

/**
 * Whether `scriptPath` (argv[1]) names the module at `moduleUrl`. Node runs
 * the main module from its real path, so argv[1] is resolved through symlinks
 * too (macOS /tmp, a symlinked workspace); otherwise the script exits 0 having
 * built nothing.
 */
export function isMainModule(scriptPath, moduleUrl) {
  if (!scriptPath || !existsSync(scriptPath)) return false;
  return pathToFileURL(realpathSync(scriptPath)).href === moduleUrl;
}

if (isMainModule(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
