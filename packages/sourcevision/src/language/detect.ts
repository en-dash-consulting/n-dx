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
 * Multi-language detection (`detectLanguages`) returns ALL detected language
 * configs rather than picking a winner. `mergeLanguageConfigs` combines
 * multiple configs into a single unified config for downstream analyzers.
 *
 * @module sourcevision/language/detect
 */

import { readFile, readdir, access } from "node:fs/promises";
import { join, extname } from "node:path";
import type { LanguageConfig } from "./registry.js";
import { typescriptConfig } from "./typescript.js";
import { goConfig } from "./go.js";
import { swiftConfig } from "./swift.js";

// ── Config registry ─────────────────────────────────────────────────────────

const LANGUAGE_CONFIGS: ReadonlyMap<string, LanguageConfig> = new Map([
  ["go", goConfig],
  ["swift", swiftConfig],
  ["typescript", typescriptConfig],
  ["javascript", typescriptConfig],
]);

/**
 * Valid language identifiers accepted by the `.n-dx.json` `language` field.
 * Includes `"auto"` which triggers marker-based detection.
 */
export const VALID_LANGUAGE_IDS: readonly string[] = ["typescript", "javascript", "go", "swift", "auto"] as const;

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
 * Tiebreak ordering when multiple language markers report identical source
 * counts: TypeScript wins over Swift wins over Go. This preserves the legacy
 * "TS wins go.mod+package.json tie" behavior while still giving Swift a
 * sensible priority over Go on a mixed Swift+Go repo with no source files.
 */
function tiebreakRank(config: LanguageConfig): number {
  if (config === typescriptConfig) return 0;
  if (config === swiftConfig) return 1;
  return 2;
}

/**
 * Swift marker present? Either `Package.swift` at the root or any top-level
 * `*.xcodeproj` / `*.xcworkspace` directory. App + library targets typically
 * have one or the other (often both).
 */
async function hasSwiftMarker(rootDir: string): Promise<boolean> {
  if (await fileExists(join(rootDir, "Package.swift"))) return true;
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.endsWith(".xcodeproj") || e.name.endsWith(".xcworkspace")) return true;
    }
  } catch {
    // Unreadable — no marker.
  }
  return false;
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
async function countSourceFiles(rootDir: string): Promise<{ go: number; ts: number; swift: number }> {
  let go = 0;
  let ts = 0;
  let swift = 0;

  const goExts = goConfig.extensions;
  const tsExts = typescriptConfig.extensions;
  const swiftExts = swiftConfig.extensions;

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
    return { go, ts, swift };
  }

  for (const dir of dirsToScan) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = extname(entry.name);
        if (goExts.has(ext)) go++;
        if (tsExts.has(ext)) ts++;
        if (swiftExts.has(ext)) swift++;
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return { go, ts, swift };
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
  const [hasGoMod, hasPackageJson, hasSwift] = await Promise.all([
    fileExists(join(rootDir, "go.mod")),
    fileExists(join(rootDir, "package.json")),
    hasSwiftMarker(rootDir),
  ]);

  // Single-marker fast paths.
  if (hasGoMod && !hasPackageJson && !hasSwift) return goConfig;
  if (hasSwift && !hasGoMod && !hasPackageJson) return swiftConfig;
  if (hasPackageJson && !hasGoMod && !hasSwift) return typescriptConfig;

  // Step 4: Multiple markers present — file-count tiebreak picks primary.
  if (hasGoMod || hasPackageJson || hasSwift) {
    const counts = await countSourceFiles(rootDir);
    const candidates: Array<[number, LanguageConfig]> = [];
    if (hasGoMod) candidates.push([counts.go, goConfig]);
    if (hasSwift) candidates.push([counts.swift, swiftConfig]);
    if (hasPackageJson) candidates.push([counts.ts, typescriptConfig]);
    candidates.sort((a, b) => {
      if (a[0] !== b[0]) return b[0] - a[0];
      return tiebreakRank(a[1]) - tiebreakRank(b[1]);
    });
    return candidates[0][1] ?? typescriptConfig;
  }

  // Step 5: No markers → fallback to TypeScript/JS
  return typescriptConfig;
}

// ── Multi-language detection ─────────────────────────────────────────────────

/**
 * Detect ALL languages present in a project.
 *
 * Unlike `detectLanguage` (which picks a single winner), this returns every
 * language config whose marker file is present. When both `go.mod` and
 * `package.json` exist, both Go and TypeScript configs are returned.
 *
 * The primary language (from `detectLanguage`) is always first in the array.
 *
 * Returns at least one config — TypeScript/JS as the fallback default.
 */
export async function detectLanguages(rootDir: string): Promise<LanguageConfig[]> {
  // Check for language markers (Swift adds Package.swift / .xcodeproj /
  // .xcworkspace; only one needs to be present).
  const [hasGoMod, hasPackageJson, hasSwift] = await Promise.all([
    fileExists(join(rootDir, "go.mod")),
    fileExists(join(rootDir, "package.json")),
    hasSwiftMarker(rootDir),
  ]);

  const present: Array<{ config: LanguageConfig; count: number }> = [];

  // When any markers are present, count source files so we can order by
  // primary. countSourceFiles is cheap (shallow scan).
  if (hasGoMod || hasPackageJson || hasSwift) {
    const counts = await countSourceFiles(rootDir);
    if (hasGoMod) present.push({ config: goConfig, count: counts.go });
    if (hasSwift) present.push({ config: swiftConfig, count: counts.swift });
    if (hasPackageJson) present.push({ config: typescriptConfig, count: counts.ts });
  }

  // No markers → fallback to TypeScript/JS for backward compatibility.
  if (present.length === 0) {
    return [typescriptConfig];
  }

  // Stable ordering by descending file count, ties broken by the same
  // TS > Swift > Go preference detectLanguage uses.
  present.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return tiebreakRank(a.config) - tiebreakRank(b.config);
  });
  return present.map((p) => p.config);
}

/**
 * Merge multiple language configs into a single unified config.
 *
 * The first config in the array is treated as the primary (its `id` and
 * `displayName` are used). All other fields are unioned:
 * - `extensions`: union of all extensions
 * - `parseableExtensions`: union of all parseable extensions
 * - `testFilePatterns`: concatenation of all patterns
 * - `configFilenames`: union of all config filenames
 * - `skipDirectories`: union of all skip directories
 * - `generatedFilePatterns`: concatenation of all patterns
 * - `entryPointPatterns`: concatenation of all patterns
 * - `moduleFile`: from the primary config
 */
export function mergeLanguageConfigs(configs: LanguageConfig[]): LanguageConfig {
  if (configs.length === 0) {
    return typescriptConfig;
  }
  if (configs.length === 1) {
    return configs[0];
  }

  const primary = configs[0];

  const extensions = new Set<string>();
  const parseableExtensions = new Set<string>();
  const testFilePatterns: RegExp[] = [];
  const configFilenames = new Set<string>();
  const skipDirectories = new Set<string>();
  const generatedFilePatterns: RegExp[] = [];
  const entryPointPatterns: RegExp[] = [];

  for (const config of configs) {
    for (const ext of config.extensions) extensions.add(ext);
    for (const ext of config.parseableExtensions) parseableExtensions.add(ext);
    for (const p of config.testFilePatterns) testFilePatterns.push(p);
    for (const f of config.configFilenames) configFilenames.add(f);
    for (const d of config.skipDirectories) skipDirectories.add(d);
    for (const p of config.generatedFilePatterns) generatedFilePatterns.push(p);
    for (const p of config.entryPointPatterns) entryPointPatterns.push(p);
  }

  return {
    id: primary.id,
    displayName: primary.displayName,
    extensions,
    parseableExtensions,
    testFilePatterns,
    configFilenames,
    skipDirectories,
    generatedFilePatterns,
    entryPointPatterns,
    moduleFile: primary.moduleFile,
  };
}
