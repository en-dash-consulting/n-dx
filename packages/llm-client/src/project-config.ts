/**
 * Project-level configuration utilities shared across packages.
 *
 * Handles loading .n-dx.json overrides and deep-merging them into
 * package-specific configs. Previously duplicated identically in
 * both rex and hench.
 */

import { dirname, join } from "node:path";
import { readFile, access } from "node:fs/promises";

const PROJECT_CONFIG_FILE = ".n-dx.json";
const LOCAL_CONFIG_FILE = ".n-dx.local.json";

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

/**
 * Load project-level overrides for a specific package, merging
 * .n-dx.json with .n-dx.local.json (local wins).
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
  const projectDir = dirname(configDir);
  const projectData = await loadJSONFile(join(projectDir, PROJECT_CONFIG_FILE));
  const localData = await loadJSONFile(join(projectDir, LOCAL_CONFIG_FILE));

  // Merge project and local configs (local wins)
  let merged: Record<string, unknown> | null = projectData;
  if (projectData && localData) {
    merged = deepMerge(projectData, localData);
  } else if (localData) {
    merged = localData;
  }

  if (merged && merged[packageKey]) {
    return merged[packageKey] as Record<string, unknown>;
  }
  return {};
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
