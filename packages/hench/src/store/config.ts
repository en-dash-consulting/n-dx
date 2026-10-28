import { join } from "node:path";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import {
  validateConfig,
  formatValidationErrors,
  formatFieldIssues,
  revertInvalidFields,
  DEFAULT_HENCH_CONFIG,
} from "../schema/index.js";
import { toCanonicalJSON } from "../prd/llm-gateway.js";
import { loadProjectOverrideSources, mergeWithOverrides } from "./project-config.js";
import type { ProjectOverrideSource } from "./project-config.js";
import type { HenchConfig, ProjectLanguage } from "../schema/index.js";

/**
 * The top-level hench keys written in `.hench/config.json` or a project
 * override (`.n-dx.json` / `.n-dx.local.json` `hench` section), as opposed to
 * filled in by schema defaults during {@link loadConfig}. Lets a caller say a
 * value came from `hench.<key>` rather than being built in.
 */
export async function loadConfiguredHenchKeys(henchDir: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const data: unknown = JSON.parse(await readFile(join(henchDir, "config.json"), "utf-8"));
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const key of Object.keys(data)) keys.add(key);
  }
  for (const source of await loadProjectOverrideSources(henchDir, "hench")) {
    for (const key of Object.keys(source.data)) keys.add(key);
  }
  return keys;
}

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
 * default and re-validate. Thin wrapper over {@link revertInvalidFields} with
 * the schema defaults as the fallback — this is the `.hench/config.json`
 * salvage case; {@link loadConfig}'s override-validation step below falls
 * back to the already-validated base config instead.
 */
function salvageConfig(
  data: Record<string, unknown>,
  issues: Array<{ path: Array<PropertyKey> }>,
): { config: HenchConfig; replacedFields: string[] } | null {
  return revertInvalidFields(data, issues, DEFAULT_HENCH_CONFIG() as unknown as Record<string, unknown>);
}

/** The top-level field names a set of validation issues implicates, sorted. */
function topLevelKeys(issues: Array<{ path: Array<PropertyKey> }>): string[] {
  const keys = new Set<string>();
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && key.length > 0) keys.add(key);
  }
  return [...keys].sort();
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

  // Merge project-level .n-dx.json / .n-dx.local.json overrides (project
  // config takes precedence). These files skip HenchConfigSchema entirely on
  // the way in — unlike .hench/config.json above, nothing here validates a
  // single field as it's written — so each layer's result is re-validated.
  // An invalid override field reverts to its value in the layer below (or
  // the schema default when that layer doesn't carry it), with a warning
  // naming the field and the file it came from. Layer by layer, so an invalid
  // local value cannot resurrect a `.hench/config.json` value that
  // `.n-dx.json` replaced: the repository-trust review folds the layers the
  // same way (llm-client `repo-trust.ts`), and the two must agree on the
  // guard that runs. Unlike an invalid .hench/config.json, this never throws
  // regardless of `options.onInvalid`: a stray project override must not
  // stop a run.
  const overrideSources = await loadProjectOverrideSources(henchDir, "hench");
  return overrideSources.reduce((lower, source) => applyOverrideLayer(lower, source, options), config);
}

function applyOverrideLayer(
  lower: HenchConfig,
  source: ProjectOverrideSource,
  options: LoadConfigOptions,
): HenchConfig {
  const merged = mergeWithOverrides(lower, source.data);
  const mergedResult = validateConfig(merged);
  if (mergedResult.ok) return merged;

  const repaired = revertInvalidFields(
    merged as unknown as Record<string, unknown>,
    mergedResult.errors.issues,
    lower as unknown as Record<string, unknown>,
  );
  const badKeys = repaired ? repaired.replacedFields : topLevelKeys(mergedResult.errors.issues);
  for (const key of badKeys) {
    const detail = formatFieldIssues(mergedResult.errors.issues, key);
    options.onWarning?.(
      `Invalid hench.${key} in ${source.file} — keeping the current config value. (${detail})`,
    );
  }
  // `candidate`, not the parsed config: the success path above returns the
  // merged object unparsed, and HenchConfig carries fields the schema does
  // not declare (skipFullTestGate, planOnlyMaxRetries, selfHeal). Returning
  // the parsed config here would let one invalid field silently discard every
  // valid override of those — a loss no warning above mentions, and one that
  // would depend on whether some unrelated field happened to be valid.
  return repaired ? (repaired.candidate as unknown as HenchConfig) : lower;
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

/**
 * Write a fresh `config.json` into `henchDir`.
 *
 * `rexDir` is passed in rather than left at {@link DEFAULT_HENCH_CONFIG}'s
 * value because that default is `.rex` — the right answer on the legacy layout
 * and the wrong one on a project that keeps its PRD in `.ndx/rex`, where every
 * run would then look for the PRD in a directory that does not exist. The
 * default has to stay as it is (it is public API, and a function with no
 * project root cannot resolve a layout), so the caller that *does* know the
 * root supplies it.
 */
export async function initConfig(
  henchDir: string,
  language?: ProjectLanguage,
  rexDir?: string,
): Promise<HenchConfig> {
  await ensureHenchDir(henchDir);
  const config = DEFAULT_HENCH_CONFIG(language);
  if (rexDir) config.rexDir = rexDir;
  await saveConfig(henchDir, config);
  return config;
}
