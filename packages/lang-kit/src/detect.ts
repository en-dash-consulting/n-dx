/**
 * Language auto-detection.
 *
 * Implements a four-step detection chain to determine the primary project
 * language. The result drives all downstream analyzer decisions.
 *
 * Detection order:
 * 1. Explicit override (`options.override`; the caller reads it from config)
 * 2. Single language marker present → that language
 *    (`go.mod` → Go, `package.json` → TS/JS, `Package.swift`/`*.xcodeproj` → Swift,
 *     `pyproject.toml`/`setup.py`/`requirements.txt`/`Pipfile` → Python,
 *     `*.sln`/`*.csproj` within three levels of the root → C#)
 * 3. Multiple markers present → file-count tiebreak (whichever has more source files)
 * 4. No other marker, `pom.xml` or a Gradle build at the root → Java
 * 5. Fallback → TypeScript/JS (backward-compatible default)
 *
 * Multi-language detection (`detectLanguages`) returns ALL detected language
 * configs rather than picking a winner. `mergeLanguageConfigs` combines
 * multiple configs into a single unified config for downstream analyzers.
 *
 * Nothing here reads config or walks the tree: the override and the
 * Terraform search arrive as options, so the caller owns both.
 *
 * @module lang-kit/detect
 */

import { readdir, access } from "node:fs/promises";
import { join, extname } from "node:path";
import type { GeneratedHeaderRule, LanguageConfig } from "./registry.js";
import { typescriptConfig } from "./typescript.js";
import { goConfig } from "./go.js";
import { swiftConfig } from "./swift.js";
import { pythonConfig } from "./python.js";
import { javaConfig, javaSecondaryConfig } from "./java.js";
import { terraformConfig } from "./terraform.js";
import { csharpConfig } from "./csharp.js";

// ── Config registry ─────────────────────────────────────────────────────────

const LANGUAGE_CONFIGS: ReadonlyMap<string, LanguageConfig> = new Map([
  ["go", goConfig],
  ["swift", swiftConfig],
  ["python", pythonConfig],
  ["java", javaConfig],
  ["terraform", terraformConfig],
  ["csharp", csharpConfig],
  ["typescript", typescriptConfig],
  ["javascript", typescriptConfig],
]);

/**
 * Rebuild the configs `detectLanguages` returned from the ids persisted in
 * `manifest.languages` (primary first). Java after the first id gets the
 * secondary variant, as it did at detection. Unknown ids are dropped.
 */
export function languageConfigsFromIds(ids: readonly string[]): LanguageConfig[] {
  const configs: LanguageConfig[] = [];
  ids.forEach((id, i) => {
    const config = i > 0 && id === "java" ? javaSecondaryConfig : getLanguageConfig(id);
    if (config) configs.push(config);
  });
  return configs;
}

/**
 * Valid language identifiers accepted by the project config's `language` field.
 * Includes `"auto"` which triggers marker-based detection.
 */
export const VALID_LANGUAGE_IDS: readonly string[] = ["typescript", "javascript", "go", "swift", "python", "csharp", "java", "auto"] as const;

/**
 * Look up a language config by id. Returns `undefined` for unknown ids.
 */
export function getLanguageConfig(id: string): LanguageConfig | undefined {
  return LANGUAGE_CONFIGS.get(id);
}

// ── Detection options ───────────────────────────────────────────────────────

/** What a {@link ProjectFileSearch} found. */
export interface ProjectFileCounts {
  /** Files `isTerraformFile` accepts. */
  terraform: number;
  /** Files {@link isFallbackSourceFile} accepts; 0 unless counted. */
  fallbackSource: number;
}

/**
 * Search the project's files as the inventory would walk them with
 * `otherConfigs` and Terraform beside them: `otherConfigs` are the languages
 * detected without Terraform, so the caller builds the inventory's skip set
 * and ignore filter from them. With `count` false it only needs to know
 * whether a Terraform file exists, and should stop at the first one; with
 * `count` true it counts both kinds of file over the whole walk. An
 * unreadable root counts nothing.
 */
export type ProjectFileSearch = (
  otherConfigs: readonly LanguageConfig[],
  options: { count: boolean },
) => Promise<ProjectFileCounts>;

/** What `detectLanguages` needs from its caller. */
export interface DetectLanguagesOptions {
  /** The project file search; called at most once per detection. */
  searchProjectFiles: ProjectFileSearch;
}

/** What `detectLanguage` needs from its caller. */
export interface DetectLanguageOptions extends DetectLanguagesOptions {
  /**
   * The project's language override (a language id), already read from
   * config. `undefined` or an unknown id means auto-detect.
   */
  override?: string;
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
  if (config === goConfig) return 2;
  if (config === csharpConfig) return 3;
  return 4;
}

/**
 * Python marker present? Any of the canonical project manifests at the root.
 */
async function hasPythonMarker(rootDir: string): Promise<boolean> {
  const markers = ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"];
  for (const m of markers) {
    if (await fileExists(join(rootDir, m))) return true;
  }
  return false;
}

/**
 * Java marker present? A Maven `pom.xml` or a Gradle build/settings file at
 * the root. `detectLanguage` consults it only when no other marker matched;
 * `detectLanguages` adds Java whenever it is present.
 */
async function hasJavaMarker(rootDir: string): Promise<boolean> {
  const markers = ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];
  for (const m of markers) {
    if (await fileExists(join(rootDir, m))) return true;
  }
  return false;
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
 * C# marker present? A `*.sln` or `*.csproj` anywhere the source-count scan
 * reaches: solutions often sit in a `Code/` or `src/` folder rather than at
 * the root, and a project's `.csproj` sits beside its code.
 */
async function hasCSharpMarker(rootDir: string): Promise<boolean> {
  let found = false;
  await walkBounded(rootDir, (name) => {
    if (name.endsWith(".sln") || name.endsWith(".csproj")) found = true;
    return found;
  });
  return found;
}

/** Directories the language tiebreak never counts: dependencies and build output. */
const COUNT_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules", "vendor", "venv", "site-packages", "bin", "obj", "dist", "build",
]);

/** How deep the tiebreak scan descends below the root, and how many directories it reads. */
const COUNT_MAX_DEPTH = 3;
const COUNT_MAX_DIRS = 2000;

/**
 * Breadth-first walk of the files under `rootDir`, down to
 * {@link COUNT_MAX_DEPTH} levels and at most {@link COUNT_MAX_DIRS}
 * directories, skipping dot-directories and {@link COUNT_SKIP_DIRS}. `visit`
 * gets each file name and returns true to stop the walk.
 */
async function walkBounded(rootDir: string, visit: (fileName: string) => boolean): Promise<void> {
  let queue: string[] = [rootDir];
  let read = 0;
  for (let depth = 0; depth <= COUNT_MAX_DEPTH && queue.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of queue) {
      if (read++ >= COUNT_MAX_DIRS) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue; // Unreadable directory
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && !COUNT_SKIP_DIRS.has(entry.name)) next.push(join(dir, entry.name));
        } else if (entry.isFile() && visit(entry.name)) {
          return;
        }
      }
    }
    queue = next;
  }
}

/**
 * Count authored source files by language family, down to three levels below
 * the root. Deep enough that a solution whose code sits in
 * `src/<Project>/<Folder>/` is weighed by that code, not by the root's
 * tooling scripts; bounded so detection stays cheap on a large tree.
 * Minified JavaScript is library code, not authored code, and is not counted.
 */
async function countSourceFiles(
  rootDir: string,
): Promise<{ go: number; ts: number; swift: number; py: number; cs: number }> {
  const counts = { go: 0, ts: 0, swift: 0, py: 0, cs: 0 };
  const families: Array<[keyof typeof counts, ReadonlySet<string>]> = [
    ["go", goConfig.extensions],
    ["ts", typescriptConfig.extensions],
    ["swift", swiftConfig.extensions],
    ["py", pythonConfig.extensions],
    ["cs", csharpConfig.extensions],
  ];
  await walkBounded(rootDir, (name) => {
    if (name.endsWith(".min.js")) return false;
    const ext = extname(name);
    for (const [family, exts] of families) if (exts.has(ext)) counts[family]++;
    return false;
  });
  return counts;
}

/**
 * Program-code extensions of languages with no config here (Ruby, Rust, PHP,
 * Elixir, Kotlin, C/C++ and others). A markerless repository in one of them
 * is analysed with the TypeScript fallback config.
 */
const FALLBACK_LANGUAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".rb", ".rs", ".php", ".ex", ".exs", ".erl", ".hrl", ".scala", ".kt", ".kts",
  ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".lua", ".dart", ".hs", ".ml",
  ".mli", ".clj", ".cljs", ".zig", ".nim", ".pl", ".pm", ".r", ".R",
]);

/**
 * Is `fileName` source the TypeScript fallback is for: authored JS/TS (not
 * minified), or a language with no config here? A markerless repository
 * with any of these keeps the fallback primary, however many Terraform
 * files it has.
 */
export function isFallbackSourceFile(fileName: string): boolean {
  if (fileName.endsWith(".min.js")) return false;
  const ext = extname(fileName);
  return typescriptConfig.extensions.has(ext) || FALLBACK_LANGUAGE_EXTENSIONS.has(ext);
}

/**
 * Is a markerless repository Terraform alone? Only when it has Terraform
 * files and no fallback source at all; counts are not weighed. With any
 * fallback source, Terraform joins the fallback, which stays primary and
 * keeps its skip directories and its test and generated patterns.
 */
function isTerraformOnly(counts: ProjectFileCounts): boolean {
  return counts.terraform > 0 && counts.fallbackSource === 0;
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Detect the primary project language.
 *
 * Five-step chain:
 * 1. `options.override`
 * 2. Exactly one language marker present → that language
 * 3. Several markers present → file-count tiebreak
 * 4. No other marker, `pom.xml` or a Gradle build at the root → Java
 * 5. No markers → TypeScript/JS fallback (Terraform when the repository
 *    has Terraform files and no source the fallback is for)
 */
export async function detectLanguage(rootDir: string, options: DetectLanguageOptions): Promise<LanguageConfig> {
  // Step 1: Explicit override
  const { override } = options;
  if (override) {
    const config = getLanguageConfig(override);
    if (config) return config;
    // Unknown language id — fall through to auto-detection
  }

  // Step 2 & 3: Check for language markers
  const [hasGoMod, hasPackageJson, hasSwift, hasPython, hasCSharp] = await Promise.all([
    fileExists(join(rootDir, "go.mod")),
    fileExists(join(rootDir, "package.json")),
    hasSwiftMarker(rootDir),
    hasPythonMarker(rootDir),
    hasCSharpMarker(rootDir),
  ]);

  // Single-marker fast path.
  const markers = [hasGoMod, hasPackageJson, hasSwift, hasPython, hasCSharp].filter(Boolean).length;
  if (markers === 1) {
    if (hasGoMod) return goConfig;
    if (hasSwift) return swiftConfig;
    if (hasPython) return pythonConfig;
    if (hasCSharp) return csharpConfig;
    return typescriptConfig;
  }

  // Step 4: Multiple markers present — file-count tiebreak picks primary.
  if (markers > 1) {
    const counts = await countSourceFiles(rootDir);
    const candidates: Array<[number, LanguageConfig]> = [];
    if (hasGoMod) candidates.push([counts.go, goConfig]);
    if (hasSwift) candidates.push([counts.swift, swiftConfig]);
    if (hasPython) candidates.push([counts.py, pythonConfig]);
    if (hasCSharp) candidates.push([counts.cs, csharpConfig]);
    if (hasPackageJson) candidates.push([counts.ts, typescriptConfig]);
    candidates.sort((a, b) => {
      if (a[0] !== b[0]) return b[0] - a[0];
      return tiebreakRank(a[1]) - tiebreakRank(b[1]);
    });
    return candidates[0][1] ?? typescriptConfig;
  }

  // Step 5: No other markers — a Maven/Gradle root is Java. Checked last so
  // mixed repositories keep their existing primary language.
  if (await hasJavaMarker(rootDir)) return javaConfig;

  // Java outranks Terraform, and so does any of the fallback's source.
  // Searched as the TypeScript fallback would be inventoried.
  if (isTerraformOnly(await options.searchProjectFiles([typescriptConfig], { count: true }))) {
    return terraformConfig;
  }

  // Step 6: No markers → fallback to TypeScript/JS
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
export async function detectLanguages(rootDir: string, options: DetectLanguagesOptions): Promise<LanguageConfig[]> {
  // Check for language markers (Swift adds Package.swift / .xcodeproj /
  // .xcworkspace; only one needs to be present).
  const [hasGoMod, hasPackageJson, hasSwift, hasPython, hasCSharp] = await Promise.all([
    fileExists(join(rootDir, "go.mod")),
    fileExists(join(rootDir, "package.json")),
    hasSwiftMarker(rootDir),
    hasPythonMarker(rootDir),
    hasCSharpMarker(rootDir),
  ]);

  const hasJava = await hasJavaMarker(rootDir);
  const present: Array<{ config: LanguageConfig; count: number }> = [];

  // When any markers are present, count source files so we can order by
  // primary. countSourceFiles is cheap (shallow scan).
  if (hasGoMod || hasPackageJson || hasSwift || hasPython || hasCSharp) {
    const counts = await countSourceFiles(rootDir);
    if (hasGoMod) present.push({ config: goConfig, count: counts.go });
    if (hasSwift) present.push({ config: swiftConfig, count: counts.swift });
    if (hasPython) present.push({ config: pythonConfig, count: counts.py });
    if (hasCSharp) present.push({ config: csharpConfig, count: counts.cs });
    if (hasPackageJson) present.push({ config: typescriptConfig, count: counts.ts });
  }

  // No markers → fallback to TypeScript/JS for backward compatibility, with
  // Terraform beside it; Terraform alone only when there is no fallback
  // source at all (never beside Java). Searched with the skip set of what
  // would be returned without Terraform.
  if (present.length === 0) {
    const base = hasJava ? javaConfig : typescriptConfig;
    const counts = await options.searchProjectFiles([base], { count: !hasJava });
    if (counts.terraform === 0) return [base];
    if (hasJava || !isTerraformOnly(counts)) return [base, terraformConfig];
    return [terraformConfig];
  }

  // Stable ordering by descending file count, ties broken by the same
  // TS > Swift > Go preference detectLanguage uses.
  present.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return tiebreakRank(a.config) - tiebreakRank(b.config);
  });
  const configs = present.map((p) => p.config);
  // Appended last so Java never displaces the primary language. The
  // secondary variant keeps Java from skipping or flagging the primary
  // language's `out/` and `generated/` files.
  if (hasJava) configs.push(javaSecondaryConfig);
  if ((await options.searchProjectFiles(configs, { count: false })).terraform > 0) configs.push(terraformConfig);
  return configs;
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
 * - `configFilePatterns`: concatenation of all patterns (omitted when none)
 * - `skipDirectories`: union of all skip directories
 * - `skipUnlessContains`: union of the marker files per name (omitted when
 *   none); a name another config lists in `skipDirectories` stays skipped
 * - `skipBesideMarker`: likewise (omitted when none)
 * - `generatedFilePatterns`: concatenation of all patterns
 * - `generatedHeaders`: concatenation of all rules (omitted when none)
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
  const configFilePatterns: RegExp[] = [];
  const skipDirectories = new Set<string>();
  const skipUnlessContains = new Map<string, string[]>();
  const skipBesideMarker = new Map<string, string[]>();
  const generatedFilePatterns: RegExp[] = [];
  const generatedHeaders: GeneratedHeaderRule[] = [];
  const entryPointPatterns: RegExp[] = [];

  for (const config of configs) {
    for (const ext of config.extensions) extensions.add(ext);
    for (const ext of config.parseableExtensions) parseableExtensions.add(ext);
    for (const p of config.testFilePatterns) testFilePatterns.push(p);
    for (const f of config.configFilenames) configFilenames.add(f);
    for (const p of config.configFilePatterns ?? []) configFilePatterns.push(p);
    for (const d of config.skipDirectories) skipDirectories.add(d);
    for (const [d, markers] of config.skipUnlessContains ?? []) {
      skipUnlessContains.set(d, [...new Set([...(skipUnlessContains.get(d) ?? []), ...markers])]);
    }
    for (const [d, markers] of config.skipBesideMarker ?? []) {
      skipBesideMarker.set(d, [...new Set([...(skipBesideMarker.get(d) ?? []), ...markers])]);
    }
    for (const p of config.generatedFilePatterns) generatedFilePatterns.push(p);
    for (const r of config.generatedHeaders ?? []) generatedHeaders.push(r);
    for (const p of config.entryPointPatterns) entryPointPatterns.push(p);
  }

  return {
    id: primary.id,
    displayName: primary.displayName,
    extensions,
    parseableExtensions,
    testFilePatterns,
    configFilenames,
    ...(configFilePatterns.length > 0 ? { configFilePatterns } : {}),
    skipDirectories,
    ...(skipUnlessContains.size > 0 ? { skipUnlessContains } : {}),
    ...(skipBesideMarker.size > 0 ? { skipBesideMarker } : {}),
    generatedFilePatterns,
    ...(generatedHeaders.length > 0 ? { generatedHeaders } : {}),
    entryPointPatterns,
    moduleFile: primary.moduleFile,
  };
}
