/**
 * `sv pack add|bundle|list|remove`: manage the language packs in the per-user
 * pack directory, `<ndx home>/packs/<sourcevision version>/`.
 *
 * `add` and `remove` run `npm install|uninstall --prefix <pack dir>`; the
 * loader (`src/language/pack-loader.ts`) then finds a pack there before module
 * resolution. A pack is always installed at sourcevision's own version, and
 * `add` loads it after installing, so a pack that is of another version or
 * will not load is an error rather than a silent success.
 *
 * Offline: `bundle` installs a pack into a temporary prefix and archives it
 * with its dependencies and a manifest (`pack-archive.ts`, Node only, no `tar`
 * process); `add --from <bundle>` installs that archive with no npm call.
 *
 * @module sourcevision/cli/commands/pack
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { CLI_ERROR_CODES, spawnCli } from "@n-dx/llm-client";
import { ArchiveError, collectTree, readTarGz, writeTarGz, type ArchiveEntry } from "./pack-archive.js";
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
  const args = ["install", "--prefix", packDir, `${pack.packageName}@${version}`];
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
    const args = ["install", "--prefix", prefix, `${pack.packageName}@${version}`];
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
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, writeTarGz(entries));
    const files = entries.filter((e) => e.type === "file").length;
    write(`Bundled ${pack.packageName}@${version} and its dependencies (${files} files) into ${file}.`);
    write(`Install it with no network: ndx sv pack add ${pack.id} --from ${quoted(file)}`);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
}

/** The bundle's manifest and entries, or an error naming what is wrong with it. */
function readBundle(file: string, pack: InstallablePack, version: string): ArchiveEntry[] {
  let archive: Buffer;
  try {
    archive = readFileSync(file);
  } catch (error) {
    throw new CLIError(`Cannot read the bundle ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let entries: ArchiveEntry[];
  try {
    entries = readTarGz(archive);
  } catch (error) {
    if (!(error instanceof ArchiveError)) throw error;
    throw new CLIError(`${file} is not a usable pack bundle: ${error.message}.`, `Make it again with \`sv pack bundle ${pack.id}\`.`);
  }
  const notABundle = (why: string): CLIError =>
    new CLIError(`${file} is not a pack bundle: ${why}.`, `Make one with \`sv pack bundle ${pack.id}\`.`);
  const manifestEntry = entries.find((e) => e.path === BUNDLE_MANIFEST);
  if (manifestEntry?.type !== "file") throw notABundle(`it has no ${BUNDLE_MANIFEST}`);
  let manifest: Partial<BundleManifest>;
  try {
    manifest = JSON.parse(manifestEntry.data.toString("utf-8")) as Partial<BundleManifest>;
  } catch (error) {
    throw notABundle(`its ${BUNDLE_MANIFEST} is not JSON (${error instanceof Error ? error.message : String(error)})`);
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
 * `sv pack add <lang> --from <bundle>`: no network. Check the bundle's
 * manifest, replace any installed copy of the pack with the bundle's
 * `node_modules`, record the pack in the pack directory's `package.json` so
 * npm keeps it, and load it.
 */
async function addFromBundle(
  pack: InstallablePack,
  packDir: string,
  version: string,
  deps: PackCommandDeps,
  file: string,
  dryRun: boolean,
): Promise<void> {
  const write = deps.write ?? result;
  const bundleFile = resolve(deps.cwd ?? process.cwd(), file);
  const entries = readBundle(bundleFile, pack, version).filter(
    // npm's hidden lockfile describes the bundle's own prefix, not this one.
    (e) => e.path.startsWith("node_modules/") && e.path !== "node_modules/.package-lock.json",
  );
  if (dryRun) {
    write(`Would install ${pack.packageName}@${version} from ${bundleFile} into ${packDir} (${entries.length} entries).`);
    return;
  }
  rmSync(installedDir(pack, packDir), { recursive: true, force: true });
  rmSync(join(packDir, "node_modules", ".package-lock.json"), { force: true });
  for (const entry of entries) {
    const target = join(packDir, ...entry.path.split("/"));
    if (entry.type === "directory") {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.data, { mode: entry.mode });
    }
  }
  const manifestFile = join(packDir, "package.json");
  const manifest = existsSync(manifestFile) ? (JSON.parse(readFileSync(manifestFile, "utf-8")) as Record<string, unknown>) : {};
  const dependencies = { ...((manifest["dependencies"] as Record<string, string> | undefined) ?? {}), [pack.packageName]: version };
  writeFileSync(manifestFile, `${JSON.stringify({ ...manifest, dependencies }, null, 2)}\n`);

  const entry = await loadInstalled(pack, packDir, version, deps, `The bundle ${bundleFile}`);
  reportInstalled(pack, entry, packDir, write);
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
  const args = ["uninstall", "--prefix", packDir, pack.packageName];
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
const VALUE_OPTIONS = ["--out", "--from"] as const;

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

/** `sv pack <add|bundle|list|remove> [lang] [--from <bundle>] [--out <file>] [--dry-run] [--json]`; `args` follow `pack`. */
export async function cmdPack(args: readonly string[], deps: PackCommandDeps = {}): Promise<void> {
  const { positional, flags, values } = parseArgs(args);
  const [sub, id] = positional;
  const dryRun = flags.has("--dry-run");
  const json = flags.has("--json");
  const version = deps.version ?? sourcevisionVersion();
  const packDir = deps.packDir ?? defaultPackDir(version);
  const packs = deps.packs ?? INSTALLABLE_PACKS;

  switch (sub) {
    case "add": {
      const from = values.get("--from");
      if (!id && !from) return addListed(packs, packDir, version, deps, dryRun);
      const pack = findPack(packs, id, sub);
      return from ? addFromBundle(pack, packDir, version, deps, from, dryRun) : add(pack, packDir, version, deps, dryRun);
    }
    case "bundle":
      return bundle(findPack(packs, id, sub), version, deps, values.get("--out"));
    case "remove":
      return remove(findPack(packs, id, sub), packDir, version, deps, dryRun);
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
