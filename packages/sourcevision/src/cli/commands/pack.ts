/**
 * `sv pack add|list|remove`: manage the language packs in the per-user pack
 * directory, `<ndx home>/packs/<sourcevision version>/`.
 *
 * `add` and `remove` run `npm install|uninstall --prefix <pack dir>`; the
 * loader (`src/language/pack-loader.ts`) then finds a pack there before module
 * resolution. A pack is always installed at sourcevision's own version, and
 * `add` loads it after installing, so a pack that is of another version or
 * will not load is an error rather than a silent success.
 *
 * @module sourcevision/cli/commands/pack
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLI_ERROR_CODES, spawnCli } from "@n-dx/llm-client";
import {
  defaultPackDir,
  INSTALLABLE_PACKS,
  KNOWN_PACKS,
  loadPack,
  type InstallablePack,
  type PackLoaderOptions,
} from "../../language/pack-loader.js";
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

/** `npm <args>` as a user would type it, quoting tokens with whitespace. */
export function npmCommandLine(args: readonly string[]): string {
  return ["npm", ...args].map((token) => (/\s/.test(token) ? `"${token}"` : token)).join(" ");
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
): Promise<PackListing[]> {
  const listings: PackListing[] = [];
  for (const pack of packs) {
    const base = { id: pack.id, packageName: pack.packageName, analyzed: KNOWN_PACKS.some((p) => p.id === pack.id) };
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

async function add(pack: InstallablePack, packDir: string, version: string, deps: PackCommandDeps, dryRun: boolean): Promise<void> {
  const write = deps.write ?? result;
  const args = ["install", "--prefix", packDir, `${pack.packageName}@${version}`];
  if (dryRun) {
    write(npmCommandLine(args));
    return;
  }
  mkdirSync(packDir, { recursive: true });
  const run = await runOrFail(deps.npm ?? runNpm, args);

  // Prove the install by loading it: what analysis would load is what counts.
  const load = await loadPack(pack, { packDir, version, importFile: deps.importFile });
  if (load.status !== "loaded") {
    throw new CLIError(`${pack.packageName} was installed but cannot be used: ${load.notice.reason}.${npmOutput(run.output)}`);
  }
  if (load.source !== "pack-dir") {
    throw new CLIError(`\`${npmCommandLine(args)}\` did not install ${pack.packageName} into ${packDir}.${npmOutput(run.output)}`);
  }
  write(`Installed ${pack.packageName}@${load.entry.version} into ${packDir} (produces ${load.entry.produces.join(", ")}).`);
  if (!KNOWN_PACKS.some((p) => p.id === pack.id)) {
    write(`sourcevision does not analyze ${pack.id} with a pack yet; the pack is ready for when it does.`);
  }
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
  const packs = await listPacks(deps.packs ?? INSTALLABLE_PACKS, packDir, version, deps.importFile);
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
    const note = p.analyzed ? "" : " (not analyzed yet)";
    write(`${p.id.padEnd(idWidth)}  ${p.status.padEnd(9)}  ${name}  ${detail}${note}`);
  }
}

/** `sv pack <add|list|remove> [lang] [--dry-run] [--json]`; `args` are the arguments after `pack`. */
export async function cmdPack(args: readonly string[], deps: PackCommandDeps = {}): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("-"));
  const [sub, id] = positional;
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");
  const version = deps.version ?? sourcevisionVersion();
  const packDir = deps.packDir ?? defaultPackDir(version);

  switch (sub) {
    case "add":
      return add(findPack(deps.packs ?? INSTALLABLE_PACKS, id, sub), packDir, version, deps, dryRun);
    case "remove":
      return remove(findPack(deps.packs ?? INSTALLABLE_PACKS, id, sub), packDir, version, deps, dryRun);
    case "list":
      return list(packDir, version, deps, json);
    default:
      throw new CLIError(
        sub ? `Unknown pack command: ${sub}` : "Missing pack command",
        "Run 'sourcevision pack --help': pack add <lang>, pack list, pack remove <lang>.",
        CLI_ERROR_CODES.UNKNOWN_COMMAND,
      );
  }
}
