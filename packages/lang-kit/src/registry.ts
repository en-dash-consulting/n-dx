/**
 * Language registry — the single source of truth for all language-specific
 * decisions in SourceVision.
 *
 * Each supported language provides a `LanguageConfig` that drives downstream
 * analyzers: file extensions, skip directories, test/generated file patterns,
 * config filenames, and entry point detection.
 *
 * @module lang-kit/registry
 */

// ── Generated-file header rule ──────────────────────────────────────────────

/**
 * A content check for generated files whose paths no pattern can name. The
 * inventory reads the leading text of files with a matching extension and
 * classifies a hit as `generated`.
 */
export interface GeneratedHeaderRule {
  /** Extensions (lowercase, with dot) the rule applies to. Other files are never read for it. */
  readonly extensions: ReadonlySet<string>;
  /** Tested against the leading text; use the `m` flag for line anchors. */
  readonly pattern: RegExp;
  /** The text is cut at the first match of this, so a hit must precede it (e.g. Go's package clause). */
  readonly endOfHeader?: RegExp;
  /** Where the convention is defined. */
  readonly source: string;
  /** ISO date the rule was last checked against `source`. */
  readonly verified: string;
}

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

  /**
   * Path patterns for config files a bare filename cannot name
   * (`application-*.yml`, `gradle/libs.versions.toml`). Optional; matched
   * against the repo-relative path in addition to `configFilenames`.
   */
  readonly configFilePatterns?: readonly RegExp[];

  /** Directories to skip during file traversal, in addition to the base set. */
  readonly skipDirectories: ReadonlySet<string>;

  /**
   * Directories skipped like `skipDirectories` unless they directly hold one
   * of the listed files, which makes them source: Python's `env/` is a
   * virtualenv, but `env/__init__.py` makes it a package. A listed file of
   * the form `*.ext` stands for any file with that extension (PHP's `cache/`
   * holding a `.php` file); see {@link markerMatches}. A name in
   * `skipDirectories` is always skipped. Read with {@link skipsDirectory}.
   */
  readonly skipUnlessContains?: ReadonlyMap<string, readonly string[]>;

  /**
   * Directories skipped only when their parent directly holds one of the
   * listed files, wherever they sit: PHP's `vendor/` beside `composer.json`
   * is Composer's install directory, while a `vendor/` with no Composer file
   * beside it holds hand-copied libraries that are source. A walk's own
   * always-skipped names (sourcevision's vendored set) yield to this rule;
   * a name in `skipDirectories` is always skipped. Read with
   * {@link skipsDirectory}.
   */
  readonly skipOnlyBeside?: ReadonlyMap<string, readonly string[]>;

  /**
   * Directories skipped only where they are build output: directly under the
   * project root, or directly under a module root (a directory that directly
   * holds one of the listed files), and never below a `src/` directory. Java's
   * `target/` beside `pom.xml` is Maven output; `src/main/java/…/target/` is a
   * package. A name in `skipDirectories` is always skipped. Read with
   * {@link skipsDirectory}.
   */
  readonly skipBesideMarker?: ReadonlyMap<string, readonly string[]>;

  /** Patterns that identify generated/machine-written files. */
  readonly generatedFilePatterns: readonly RegExp[];

  /** Content rules for generated files that carry a header (see {@link GeneratedHeaderRule}). */
  readonly generatedHeaders?: readonly GeneratedHeaderRule[];

  /** Patterns that identify entry point files (e.g. `main.go`, `index.ts`). */
  readonly entryPointPatterns: readonly RegExp[];

  /** The package manifest filename, if any (e.g. `"go.mod"`, `"package.json"`). */
  readonly moduleFile?: string;
}

/**
 * Whether `fileName` is the `skipUnlessContains` marker `marker`: equal to
 * it, or, for a marker of the form `*.ext`, ending in `.ext`. A `holds`
 * callback that lists a directory answers a pattern marker with this.
 */
export function markerMatches(fileName: string, marker: string): boolean {
  return marker.startsWith("*.") ? fileName.endsWith(marker.slice(1)) : fileName === marker;
}

/** Where a directory sits, for a `skipBesideMarker` or `skipOnlyBeside` name. */
export interface DirectoryPlace {
  /** The directory's POSIX path relative to the project root (`"sub/target"`). */
  readonly path: string;
  /** Whether the directory's parent directly holds `file`. */
  readonly parentHolds: (file: string) => boolean;
}

/** The skip rules {@link skipsDirectory} reads. */
export type DirectorySkipRules = Pick<
  LanguageConfig,
  "skipDirectories" | "skipUnlessContains" | "skipBesideMarker" | "skipOnlyBeside"
>;

/**
 * Whether a traversal skips the directory `name` under `config`'s rules.
 * `holds(file)` answers whether the directory directly holds `file` (or, for
 * a `*.ext` marker, any file with that extension), and `place` where it sits;
 * they are asked only for a conditional name, so the caller does the I/O.
 * Without `place`, a `skipBesideMarker` name is taken to sit at the project
 * root, and a `skipOnlyBeside` name beside its marker (both skipped).
 *
 * A name in `skipDirectories` is always skipped. A name the conditional rules
 * list is skipped only when every rule listing it says so: a directory one
 * language recognises as source is kept.
 */
export function skipsDirectory(
  config: DirectorySkipRules,
  name: string,
  holds: (file: string) => boolean,
  place?: DirectoryPlace,
): boolean {
  if (config.skipDirectories.has(name)) return true;
  const unless = config.skipUnlessContains?.get(name);
  const beside = config.skipBesideMarker?.get(name);
  const onlyBeside = config.skipOnlyBeside?.get(name);
  if (unless === undefined && beside === undefined && onlyBeside === undefined) return false;
  if (unless !== undefined && unless.some(holds)) return false;
  if (beside !== undefined && place !== undefined && !isBuildOutputPlace(place, beside)) return false;
  if (onlyBeside !== undefined && place !== undefined && !onlyBeside.some(place.parentHolds)) return false;
  return true;
}

/** Under the project root or a module root holding a marker, and not below `src/`. */
function isBuildOutputPlace(place: DirectoryPlace, markers: readonly string[]): boolean {
  const segments = place.path.split("/");
  if (segments.slice(0, -1).includes("src")) return false;
  return segments.length === 1 || markers.some(place.parentHolds);
}
