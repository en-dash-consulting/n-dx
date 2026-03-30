/**
 * Language registry — the single source of truth for all language-specific
 * decisions in SourceVision.
 *
 * Each supported language provides a `LanguageConfig` that drives downstream
 * analyzers: file extensions, skip directories, test/generated file patterns,
 * config filenames, and entry point detection.
 *
 * @module sourcevision/language/registry
 */

// ── LanguageConfig interface ────────────────────────────────────────────────

/**
 * Configuration for a supported project language.
 *
 * Consumed by inventory, import, zone, and classification analyzers to make
 * language-aware decisions without hardcoded conditionals.
 */
export interface LanguageConfig {
  /** Machine identifier, e.g. "go", "typescript". */
  readonly id: string;

  /** Human-readable name, e.g. "Go", "TypeScript". */
  readonly displayName: string;

  /** Source file extensions for this language (e.g. `[".go"]`, `[".ts", ".tsx"]`). */
  readonly extensions: ReadonlySet<string>;

  /** Extensions the import parser can handle (subset of `extensions` + extras like `.mjs`). */
  readonly parseableExtensions: ReadonlySet<string>;

  /** Patterns that identify test files (e.g. `/_test\.go$/`). */
  readonly testFilePatterns: readonly RegExp[];

  /** Known configuration/build filenames (e.g. `"go.mod"`, `"tsconfig.json"`). */
  readonly configFilenames: ReadonlySet<string>;

  /** Directories to skip during file traversal, in addition to the base set. */
  readonly skipDirectories: ReadonlySet<string>;

  /** Patterns that identify generated/machine-written files. */
  readonly generatedFilePatterns: readonly RegExp[];

  /** Patterns that identify entry point files (e.g. `main.go`, `index.ts`). */
  readonly entryPointPatterns: readonly RegExp[];

  /** The package manifest filename, if any (e.g. `"go.mod"`, `"package.json"`). */
  readonly moduleFile?: string;
}
