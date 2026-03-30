import { join } from "node:path";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { validateConfig, DEFAULT_HENCH_CONFIG } from "../schema/index.js";
import { toCanonicalJSON } from "./json.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import type { HenchConfig, ProjectLanguage } from "../schema/index.js";

export async function ensureHenchDir(henchDir: string): Promise<void> {
  await mkdir(henchDir, { recursive: true });
  await mkdir(join(henchDir, "runs"), { recursive: true });
}

export async function loadConfig(henchDir: string): Promise<HenchConfig> {
  const configPath = join(henchDir, "config.json");
  const raw = await readFile(configPath, "utf-8");
  const data = JSON.parse(raw);
  const result = validateConfig(data);
  if (!result.ok) {
    throw new Error(`Invalid hench config: ${result.errors.message}`);
  }

  // Merge project-level .n-dx.json overrides (project config takes precedence)
  const overrides = await loadProjectOverrides(henchDir, "hench");
  return mergeWithOverrides(result.data as HenchConfig, overrides);
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
