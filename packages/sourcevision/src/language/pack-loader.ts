/**
 * Finds sourcevision's language packs at run time and loads their entries.
 *
 * sourcevision knows each pack by name ({@link KNOWN_PACKS}) and never imports
 * one statically. For a pack, it looks first in the per-user pack directory,
 * `<ndx home>/packs/<sourcevision version>/node_modules/<package>`, where
 * opt-in packs are installed with `npm install --prefix`, then through normal
 * module resolution (an optional dependency, or the n-dx workspace). The pack
 * must carry sourcevision's own version, since the two are released together.
 * `sv pack add` ({@link INSTALLABLE_PACKS}) installs packs there.
 *
 * A pack installed only for another sourcevision version (left behind by an
 * n-dx upgrade) is refused like a pack of another version, not called missing.
 *
 * A pack that is missing, of another version or not a pack entry is never
 * fatal: the result carries a notice, worded like the notices of a pack that
 * cannot run, naming the `ndx sv pack add` command that installs the right one.
 *
 * @module sourcevision/language/pack-loader
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { goConfig, isLanguagePackEntry, javaConfig, pythonConfig, terraformConfig, type LanguageConfig, type LanguagePackEntry, type PackDegradation } from "@n-dx/lang-kit";
import { resolveNdxHome } from "@n-dx/llm-client";
import { sourcevisionVersion } from "./package-paths.js";

/** A language pack `sv pack` can install, list and remove. */
export interface InstallablePack {
  /** Language id; the pack's entry carries the same. `sv pack add <id>` names it. */
  readonly id: string;
  /** npm package name. */
  readonly packageName: string;
  /**
   * Import the package by normal module resolution. Each is written with a
   * literal specifier so that bundler and test aliases apply.
   */
  readonly importByResolution: () => Promise<unknown>;
}

/** A language pack sourcevision analyzes with. */
export interface KnownPack extends InstallablePack {
  /**
   * The language's config, from lang-kit: which inventory files belong to the
   * pack is known before the pack is loaded.
   */
  readonly config: LanguageConfig;
  /**
   * Installed with sourcevision (an optional dependency, with a fallback
   * parser), so a missing one means the install went wrong and is warned
   * about. A missing opt-in pack the project does not list is only suggested
   * ({@link isSuggestedPack}).
   */
  readonly bundled?: boolean;
}

/**
 * True when a pack that did not load is only a suggestion, not a fault: an
 * opt-in pack that is missing and that the project does not list in
 * `sourcevision.packs`. A listed, bundled, refused or invalid pack is warned
 * about.
 */
export function isSuggestedPack(pack: KnownPack, load: PackLoad, listed: readonly string[]): boolean {
  return load.status === "missing" && !pack.bundled && !listed.includes(pack.id);
}

/** The packs sourcevision loads, in the order their languages are analyzed. */
export const KNOWN_PACKS: readonly KnownPack[] = [
  { id: javaConfig.id, packageName: "@n-dx/lang-java", config: javaConfig, importByResolution: () => import("@n-dx/lang-java") },
  { id: goConfig.id, packageName: "@n-dx/lang-go", config: goConfig, bundled: true, importByResolution: () => import("@n-dx/lang-go") },
  // Not an imports pack: its resources enrich infrastructure.json (`analyzers/terraform-infrastructure.ts`).
  { id: terraformConfig.id, packageName: "@n-dx/lang-terraform", config: terraformConfig, importByResolution: () => import("@n-dx/lang-terraform") },
  // No fallback parser: without it, Python files get inventory only.
  { id: pythonConfig.id, packageName: "@n-dx/lang-python", config: pythonConfig, importByResolution: () => import("@n-dx/lang-python") },
];

/**
 * Every pack `sv pack add` accepts: the analyzed {@link KNOWN_PACKS}, then
 * packs that are published but not analyzed with yet.
 */
export const INSTALLABLE_PACKS: readonly InstallablePack[] = [
  ...KNOWN_PACKS,
  { id: "sql", packageName: "@n-dx/lang-sql", importByResolution: () => import("@n-dx/lang-sql") },
];

export interface PackLoaderOptions {
  /** The per-user pack directory; defaults to {@link defaultPackDir}. */
  readonly packDir?: string;
  /** sourcevision's version, which a pack must match; defaults to this package's. */
  readonly version?: string;
  /** Imports a module by file URL, for a pack found in `packDir`. Defaults to `import()`. */
  readonly importFile?: (url: string) => Promise<unknown>;
}

/** Where a loaded pack was found. */
export type PackSource = "pack-dir" | "resolution";

export type PackLoad =
  | { readonly status: "loaded"; readonly entry: LanguagePackEntry; readonly source: PackSource }
  | { readonly status: "missing" | "invalid"; readonly notice: PackDegradation }
  | { readonly status: "mismatch"; readonly notice: PackDegradation; /** The version found. */ readonly found: string };

/** `<ndx home>/packs`: one pack directory per sourcevision version below it. */
const packsRoot = (): string => join(resolveNdxHome(), "packs");

/** `<ndx home>/packs/<version>`: where opt-in packs for this sourcevision version are installed. */
export function defaultPackDir(version: string = sourcevisionVersion()): string {
  return join(packsRoot(), version);
}

/**
 * The version of `pack` installed in another version's directory beside
 * `packDir`, the newest when there are several. Undefined when there is none,
 * or when `packDir` is not under `<ndx home>/packs`.
 */
function versionInSiblingPackDir(pack: InstallablePack, packDir: string): string | undefined {
  const root = dirname(packDir);
  if (root !== packsRoot() || !existsSync(root)) return undefined;
  const found: string[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name === basename(packDir)) continue;
    const manifestFile = join(root, dir.name, "node_modules", ...pack.packageName.split("/"), "package.json");
    if (!existsSync(manifestFile)) continue;
    found.push(manifestVersion(manifestFile) ?? dir.name);
  }
  return found.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
}

/** A package.json's version, or undefined when it does not parse or has none. */
function manifestVersion(file: string): string | undefined {
  let manifest: PackManifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf-8")) as PackManifest;
  } catch {
    return undefined;
  }
  return typeof manifest.version === "string" ? manifest.version : undefined;
}

/** The command that installs the pack matching this sourcevision into the pack directory. */
export function packInstallCommand(pack: InstallablePack): string {
  return `ndx sv pack add ${pack.id}`;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** True when `error` says the package itself is not installed, not one of its own imports. */
const isPackNotFound = (error: unknown, packageName: string): boolean =>
  error instanceof Error &&
  (error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND" &&
  error.message.includes(`'${packageName}'`);

interface PackManifest {
  readonly version?: unknown;
  readonly main?: unknown;
  readonly exports?: unknown;
}

/** The file a package's `.` export points to for `import`. */
function entryFile(manifest: PackManifest): string {
  const root = (manifest.exports as Record<string, unknown> | undefined)?.["."] ?? manifest.exports;
  if (typeof root === "string") return root;
  const conditional = root as Record<string, unknown> | undefined;
  for (const key of ["import", "default"]) {
    if (typeof conditional?.[key] === "string") return conditional[key] as string;
  }
  return typeof manifest.main === "string" ? manifest.main : "index.js";
}

/**
 * Find `pack` and load its entry: from the pack directory when it is
 * installed there, else by module resolution. Never throws.
 */
export async function loadPack(pack: InstallablePack, options: PackLoaderOptions = {}): Promise<PackLoad> {
  const version = options.version ?? sourcevisionVersion();
  const packDir = options.packDir ?? defaultPackDir(version);
  const install = packInstallCommand(pack);
  const notice = (status: "missing" | "invalid", reason: string, remedy: string): PackLoad => ({
    status,
    notice: { reason, remedy },
  });
  const mismatch = (found: string): PackLoad => ({
    status: "mismatch",
    found,
    notice: {
      reason: `pack ${pack.packageName}@${found} does not match @n-dx/sourcevision@${version} and was not used`,
      remedy: `Install the matching pack with \`${install}\`.`,
    },
  });
  const invalid = (detail: string): PackLoad =>
    notice("invalid", `pack ${pack.packageName} could not be loaded (${detail})`, `Reinstall it with \`${install}\`.`);

  const installed = join(packDir, "node_modules", ...pack.packageName.split("/"));
  let imported: unknown;
  let source: PackSource;
  if (existsSync(join(installed, "package.json"))) {
    // Checked before importing, so code built against another contract never runs.
    let manifest: PackManifest;
    try {
      manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf-8")) as PackManifest;
    } catch (error) {
      return invalid(`${join(installed, "package.json")}: ${errorText(error)}`);
    }
    if (manifest.version !== version) return mismatch(String(manifest.version));
    const importFile = options.importFile ?? ((url: string) => import(url));
    try {
      imported = await importFile(pathToFileURL(join(installed, entryFile(manifest))).href);
    } catch (error) {
      return invalid(errorText(error));
    }
    source = "pack-dir";
  } else {
    try {
      imported = await pack.importByResolution();
    } catch (error) {
      if (isPackNotFound(error, pack.packageName)) {
        const stale = versionInSiblingPackDir(pack, packDir);
        if (stale !== undefined) return mismatch(stale);
        return notice("missing", `pack ${pack.packageName} is not installed`, `Install it with \`${install}\`.`);
      }
      return invalid(errorText(error));
    }
    source = "resolution";
  }

  const entry = (imported as { pack?: unknown } | undefined)?.pack;
  if (!isLanguagePackEntry(entry) || entry.id !== pack.id || entry.packageName !== pack.packageName) {
    return invalid(`it exports no ${pack.id} pack entry`);
  }
  if (entry.version !== version) return mismatch(entry.version);
  return { status: "loaded", entry, source };
}
