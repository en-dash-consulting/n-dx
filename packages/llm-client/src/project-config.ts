/**
 * Project-level configuration utilities shared across packages.
 *
 * Handles loading the project config overrides and deep-merging them into
 * package-specific configs. Previously duplicated identically in
 * both rex and hench.
 *
 * Which files hold the overrides is the layout resolver's decision
 * (`./layout.ts`): `.n-dx.json` and `.n-dx.local.json` on the legacy layout,
 * `.ndx/config.json` and `.ndx/config.local.json` on the `.ndx/` one. Nothing
 * here spells a file name; every read asks `resolveLayout`.
 */

import { readFile, access } from "node:fs/promises";
import { projectRootOf, relativeToRoot, resolveLayout } from "./layout.js";

const LEGACY_LAYOUT = resolveLayout(".", { mode: "legacy" });

/**
 * The project config file's name on the **legacy** layout, for messages and
 * labels only. It is not where a reader looks: a `.ndx/` project keeps the
 * file at `.ndx/config.json`, which only {@link resolveLayout} can say.
 */
export const PROJECT_CONFIG_FILE = relativeToRoot(LEGACY_LAYOUT, LEGACY_LAYOUT.configFile);
/** The machine-local config file's name on the legacy layout; see {@link PROJECT_CONFIG_FILE}. */
export const LOCAL_CONFIG_FILE = relativeToRoot(LEGACY_LAYOUT, LEGACY_LAYOUT.localConfigFile);

/**
 * Deep merge source into target. Source values take precedence.
 * Arrays are replaced (not concatenated). Objects are recursively merged.
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * Load and parse a JSON config file. Returns null if the file doesn't exist
 * or contains invalid JSON.
 */
async function loadJSONFile(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return null;
}

/** One file's contribution to a package's project-level overrides. */
export interface ProjectOverrideSource {
  /**
   * File the section was read from, relative to the project root: `.n-dx.json`
   * or `.n-dx.local.json` on the legacy layout, `.ndx/config.json` or
   * `.ndx/config.local.json` on the `.ndx/` one.
   */
  file: string;
  /** The package-scoped section (e.g., the "rex" key) as written in that file. */
  data: Record<string, unknown>;
}

/**
 * Load a package's override section from the project config file and its
 * machine-local overlay separately, without merging them — so a caller that
 * needs to blame a specific file for an invalid value (rather than just apply
 * the merged result) can tell which file a key came from. Only files that
 * actually declare a non-empty section for `packageKey` are included, in
 * precedence order (the shared file first, the local overlay last — later
 * entries win, as in {@link loadProjectOverrides}).
 *
 * @param configDir The package's state directory (`/project/.rex` or
 *                  `/project/.ndx/rex`); the project root is recovered from it.
 * @param packageKey The key to extract (e.g., "rex")
 */
export async function loadProjectOverrideSources(
  configDir: string,
  packageKey: string,
): Promise<ProjectOverrideSource[]> {
  const layout = resolveLayout(projectRootOf(configDir));
  const projectData = await loadJSONFile(layout.configFile);
  const localData = await loadJSONFile(layout.localConfigFile);

  const sources: ProjectOverrideSource[] = [];
  if (projectData && projectData[packageKey]) {
    sources.push({ file: relativeToRoot(layout, layout.configFile), data: projectData[packageKey] as Record<string, unknown> });
  }
  if (localData && localData[packageKey]) {
    sources.push({ file: relativeToRoot(layout, layout.localConfigFile), data: localData[packageKey] as Record<string, unknown> });
  }
  return sources;
}

/**
 * Load project-level overrides for a specific package, merging the project
 * config file with its machine-local overlay (local wins).
 *
 * Returns the package-scoped section (e.g., the "rex" key) or an empty object.
 *
 * @param configDir The package config directory (e.g., /project/.rex)
 * @param packageKey The key to extract (e.g., "rex")
 */
export async function loadProjectOverrides(
  configDir: string,
  packageKey: string,
): Promise<Record<string, unknown>> {
  const sources = await loadProjectOverrideSources(configDir, packageKey);
  return sources.reduce(
    (merged, source) => deepMerge(merged, source.data),
    {} as Record<string, unknown>,
  );
}

/**
 * Merge project-level overrides into a package config.
 * Project config (.n-dx.json) takes precedence over package config.
 */
export function mergeWithOverrides<T>(
  config: T,
  overrides: Record<string, unknown>,
): T {
  if (Object.keys(overrides).length === 0) return config;
  return deepMerge(
    config as unknown as Record<string, unknown>,
    overrides,
  ) as unknown as T;
}
