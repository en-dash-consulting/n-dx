import { dirname, join } from "node:path";
import { readFile, access } from "node:fs/promises";

const PROJECT_CONFIG_FILE = ".n-dx.json";

/**
 * Deep merge source into target. Source values take precedence.
 * Arrays are replaced (not concatenated). Objects are recursively merged.
 */
function deepMerge(
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
 * Load project-level .n-dx.json overrides for a specific package.
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
  const configPath = join(projectDir, PROJECT_CONFIG_FILE);
  try {
    await access(configPath);
    const raw = await readFile(configPath, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && data[packageKey]) {
      return data[packageKey] as Record<string, unknown>;
    }
  } catch {
    // File doesn't exist or is invalid — no overrides
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
