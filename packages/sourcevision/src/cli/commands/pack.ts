/**
 * `sv pack add|bundle|list|remove`: manage the language packs in the per-user
 * pack directory, `<ndx home>/packs/<sourcevision version>/`.
 *
 * `add` and `remove` run `npm install|uninstall --ignore-scripts --prefix <pack dir>`; the
 * loader (`src/language/pack-loader.ts`) then finds a pack there before module
 * resolution. A pack is always installed at sourcevision's own version, and
 * `add` loads it after installing, so a pack that is of another version or
 * will not load is an error rather than a silent success. `add` and `remove`
 * hold the pack directory's lock (`pack-lock.ts`) for their whole run.
 *
 * Offline: `bundle` installs a pack into a temporary prefix and archives it
 * with its dependencies and a manifest (`pack-archive.ts`, Node only, no `tar`
 * process), printing its SHA-256 and writing it to `<bundle>.sha256`;
 * `add --from <bundle> [--sha256 <hex>]` checks that hash before reading the
 * archive, then installs the pack and its dependency closure with no npm call.
 * A bundle is trusted like any npm tarball: its code runs when it loads.
 *
 * @module sourcevision/cli/commands/pack
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { CLI_ERROR_CODES, spawnCli } from "@n-dx/llm-client";
import { ArchiveError, MAX_BUNDLE_BYTES, collectTree, readTarGz, writeTarGz, type ArchiveEntry } from "./pack-archive.js";
import { withPackLock } from "./pack-lock.js";
import {
  defaultPackDir,
  INSTALLABLE_PACKS,
  KNOWN_PACKS,
  loadPack,
  type InstallablePack,
  type PackLoaderOptions,
} from "../../language/pack-loader.js";
import { loadInventoryConfig } from "../../language/detect.js";
import { sourcevisionVersion } from "../../language/package-paths.js";
import { CLIError } from "../errors.js";
import { result } from "../output.js";

/** What one npm run reported. */
export interface NpmResult {
  /** False when npm could not be started at all. */
  readonly launched: boolean;
  /** null when npm was killed. */
  readonly exitCode: number | null;
  /** stdout and stderr, interleaved as they arrived. */
  readonly output: string;
}

/** Runs `npm <args>`. */
export type NpmRunner = (args: readonly string[]) => Promise<NpmResult>;

export interface PackCommandDeps {
  /** The packs the command knows; defaults to {@link INSTALLABLE_PACKS}. */
  readonly packs?: readonly InstallablePack[];
  /** The pack directory; defaults to {@link defaultPackDir}. */
  readonly packDir?: string;
  /** sourcevision's version; defaults to this package's. */
  readonly version?: string;
  /** Runs npm; defaults to {@link runNpm}. */
  readonly npm?: NpmRunner;
  /** How the loader imports a pack from the pack directory. */
  readonly importFile?: PackLoaderOptions["importFile"];
  /** Writes one line of output; defaults to stdout. */
  readonly write?: (line: string) => void;
  /** Resolves `--out` and `--from`; defaults to the process's working directory. */
  readonly cwd?: string;
  /** The project's `sourcevision.packs`; defaults to what the project config at `cwd` lists. */
  readonly listed?: readonly string[];
  /** Where `bundle` makes its temporary npm prefix; defaults to the OS temp directory. */
  readonly tempRoot?: string;
  /** Whether a pack directory lock's holder still runs; defaults to `pidAlive` (`pack-lock.ts`). */
  readonly isAlive?: (pid: number) => boolean;
  /** The most `add --from` lets a bundle inflate to; defaults to {@link MAX_BUNDLE_BYTES}. */
  readonly maxBundleBytes?: number;
}

/** Runs npm through llm-client's spawn helper, which goes through cmd.exe on Windows for npm's `.cmd` shim. */
export const runNpm: NpmRunner = (args) =>
  new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawnCli("npm", [...args], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ launched: false, exitCode: null, output: error instanceof Error ? error.message : String(error) });
      return;
    }
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (error) => resolve({ launched: false, exitCode: null, output: `${output}${error.message}` }));
    child.on("close", (code) => resolve({ launched: true, exitCode: code, output }));
  });

/** `token` in double quotes when it holds whitespace, as a user would type it. */
const quoted = (token: string): string => (/\s/.test(token) ? `"${token}"` : token);

/** `npm <args>` as a user would type it, quoting tokens with whitespace. */
export function npmCommandLine(args: readonly string[]): string {
  return ["npm", ...args].map(quoted).join(" ");
}

/**
 * Lifecycle scripts never run: grammars are prebuilt WASM and `prepare` does
 * not run for registry tarballs, so no pack needs one, and a script anywhere in
 * the dependency tree would otherwise run with the user's privileges.
 */
const NO_SCRIPTS = "--ignore-scripts";

/** `npm install` of `spec` into `prefix`: no lifecycle scripts, no audit or funding requests. */
export const npmInstallArgs = (prefix: string, spec: string): string[] =>
  ["install", NO_SCRIPTS, "--no-audit", "--no-fund", "--prefix", prefix, spec];

/** `npm uninstall` of `packageName` from `prefix`, without lifecycle scripts. */
export const npmUninstallArgs = (prefix: string, packageName: string): string[] =>
  ["uninstall", NO_SCRIPTS, "--prefix", prefix, packageName];

function findPack(packs: readonly InstallablePack[], id: string | undefined, sub: string): InstallablePack {
  const known = `Known packs: ${packs.map((pack) => pack.id).join(", ")}.`;
  if (!id) throw new CLIError(`Missing language: sv pack ${sub} <lang>`, known);
  const pack = packs.find((p) => p.id === id);
  if (!pack) throw new CLIError(`Unknown language pack: ${id}`, known);
  return pack;
}

/** npm's output, indented, for an error message. */
const npmOutput = (output: string): string => {
  const text = output.trim();
  return text ? `\nnpm output:\n${text.replace(/^/gm, "  ")}` : "";
};

async function runOrFail(npm: NpmRunner, args: readonly string[]): Promise<NpmResult> {
  const run = await npm(args);
  if (!run.launched) {
    throw new CLIError(`Could not run \`${npmCommandLine(args)}\`.${npmOutput(run.output)}`, "Is npm on your PATH?");
  }
  if (run.exitCode !== 0) {
    throw new CLIError(`\`${npmCommandLine(args)}\` failed (exit ${run.exitCode ?? "killed"}).${npmOutput(run.output)}`);
  }
  return run;
}

/** The pack ids the project lists in `sourcevision.packs`, in the config's order. */
async function listedPackIds(deps: PackCommandDeps): Promise<readonly string[]> {
  return deps.listed ?? (await loadInventoryConfig(deps.cwd ?? process.cwd())).packs ?? [];
}

/** The pack's directory inside the pack directory. */
const installedDir = (pack: InstallablePack, packDir: string): string =>
  join(packDir, "node_modules", ...pack.packageName.split("/"));

/** One pack's state, as `sv pack list` reports it. */
export interface PackListing {
  readonly id: string;
  readonly packageName: string;
  /**
   * `installed` in the pack directory, `resolved` by module resolution (an
   * optional dependency or the workspace), `missing`, or `refused` (another
   * version, or not a pack entry).
   */
  readonly status: "installed" | "resolved" | "missing" | "refused";
  /** The version found, when one was. */
  readonly version?: string;
  /** Whether sourcevision analyzes with this pack yet. */
  readonly analyzed: boolean;
  /** Whether the project lists the pack in `sourcevision.packs`. */
  readonly listed: boolean;
  /** Why a pack is missing or refused, and what to do. */
  readonly reason?: string;
  readonly remedy?: string;
}

/** The state of every installable pack. */
export async function listPacks(
  packs: readonly InstallablePack[],
  packDir: string,
  version: string,
  importFile?: PackLoaderOptions["importFile"],
  listed: readonly string[] = [],
): Promise<PackListing[]> {
  const listings: PackListing[] = [];
  for (const pack of packs) {
    const base = {
      id: pack.id,
      packageName: pack.packageName,
      analyzed: KNOWN_PACKS.some((p) => p.id === pack.id),
      listed: listed.includes(pack.id),
    };
    const load = await loadPack(pack, { packDir, version, importFile });
    if (load.status === "loaded") {
      listings.push({ ...base, status: load.source === "pack-dir" ? "installed" : "resolved", version: load.entry.version });
    } else if (load.status === "missing") {
      listings.push({ ...base, status: "missing", ...load.notice });
    } else {
      listings.push({ ...base, status: "refused", ...(load.status === "mismatch" ? { version: load.found } : {}), ...load.notice });
    }
  }
  return listings;
}

/**
 * Prove an install by loading the pack from `packDir`: what analysis would
 * load is what counts. `how` names the install and `detail` is appended to an
 * error (npm's output).
 */
async function loadInstalled(
  pack: InstallablePack,
  packDir: string,
  version: string,
  deps: PackCommandDeps,
  how: string,
  detail = "",
): Promise<LanguagePackEntry> {
  const load = await loadPack(pack, { packDir, version, importFile: deps.importFile });
  if (load.status !== "loaded") {
    throw new CLIError(`${pack.packageName} was installed but cannot be used: ${load.notice.reason}.${detail}`);
  }
  if (load.source !== "pack-dir") {
    throw new CLIError(`${how} did not install ${pack.packageName} into ${packDir}.${detail}`);
  }
  return load.entry;
}

function reportInstalled(pack: InstallablePack, entry: LanguagePackEntry, packDir: string, write: (line: string) => void): void {
  write(`Installed ${pack.packageName}@${entry.version} into ${packDir} (produces ${entry.produces.join(", ")}).`);
  if (!KNOWN_PACKS.some((p) => p.id === pack.id)) {
    write(`sourcevision does not analyze ${pack.id} with a pack yet; the pack is ready for when it does.`);
  }
}

async function add(pack: InstallablePack, packDir: string, version: string, deps: PackCommandDeps, dryRun: boolean): Promise<void> {
  const write = deps.write ?? result;
  const args = npmInstallArgs(packDir, `${pack.packageName}@${version}`);
  if (dryRun) {
    write(npmCommandLine(args));
    return;
  }
  mkdirSync(packDir, { recursive: true });
  const run = await runOrFail(deps.npm ?? runNpm, args);
  const entry = await loadInstalled(pack, packDir, version, deps, `\`${npmCommandLine(args)}\``, npmOutput(run.output));
  reportInstalled(pack, entry, packDir, write);
}

/**
 * `sv pack add` with no language: install each pack the project lists that is
 * not installed, as `add <lang>` would. A pack the loader already finds (pack
 * directory or module resolution) is left alone.
 */
async function addListed(
  packs: readonly InstallablePack[],
  packDir: string,
  version: string,
  deps: PackCommandDeps,
  dryRun: boolean,
): Promise<void> {
  const write = deps.write ?? result;
  const listed = [...new Set(await listedPackIds(deps))];
  if (listed.length === 0) {
    write("The project lists no packs: set `sourcevision.packs` in the project config, or run `sv pack add <lang>`.");
    return;
  }
  const missing = listed.filter((id) => !packs.some((p) => p.id === id));
  if (missing.length > 0) {
    throw new CLIError(`sourcevision.packs lists unknown pack${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`, `Known packs: ${packs.map((p) => p.id).join(", ")}.`);
  }
  for (const id of listed) {
    const pack = findPack(packs, id, "add");
    const load = await loadPack(pack, { packDir, version, importFile: deps.importFile });
    if (load.status === "loaded") {
      write(`${pack.packageName} is already installed (${load.source === "pack-dir" ? "pack directory" : "module resolution"}).`);
      continue;
    }
    await add(pack, packDir, version, deps, dryRun);
  }
}

/** The file at the root of a bundle that says what it holds. */
export const BUNDLE_MANIFEST = "n-dx-pack-bundle.json";

/** What a bundle holds, written into it as {@link BUNDLE_MANIFEST}. */
export interface BundleManifest {
  readonly format: 1;
  /** The pack's language id. */
  readonly pack: string;
  readonly packageName: string;
  /** The pack's version, which is also the sourcevision version it was made for. */
  readonly version: string;
  readonly sourcevisionVersion: string;
  /** The contents are JavaScript and WebAssembly grammars, so one bundle serves every platform. */
  readonly platform: "any";
}

/** `data`'s SHA-256, as lowercase hex. */
export const sha256Hex = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

/** The checksum file `bundle` writes beside a bundle, in `sha256sum` format. */
export const checksumFileOf = (bundleFile: string): string => `${bundleFile}.sha256`;

/** The default bundle file name: `n-dx-lang-<lang>-<version>.tgz`. */
export const bundleFileName = (pack: InstallablePack, version: string): string => `n-dx-lang-${pack.id}-${version}.tgz`;

/**
 * `sv pack bundle <lang>`: install the pack with npm into a fresh temporary
 * prefix, prove it loads, add the manifest and archive the whole prefix (the
 * pack and every dependency) as one `.tgz` for a machine with no registry.
 */
async function bundle(pack: InstallablePack, version: string, deps: PackCommandDeps, out: string | undefined): Promise<void> {
  const write = deps.write ?? result;
  const file = resolve(deps.cwd ?? process.cwd(), out ?? bundleFileName(pack, version));
  const prefix = mkdtempSync(join(deps.tempRoot ?? tmpdir(), "sv-pack-bundle-"));
  try {
    const args = npmInstallArgs(prefix, `${pack.packageName}@${version}`);
    const run = await runOrFail(deps.npm ?? runNpm, args);
    await loadInstalled(pack, prefix, version, deps, `\`${npmCommandLine(args)}\``, npmOutput(run.output));
    const manifest: BundleManifest = {
      format: 1,
      pack: pack.id,
      packageName: pack.packageName,
      version,
      sourcevisionVersion: version,
      platform: "any",
    };
    writeFileSync(join(prefix, BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    const entries = collectTree(prefix);
    const archive = writeTarGz(entries);
    const hash = sha256Hex(archive);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, archive);
    writeFileSync(checksumFileOf(file), `${hash}  ${basename(file)}\n`);
    const files = entries.filter((e) => e.type === "file").length;
    write(`Bundled ${pack.packageName}@${version} and its dependencies (${files} files) into ${file}.`);
    write(`SHA-256 ${hash}, written to ${checksumFileOf(file)}.`);
    write(`Install it with no network: ndx sv pack add ${pack.id} --from ${quoted(file)} --sha256 ${hash}`);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
}

const SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Check `archive` against `expected` (`--sha256`) or, without it, against the
 * checksum file beside the bundle when there is one, before anything reads the
 * archive. A mismatch is an error; with neither, say the bundle was not
 * verified. A checksum file beside the bundle catches a damaged copy, not a
 * tampered one, which can carry its own: only `--sha256` with the hash from
 * the bundle's maker shows the bundle is the one they made.
 */
function verifyBundle(file: string, archive: Buffer, expected: string | undefined, write: (line: string) => void): void {
  const actual = sha256Hex(archive);
  const nothing = "Nothing was extracted or installed.";
  if (expected !== undefined) {
    if (!SHA256.test(expected)) {
      throw new CLIError(`--sha256 takes the bundle's SHA-256 as 64 hex digits, not ${JSON.stringify(expected)}.`);
    }
    if (actual !== expected.toLowerCase()) {
      throw new CLIError(
        `${file} has SHA-256 ${actual}, not the ${expected.toLowerCase()} given with --sha256.`,
        `${nothing} Get the bundle again from whoever made it.`,
      );
    }
    write(`Verified ${file}: SHA-256 ${actual} matches --sha256.`);
    return;
  }
  const sidecar = checksumFileOf(file);
  if (!existsSync(sidecar)) {
    write(`Not verified: ${file} has SHA-256 ${actual}. Pass --sha256 <hex> with the hash sv pack bundle printed to check it.`);
    return;
  }
  const recorded = readFileSync(sidecar, "utf-8").trim().split(/\s/)[0] ?? "";
  if (!SHA256.test(recorded)) throw new CLIError(`${sidecar} holds no SHA-256.`, `${nothing} Delete it, or pass --sha256 <hex>.`);
  if (actual !== recorded.toLowerCase()) {
    throw new CLIError(
      `${file} has SHA-256 ${actual}, not the ${recorded.toLowerCase()} recorded in ${sidecar}.`,
      `${nothing} The bundle is damaged or was changed; get it again.`,
    );
  }
  write(
    `Checked ${file} against ${sidecar} (SHA-256 ${actual}). That file travels with the bundle, so it catches damage, not tampering: pass --sha256 with the hash from the bundle's maker for that.`,
  );
}

/** The bundle file's bytes, or an error naming why it cannot be read. */
function readBundleFile(file: string): Buffer {
  try {
    return readFileSync(file);
  } catch (error) {
    throw new CLIError(`Cannot read the bundle ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The bundle's manifest and entries, or an error naming what is wrong with it. */
function readBundle(file: string, archive: Buffer, pack: InstallablePack, version: string, maxBytes: number): ArchiveEntry[] {
  let entries: ArchiveEntry[];
  try {
    entries = readTarGz(archive, maxBytes);
  } catch (error) {
    if (!(error instanceof ArchiveError)) throw error;
    throw new CLIError(`${file} is not a usable pack bundle: ${error.message}.`, `Make it again with \`sv pack bundle ${pack.id}\`.`);
  }
  const notABundle = (why: string): CLIError =>
    new CLIError(`${file} is not a pack bundle: ${why}.`, `Make one with \`sv pack bundle ${pack.id}\`.`);
  const manifestEntry = entries.find((e) => e.path === BUNDLE_MANIFEST);
  if (manifestEntry?.type !== "file") throw notABundle(`it has no ${BUNDLE_MANIFEST}`);
  let manifest: Partial<BundleManifest> | null;
  try {
    manifest = JSON.parse(manifestEntry.data.toString("utf-8")) as Partial<BundleManifest>;
  } catch (error) {
    throw notABundle(`its ${BUNDLE_MANIFEST} is not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw notABundle(`its ${BUNDLE_MANIFEST} is not a JSON object`);
  }
  if (manifest.format !== 1) throw notABundle(`its ${BUNDLE_MANIFEST} is of an unknown format ${JSON.stringify(manifest.format)}`);
  const holds = `${String(manifest.packageName)}@${String(manifest.version)}`;
  if (manifest.pack !== pack.id || manifest.packageName !== pack.packageName) {
    throw new CLIError(`${file} is a bundle of ${holds}, not of ${pack.packageName}.`, `Install it with \`sv pack add ${String(manifest.pack)} --from <bundle>\`.`);
  }
  if (manifest.version !== version) {
    throw new CLIError(
      `${file} is a bundle of ${holds}, made for sourcevision ${String(manifest.sourcevisionVersion)}; this is sourcevision ${version}.`,
      `Make a bundle with \`sv pack bundle ${pack.id}\` on a connected machine running sourcevision ${version}.`,
    );
  }
  const packJson = `node_modules/${pack.packageName}/package.json`;
  if (!entries.some((e) => e.type === "file" && e.path === packJson)) {
    throw new CLIError(`${file} names ${holds} but does not contain it (${packJson} is missing).`);
  }
  return entries;
}

/**
 * `sv pack add <lang> --from <bundle> [--sha256 <hex>]`: no network. Check the
 * bundle's hash ({@link verifyBundle}) and manifest, replace the installed
 * copies of the pack and its dependency closure with the bundle's, record the
 * pack in the pack directory's `package.json` so npm keeps it, and load it.
 */
async function addFromBundle(
  pack: InstallablePack,
  packDir: string,
  version: string,
  deps: PackCommandDeps,
  file: string,
  expectedHash: string | undefined,
  dryRun: boolean,
): Promise<void> {
  const write = deps.write ?? result;
  const bundleFile = resolve(deps.cwd ?? process.cwd(), file);
  const archive = readBundleFile(bundleFile);
  verifyBundle(bundleFile, archive, expectedHash, write);
  const entries = readBundle(bundleFile, archive, pack, version, deps.maxBundleBytes ?? MAX_BUNDLE_BYTES).filter(
    // npm's hidden lockfile describes the bundle's own prefix, not this one.
    (e) => e.path.startsWith("node_modules/") && e.path !== "node_modules/.package-lock.json",
  );
  if (dryRun) {
    write(`Would install ${pack.packageName}@${version} from ${bundleFile} into ${packDir} (${entries.length} entries).`);
    return;
  }
  // Extract beside the pack directory and prove the pack loads from there; the
  // installed copy is replaced only once it has. A bundle that fails anywhere
  // leaves the previous install as it was (offline there is no re-download).
  mkdirSync(dirname(packDir), { recursive: true });
  const stage = mkdtempSync(join(dirname(packDir), ".sv-pack-stage-"));
  try {
    for (const entry of entries) {
      const target = join(stage, ...entry.path.split("/"));
      if (entry.type === "directory") {
        mkdirSync(target, { recursive: true });
      } else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, entry.data, { mode: entry.mode });
      }
    }
    const staged = await loadPack(pack, { packDir: stage, version, importFile: deps.importFile });
    if (staged.status !== "loaded" || staged.source !== "pack-dir") {
      const why = staged.status === "loaded" ? "it is not in the bundle's node_modules" : staged.notice.reason;
      throw new CLIError(
        `The bundle ${bundleFile} holds ${pack.packageName}@${version} but it cannot be used: ${why}.`,
        "The installed copy was left as it was.",
      );
    }
    const manifestFile = join(packDir, "package.json");
    const manifest = existsSync(manifestFile) ? (JSON.parse(readFileSync(manifestFile, "utf-8")) as Record<string, unknown>) : {};
    const dependencies = { ...((manifest["dependencies"] as Record<string, string> | undefined) ?? {}), [pack.packageName]: version };
    const otherPacks = (deps.packs ?? INSTALLABLE_PACKS).filter((p) => p.id !== pack.id).map((p) => p.packageName);
    replaceInstalled(stage, packDir, dependencyClosure(join(stage, "node_modules"), pack.packageName, otherPacks));
    writeFileSync(manifestFile, `${JSON.stringify({ ...manifest, dependencies }, null, 2)}\n`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  const entry = await loadInstalled(pack, packDir, version, deps, `The bundle ${bundleFile}`);
  reportInstalled(pack, entry, packDir, write);
}

/** The package.json fields naming what a package needs at run time. */
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

/** `name` or `@scope/name`, neither part `.`, `..` or holding a separator: what npm accepts as a package name's shape. */
const PACKAGE_NAME = /^(?:@(?!\.\.?\/)[^/\\@]+\/)?(?!\.\.?$)[^/\\@]+$/;

/**
 * The packages directly under `nodeModules` that `packageName` needs: itself
 * and, transitively, every package its package.json names in
 * {@link DEPENDENCY_FIELDS}, found as Node finds one (its own `node_modules`,
 * then each enclosing one). A package nested inside another moves with it, so
 * it counts as its top-level ancestor; one that is not there (an optional
 * dependency left out) adds nothing. A name in `exclude` (the other packs) is
 * never followed, so a bundle cannot replace another pack.
 */
export function dependencyClosure(nodeModules: string, packageName: string, exclude: readonly string[] = []): string[] {
  const topLevel = new Set<string>();
  const seen = new Set<string>();
  // A package is its directory's segments below `nodeModules`, e.g. ["a", "node_modules", "@s", "b"].
  const resolveFrom = (from: readonly string[], name: string): string[] | undefined => {
    const bases = [[...from, "node_modules"]];
    for (let i = from.length - 1; i > 0; i--) if (from[i] === "node_modules") bases.push(from.slice(0, i + 1));
    bases.push([]);
    return bases
      .map((base) => [...base, ...name.split("/")])
      .find((candidate) => existsSync(join(nodeModules, ...candidate, "package.json")));
  };
  const visit = (segments: string[]): void => {
    const dir = join(nodeModules, ...segments);
    if (seen.has(dir)) return;
    seen.add(dir);
    topLevel.add(segments[0]!.startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0]!);
    const manifestFile = join(dir, "package.json");
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as Record<string, unknown>;
    } catch (error) {
      throw new CLIError(`Cannot read ${manifestFile} from the bundle: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const field of DEPENDENCY_FIELDS) {
      const named = manifest[field];
      if (typeof named !== "object" || named === null) continue;
      for (const name of Object.keys(named)) {
        // A name is a path below node_modules: one that could climb out of it would move files outside the pack directory.
        if (!PACKAGE_NAME.test(name)) throw new CLIError(`${manifestFile} in the bundle names ${JSON.stringify(name)}, which is not a package name.`);
        if (exclude.includes(name)) continue;
        const found = resolveFrom(segments, name);
        if (found) visit(found);
      }
    }
  };
  visit(packageName.split("/"));
  return [...topLevel].sort();
}

/**
 * Move each package in `names` (from {@link dependencyClosure}) from
 * `stage/node_modules` over its namesake in `packDir/node_modules` by rename;
 * every other package, staged or installed, stays where it is. If a move
 * fails, the ones already made are undone before the error is rethrown.
 *
 * A package counts as moved only once its rename has succeeded, so the undo
 * deletes only copies this call put in place: whatever occupies a target whose
 * rename failed (another writer's install, should the lock be bypassed) is left
 * alone, and the displaced copy goes back only into an empty target.
 * `rename` is injectable for tests.
 */
export function replaceInstalled(
  stage: string,
  packDir: string,
  names: readonly string[],
  rename: (from: string, to: string) => void = renameSync,
): void {
  const from = join(stage, "node_modules");
  const to = join(packDir, "node_modules");
  const displaced = join(stage, ".displaced");
  const targetOf = (name: string): string => join(to, ...name.split("/"));
  const oldOf = (name: string): string => join(displaced, ...name.split("/"));
  const restore = (name: string): void => {
    if (existsSync(oldOf(name)) && !existsSync(targetOf(name))) rename(oldOf(name), targetOf(name));
  };
  const done: string[] = [];
  try {
    for (const name of names) {
      const target = targetOf(name);
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target)) {
        mkdirSync(dirname(oldOf(name)), { recursive: true });
        rename(target, oldOf(name));
      }
      try {
        rename(join(from, ...name.split("/")), target);
      } catch (error) {
        restore(name);
        throw error;
      }
      done.push(name);
    }
  } catch (error) {
    for (const name of done.reverse()) {
      rmSync(targetOf(name), { recursive: true, force: true });
      restore(name);
    }
    throw error;
  }
  // npm's hidden lockfile describes the old tree.
  rmSync(join(to, ".package-lock.json"), { force: true });
}

async function remove(pack: InstallablePack, packDir: string, version: string, deps: PackCommandDeps, dryRun: boolean): Promise<void> {
  const write = deps.write ?? result;
  if (!existsSync(join(installedDir(pack, packDir), "package.json"))) {
    const load = await loadPack(pack, { packDir, version, importFile: deps.importFile });
    write(
      load.status === "loaded"
        ? `${pack.packageName} is not in ${packDir}; it is found by module resolution, which pack remove does not change. Nothing removed.`
        : `${pack.packageName} is not installed in ${packDir}. Nothing removed.`,
    );
    return;
  }
  const args = npmUninstallArgs(packDir, pack.packageName);
  if (dryRun) {
    write(npmCommandLine(args));
    return;
  }
  await runOrFail(deps.npm ?? runNpm, args);
  write(`Removed ${pack.packageName} from ${packDir}.`);
}

async function list(packDir: string, version: string, deps: PackCommandDeps, json: boolean): Promise<void> {
  const write = deps.write ?? result;
  const packs = await listPacks(deps.packs ?? INSTALLABLE_PACKS, packDir, version, deps.importFile, await listedPackIds(deps));
  if (json) {
    write(JSON.stringify({ packDir, version, packs }, null, 2));
    return;
  }
  write(`Pack directory: ${packDir}`);
  const idWidth = Math.max(...packs.map((p) => p.id.length));
  for (const p of packs) {
    const name = p.version ? `${p.packageName}@${p.version}` : p.packageName;
    const detail =
      p.status === "installed" ? "in the pack directory"
      : p.status === "resolved" ? "found by module resolution"
      : p.status === "missing" ? (p.remedy ?? "")
      : [p.reason, p.remedy].filter(Boolean).join(". ");
    const note = (p.analyzed ? "" : " (not analyzed yet)") + (p.listed ? " [listed]" : "");
    write(`${p.id.padEnd(idWidth)}  ${p.status.padEnd(9)}  ${name}  ${detail}${note}`);
  }
}

/** Options that take a value, as `--opt <value>` or `--opt=<value>`. */
const VALUE_OPTIONS = ["--out", "--from", "--sha256"] as const;

/** Split `args` into positionals, flags and the values of {@link VALUE_OPTIONS}. */
function parseArgs(args: readonly string[]): { positional: string[]; flags: Set<string>; values: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const option = VALUE_OPTIONS.find((o) => arg === o || arg.startsWith(`${o}=`));
    if (option) {
      const value = arg === option ? args[++i] : arg.slice(option.length + 1);
      if (!value || (arg === option && value.startsWith("-"))) throw new CLIError(`Missing value for ${option}`);
      values.set(option, value);
    } else if (arg.startsWith("-")) {
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, values };
}

/** `sv pack <add|bundle|list|remove> [lang] [--from <bundle> [--sha256 <hex>]] [--out <file>] [--dry-run] [--json]`; `args` follow `pack`. */
export async function cmdPack(args: readonly string[], deps: PackCommandDeps = {}): Promise<void> {
  const { positional, flags, values } = parseArgs(args);
  const [sub, id] = positional;
  const dryRun = flags.has("--dry-run");
  const json = flags.has("--json");
  const version = deps.version ?? sourcevisionVersion();
  const packDir = deps.packDir ?? defaultPackDir(version);
  const packs = deps.packs ?? INSTALLABLE_PACKS;
  // Writers hold the pack directory's lock for their whole run; a dry run writes nothing.
  const locked = (command: string, fn: () => Promise<void>): Promise<void> =>
    dryRun ? fn() : withPackLock(packDir, command, fn, deps.isAlive);

  switch (sub) {
    case "add": {
      const from = values.get("--from");
      const sha256 = values.get("--sha256");
      if (sha256 !== undefined && !from) throw new CLIError("--sha256 checks a bundle: use it with add <lang> --from <bundle>.");
      if (!id && !from) return locked("pack add", () => addListed(packs, packDir, version, deps, dryRun));
      const pack = findPack(packs, id, sub);
      return from
        ? locked(`pack add ${pack.id} --from`, () => addFromBundle(pack, packDir, version, deps, from, sha256, dryRun))
        : locked(`pack add ${pack.id}`, () => add(pack, packDir, version, deps, dryRun));
    }
    case "bundle":
      return bundle(findPack(packs, id, sub), version, deps, values.get("--out"));
    case "remove": {
      const pack = findPack(packs, id, sub);
      return locked(`pack remove ${pack.id}`, () => remove(pack, packDir, version, deps, dryRun));
    }
    case "list":
      return list(packDir, version, deps, json);
    default:
      throw new CLIError(
        sub ? `Unknown pack command: ${sub}` : "Missing pack command",
        "Run 'sourcevision pack --help': pack add [<lang>] [--from <bundle>], pack bundle <lang>, pack list, pack remove <lang>.",
        CLI_ERROR_CODES.UNKNOWN_COMMAND,
      );
  }
}
