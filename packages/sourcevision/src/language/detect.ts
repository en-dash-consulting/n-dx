/**
 * Language auto-detection.
 *
 * Implements a five-step detection chain to determine the primary project
 * language. The result drives all downstream analyzer decisions.
 *
 * Detection order:
 * 1. Explicit override in `.n-dx.json` (`"language": "go"`)
 * 2. Presence of `go.mod` → Go
 * 3. Presence of `package.json` → TypeScript/JS
 * 4. File-count tiebreak (both markers present) → whichever has more source files
 * 5. Fallback → TypeScript/JS (backward-compatible default)
 *
 * @module sourcevision/language/detect
 */

import { readFile, readdir, access } from "node:fs/promises";
import { join, extname } from "node:path";
import type { LanguageConfig } from "./registry.js";
import { typescriptConfig } from "./typescript.js";
import { goConfig } from "./go.js";

// ── Config registry ─────────────────────────────────────────────────────────

const LANGUAGE_CONFIGS: ReadonlyMap<string, LanguageConfig> = new Map([
  ["go", goConfig],
  ["typescript", typescriptConfig],
  ["javascript", typescriptConfig],
]);

/**
 * Look up a language config by id. Returns `undefined` for unknown ids.
 */
export function getLanguageConfig(id: string): LanguageConfig | undefined {
  return LANGUAGE_CONFIGS.get(id);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the `.n-dx.json` language override, if present.
 * Returns the language id string or `undefined` if not set.
 */
async function readConfigOverride(rootDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(rootDir, ".n-dx.json"), "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (typeof config.language === "string" && config.language !== "auto") {
      return config.language;
    }
  } catch {
    // File doesn't exist or is invalid — no override
  }
  return undefined;
}

/**
 * Count source files by language family in the top two directory levels.
 * Performs a shallow scan (not a full recursive walk) for speed.
 */
async function countSourceFiles(rootDir: string): Promise<{ go: number; ts: number }> {
  let go = 0;
  let ts = 0;

  const goExts = goConfig.extensions;
  const tsExts = typescriptConfig.extensions;

  // Scan root + one level of subdirectories
  const dirsToScan = [rootDir];

  try {
    const topEntries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of topEntries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "vendor") {
        dirsToScan.push(join(rootDir, entry.name));
      }
    }
  } catch {
    // Can't read root — return zeros
    return { go, ts };
  }

  for (const dir of dirsToScan) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = extname(entry.name);
        if (goExts.has(ext)) go++;
        if (tsExts.has(ext)) ts++;
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return { go, ts };
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Detect the primary project language.
 *
 * Five-step chain:
 * 1. `.n-dx.json` override
 * 2. `go.mod` present (and no `package.json`) → Go
 * 3. `package.json` present (and no `go.mod`) → TypeScript/JS
 * 4. Both present → file-count tiebreak
 * 5. Neither present → TypeScript/JS fallback
 */
export async function detectLanguage(rootDir: string): Promise<LanguageConfig> {
  // Step 1: Explicit override in .n-dx.json
  const override = await readConfigOverride(rootDir);
  if (override) {
    const config = getLanguageConfig(override);
    if (config) return config;
    // Unknown language id — fall through to auto-detection
  }

  // Step 2 & 3: Check for language markers
  const [hasGoMod, hasPackageJson] = await Promise.all([
    fileExists(join(rootDir, "go.mod")),
    fileExists(join(rootDir, "package.json")),
  ]);

  // Only go.mod → Go
  if (hasGoMod && !hasPackageJson) {
    return goConfig;
  }

  // Only package.json → TypeScript/JS
  if (hasPackageJson && !hasGoMod) {
    return typescriptConfig;
  }

  // Step 4: Both markers present → file-count tiebreak
  if (hasGoMod && hasPackageJson) {
    const counts = await countSourceFiles(rootDir);
    if (counts.go > counts.ts) {
      return goConfig;
    }
    // Equal or TS wins → TypeScript (preserves backward compatibility)
    return typescriptConfig;
  }

  // Step 5: No markers → fallback to TypeScript/JS
  return typescriptConfig;
}
