import { join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { configExists, ensureHenchDir, initConfig } from "../../store/config.js";
import { HENCH_DIR } from "./constants.js";
import { info } from "../output.js";
import type { ProjectLanguage } from "../../schema/index.js";

/**
 * Detect the project language for guard configuration.
 *
 * Detection chain (mirrors sourcevision's logic without importing it):
 * 1. Explicit `.n-dx.json` `language` override
 * 2. `go.mod` present → "go"
 * 3. Otherwise → undefined (JS/TS defaults)
 */
async function detectProjectLanguage(dir: string): Promise<ProjectLanguage | undefined> {
  // Step 1: Check .n-dx.json for explicit language override
  try {
    const raw = await readFile(join(dir, ".n-dx.json"), "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (typeof config.language === "string" && config.language !== "auto") {
      const lang = config.language;
      if (lang === "go" || lang === "typescript" || lang === "javascript") {
        return lang;
      }
    }
  } catch {
    // No .n-dx.json or invalid — continue detection
  }

  // Step 2: Check for go.mod marker
  try {
    await access(join(dir, "go.mod"));
    return "go";
  } catch {
    // No go.mod — fall through to JS/TS defaults
  }

  return undefined;
}

export async function cmdInit(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);

  if (await configExists(henchDir)) {
    info(".hench/ already initialized, skipping");
    return;
  }

  const language = await detectProjectLanguage(dir);
  const config = await initConfig(henchDir, language);

  info("Created .hench/config.json");
  info("Created .hench/runs/");
  if (language) {
    info(`Detected language: ${language}`);
  }
  info(`\nInitialized .hench/ in ${dir}`);
  info(`Model: ${config.model}`);
  info(`Max turns: ${config.maxTurns}`);
  info(`Rex dir: ${config.rexDir}`);
  info("\nNext steps:");
  info("  hench run " + dir);
  info("  hench status " + dir);
}
