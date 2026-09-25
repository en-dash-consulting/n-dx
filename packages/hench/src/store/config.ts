import { join } from "node:path";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { validateConfig, formatValidationErrors, DEFAULT_HENCH_CONFIG } from "../schema/index.js";
import { toCanonicalJSON } from "../prd/llm-gateway.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import type { HenchConfig, ProjectLanguage } from "../schema/index.js";

export async function ensureHenchDir(henchDir: string): Promise<void> {
  await mkdir(henchDir, { recursive: true });
  await mkdir(join(henchDir, "runs"), { recursive: true });
}

export interface LoadConfigOptions {
  /**
   * What to do when the file parses as JSON but fails schema validation:
   * - "throw" (default): refuse the whole file.
   * - "use-defaults": replace each invalid top-level field with its
   *   `DEFAULT_HENCH_CONFIG()` value (or drop it, for optional fields the
   *   defaults don't carry) and continue. Still throws when the file cannot
   *   be salvaged that way, and always for JSON syntax errors.
   */
  onInvalid?: "throw" | "use-defaults";
  /** Called with one message describing what was replaced, when salvage occurs. */
  onWarning?: (message: string) => void;
}

/**
 * Replace every top-level field implicated in a validation failure with its
 * default and re-validate. Returns the salvaged config and the field names
 * that were replaced, or null when the document is beyond this repair (not an
 * object, or the failure isn't attributable to specific fields).
 */
function salvageConfig(
  data: Record<string, unknown>,
  issues: Array<{ path: Array<string | number> }>,
): { config: HenchConfig; replacedFields: string[] } | null {
  const defaults = DEFAULT_HENCH_CONFIG() as unknown as Record<string, unknown>;
  const badKeys = new Set<string>();
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && key.length > 0) badKeys.add(key);
  }
  if (badKeys.size === 0) return null;

  const candidate: Record<string, unknown> = { ...data };
  for (const key of badKeys) {
    if (key in defaults) candidate[key] = defaults[key];
    else delete candidate[key];
  }
  const result = validateConfig(candidate);
  if (!result.ok) return null;
  return { config: result.data as HenchConfig, replacedFields: [...badKeys].sort() };
}

export async function loadConfig(
  henchDir: string,
  options: LoadConfigOptions = {},
): Promise<HenchConfig> {
  const configPath = join(henchDir, "config.json");
  const raw = await readFile(configPath, "utf-8");
  const data = JSON.parse(raw);
  const result = validateConfig(data);
  let config: HenchConfig;
  if (result.ok) {
    config = result.data as HenchConfig;
  } else {
    const detail = formatValidationErrors(result.errors).join("; ");
    const salvaged =
      options.onInvalid === "use-defaults" && data && typeof data === "object" && !Array.isArray(data)
        ? salvageConfig(data as Record<string, unknown>, result.errors.issues)
        : null;
    if (!salvaged) {
      throw new Error(`Invalid hench config: ${detail}`);
    }
    options.onWarning?.(
      `Invalid value(s) in .hench/config.json — using defaults for ${salvaged.replacedFields.join(", ")}. (${detail})`,
    );
    config = salvaged.config;
  }

  // Merge project-level .n-dx.json overrides (project config takes precedence)
  const overrides = await loadProjectOverrides(henchDir, "hench");
  return mergeWithOverrides(config, overrides);
}

export async function saveConfig(
  henchDir: string,
  config: HenchConfig,
): Promise<void> {
  const configPath = join(henchDir, "config.json");
  await writeFile(configPath, toCanonicalJSON(config), "utf-8");
}

export async function configExists(henchDir: string): Promise<boolean> {
  try {
    await access(join(henchDir, "config.json"));
    return true;
  } catch {
    return false;
  }
}

export async function initConfig(henchDir: string, language?: ProjectLanguage): Promise<HenchConfig> {
  await ensureHenchDir(henchDir);
  const config = DEFAULT_HENCH_CONFIG(language);
  await saveConfig(henchDir, config);
  return config;
}
