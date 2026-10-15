/**
 * Deterministic file inventory analyzer.
 * Replaces the Claude-based phase 1 with pure TypeScript.
 */

import { readFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { createHash } from "node:crypto";
import { isVerbose, verbose } from "@n-dx/llm-client";
import type { FileEntry, FileRole, Inventory } from "../schema/index.js";
import { sortInventory, toCanonicalJSON } from "../util/sort.js";
import { computeInventorySummary } from "../util/merge.js";
import { loadIgnoreFilter, projectSkipDirs, walkProjectFiles } from "../util/project-walk.js";
import { detectLanguage as detectProjectLanguage, loadInventoryConfig } from "../language/detect.js";
import { csharpConfig, pythonConfig, typescriptConfig, terraformConfig, isTerraformFile, type LanguageConfig } from "@n-dx/lang-kit";

// ── Language detection ───────────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".pyi": "Python",
  ".rb": "Ruby",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".scala": "Scala",
  ".swift": "Swift",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".cxx": "C++",
  ".hpp": "C++",
  ".cs": "C#",
  ".aspx": "ASP.NET",
  ".ascx": "ASP.NET",
  ".ashx": "ASP.NET",
  ".asmx": "ASP.NET",
  ".master": "ASP.NET",
  ".php": "PHP",
  ".lua": "Lua",
  ".r": "R",
  ".R": "R",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang",
  ".hrl": "Erlang",
  ".hs": "Haskell",
  ".ml": "OCaml",
  ".mli": "OCaml",
  ".clj": "Clojure",
  ".cljs": "Clojure",
  ".zig": "Zig",
  ".v": "V",
  ".nim": "Nim",
  ".pl": "Perl",
  ".pm": "Perl",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".fish": "Shell",
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sass": "SASS",
  ".less": "Less",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".xml": "XML",
  ".md": "Markdown",
  ".mdx": "Markdown",
  ".txt": "Text",
  ".rst": "reStructuredText",
  ".sql": "SQL",
  ".graphql": "GraphQL",
  ".gql": "GraphQL",
  ".proto": "Protobuf",
  ".svg": "SVG",
  ".wasm": "WebAssembly",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".astro": "Astro",
};

export function detectLanguage(filePath: string): string {
  const name = basename(filePath);
  const ext = extname(filePath).toLowerCase();

  // Filename-based detection (more specific, checked first)
  if (name === "Makefile" || name === "GNUmakefile") return "Makefile";
  if (name === "Dockerfile" || name.startsWith("Dockerfile.")) return "Dockerfile";
  if (name === "Vagrantfile") return "Ruby";
  if (isTerraformFile(name)) return "Terraform";
  if (name === "Rakefile" || name === "Gemfile") return "Ruby";
  if (name === "Justfile") return "Just";
  if (name === "CMakeLists.txt" || ext === ".cmake") return "CMake";

  // Extension-based detection
  if (ext && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];

  return "Other";
}

// ── Role classification ──────────────────────────────────────────────────────

// CONFIG_FILENAMES — now sourced from languageConfig.configFilenames.
// See packages/lang-kit/src/ for per-language config sets.

/**
 * Convention for build/tooling config artifacts named `<tool>.config.<ext>`
 * (e.g. `vite.config.ts`, `jest.config.js`, `drizzle.config.ts`,
 * `playwright.config.ts`, `tsup.config.ts`). The per-language
 * `configFilenames` set only enumerates well-known names, so anything a
 * project or a newer tool introduces would otherwise fall through to the
 * `source` role and pollute source-logic analysis. Matching requires the
 * literal `.config.` segment, so genuine source files like `config.ts`,
 * `configuration.ts`, or `db-config.ts` are unaffected.
 */
const CONFIG_CONVENTION_PATTERN =
  /\.config\.(?:[cm]?[jt]sx?|json|ya?ml|toml)$/i;

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "Pipfile.lock",
  "poetry.lock",
  "go.sum",
  "flake.lock",
]);

const ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".avif",
  ".bmp",
  ".tiff",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".pdf",
]);

const PROGRAMMING_LANGUAGES = new Set([
  "TypeScript",
  "JavaScript",
  "Python",
  "Ruby",
  "Go",
  "Rust",
  "Java",
  "Kotlin",
  "Scala",
  "Swift",
  "C",
  "C++",
  "C#",
  "ASP.NET",
  "PHP",
  "Lua",
  "R",
  "Dart",
  "Elixir",
  "Erlang",
  "Haskell",
  "OCaml",
  "Clojure",
  "Zig",
  "V",
  "Nim",
  "Perl",
  "Shell",
  "SQL",
  "Terraform",
  "Vue",
  "Svelte",
  "Astro",
]);

/** Bytes of a file's start the generated-header rules look at. */
const GENERATED_HEADER_BYTES = 8192;

/** Leading text of `buf`, or undefined when no header rule applies to this file's extension. */
function readHeaderText(filePath: string, buf: Buffer, config: LanguageConfig): string | undefined {
  const ext = extname(filePath).toLowerCase();
  if (!config.generatedHeaders?.some((rule) => rule.extensions.has(ext))) return undefined;
  return buf.subarray(0, GENERATED_HEADER_BYTES).toString("utf-8");
}

/** True when `head` carries a generated-file header a rule for this file's extension recognises. */
function hasGeneratedHeader(filePath: string, head: string, config: LanguageConfig): boolean {
  const ext = extname(filePath).toLowerCase();
  return (config.generatedHeaders ?? []).some((rule) => {
    if (!rule.extensions.has(ext)) return false;
    const end = rule.endOfHeader ? head.search(rule.endOfHeader) : -1;
    return rule.pattern.test(end === -1 ? head : head.slice(0, end));
  });
}

/**
 * @param head leading text of the file; lets language header rules
 *   (`LanguageConfig.generatedHeaders`) mark generated files path patterns miss.
 */
export function classifyRole(filePath: string, language: string, langConfig?: LanguageConfig, head?: string): FileRole {
  const name = basename(filePath);
  const lower = filePath.toLowerCase();
  const ext = extname(filePath).toLowerCase();

  const config = langConfig ?? typescriptConfig;

  // 1. Test — language-specific patterns (e.g. _test.go for Go, .test./.spec. for TS).
  //    Terraform's own patterns (.tftest.hcl, tests/ and test/ directories) never
  //    decide a non-Terraform file.
  const terraformPattern = (pat: RegExp): boolean => terraformConfig.testFilePatterns.includes(pat);
  // 1a. Terraform (.tf, .tfvars, terragrunt.hcl, .tftest.hcl) is config unless a
  //     test pattern matches it. Another language's pattern always counts
  //     (tests/fixtures/infra/main.tf in a TS repo stays in test quarantine);
  //     Terraform's own patterns count only in a Terraform-first repo, so a
  //     Terraform file under tests/ keeps the test role there (decision 8) and
  //     repos led by another language keep their roles.
  if (language === "Terraform") {
    const terraformFirst = config.id === terraformConfig.id;
    const isTest = config.testFilePatterns.some(
      (pat) => (terraformFirst || !terraformPattern(pat)) && pat.test(filePath),
    );
    return isTest ? "test" : "config";
  }
  if (config.testFilePatterns.some((pat) => !terraformPattern(pat) && pat.test(filePath))) {
    return "test";
  }

  // 2. Generated — universal checks + language-specific patterns
  if (
    LOCKFILE_NAMES.has(name) ||
    lower.includes("generated") ||
    config.generatedFilePatterns.some((pat) => pat.test(filePath)) ||
    (head !== undefined && hasGeneratedHeader(filePath, head, config))
  ) {
    return "generated";
  }

  // 3. Config — language-specific filenames + universal heuristics
  if (
    config.configFilenames.has(name) ||
    config.configFilePatterns?.some((pat) => pat.test(filePath)) ||
    CONFIG_CONVENTION_PATTERN.test(name) ||
    name.startsWith("tsconfig") ||
    name === ".env" ||
    name.startsWith(".env.") ||
    (name.startsWith(".") && (name.endsWith("rc") || name.endsWith("rc.js") || name.endsWith("rc.json") || name.endsWith("rc.yml") || name.endsWith("rc.cjs") || name.endsWith("rc.mjs")))
  ) {
    return "config";
  }

  // 4. Docs
  if (
    language === "Markdown" ||
    language === "Text" ||
    language === "reStructuredText" ||
    lower.includes("/docs/") ||
    lower.startsWith("docs/") ||
    name === "LICENSE" ||
    name === "LICENSE.md" ||
    name === "CHANGELOG" ||
    name === "CHANGELOG.md" ||
    name === "CONTRIBUTING.md" ||
    name === "CODE_OF_CONDUCT.md"
  ) {
    return "docs";
  }

  // 5. Asset — universal checks + Go testdata/ convention
  if (
    ASSET_EXTENSIONS.has(ext) ||
    lower.includes("/assets/") ||
    lower.startsWith("assets/") ||
    lower.includes("/public/") ||
    lower.startsWith("public/") ||
    lower.includes("/static/") ||
    lower.startsWith("static/") ||
    (config.id === "go" && (lower.includes("/testdata/") || lower.startsWith("testdata/")))
  ) {
    return "asset";
  }

  // 6. Build
  if (
    lower.includes("/scripts/") ||
    lower.startsWith("scripts/") ||
    language === "Dockerfile" ||
    lower.includes(".github/workflows/") ||
    lower.includes(".github/actions/") ||
    name === "Makefile" ||
    name === "GNUmakefile" ||
    name === "Justfile"
  ) {
    return "build";
  }

  // 7. Source
  if (PROGRAMMING_LANGUAGES.has(language)) {
    return "source";
  }

  // 8. Fallback
  return "other";
}

// ── Category derivation ──────────────────────────────────────────────────────

const GENERIC_PREFIXES = new Set(["src", "lib", "app", "packages", "internal", "pkg"]);

export function deriveCategory(filePath: string): string {
  const parts = filePath.split("/");

  // Root files
  if (parts.length === 1) return "root";

  // Skip generic top-level prefixes
  let startIdx = 0;
  while (startIdx < parts.length - 1 && GENERIC_PREFIXES.has(parts[startIdx])) {
    startIdx++;
  }

  // If we ran out of meaningful segments, use last directory
  if (startIdx >= parts.length - 1) {
    // It's a file directly under generic prefix(es), use the prefix chain
    return parts.slice(0, -1).join("-").toLowerCase();
  }

  // Use the first meaningful directory segment
  return parts[startIdx].toLowerCase().replace(/[_\s]+/g, "-");
}

// ── Binary detection ─────────────────────────────────────────────────────────

export function isBinary(buf: Buffer): boolean {
  const check = buf.subarray(0, 8192);
  return check.includes(0);
}

// ── Incremental types ────────────────────────────────────────────────────────

export interface InventoryOptions {
  previousInventory?: Inventory;
  /** Pre-resolved language config. When omitted, detectLanguage() auto-detects. */
  languageConfig?: LanguageConfig;
  /**
   * Restrict the inventory to program-code files only. When true (the default),
   * files whose detected language is not a programming language are skipped
   * during the walk, unless their extension is listed in `extraExtensions`.
   * Set false to inventory every file (legacy behavior). When omitted, the
   * value is read from `.n-dx.json` (`sourcevision.codeOnly`), defaulting to true.
   */
  codeOnly?: boolean;
  /** Extra file extensions to include when `codeOnly` is true (lower-cased, leading dot). */
  extraExtensions?: string[];
  /** Extra directory names to skip during the walk (in addition to base + language skips). */
  extraSkipDirs?: string[];
}

export interface InventoryStats {
  cached: number;
  changed: number;
  added: number;
  deleted: number;
  /** Files whose mtime/size changed but content hash stayed the same (e.g. `touch`) */
  touched: number;
}

export interface InventoryResult extends Inventory {
  stats?: InventoryStats;
  changedFiles?: Set<string>;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function analyzeInventory(
  targetDir: string,
  options?: InventoryOptions
): Promise<InventoryResult> {
  const absDir = join(targetDir); // normalize

  // Resolve language config once per analysis run
  const langConfig = options?.languageConfig ?? await detectProjectLanguage(absDir);

  // Resolve inventory overrides (.n-dx.json `sourcevision` key). Explicit
  // options always win; otherwise fall back to config, then built-in defaults.
  const inventoryConfig = await loadInventoryConfig(absDir);
  const codeOnly = options?.codeOnly ?? inventoryConfig.codeOnly ?? true;
  const extraExtensions = new Set(
    (options?.extraExtensions ?? inventoryConfig.extraExtensions ?? []).map((e) => e.toLowerCase()),
  );
  const extraSkipDirs = options?.extraSkipDirs ?? inventoryConfig.extraSkipDirs ?? [];

  // Build skip set: always-skipped dirs + vendored deps + language-specific dirs + user extras
  const skipDirs = projectSkipDirs(langConfig.skipDirectories, extraSkipDirs);

  // Extensions rejected by the code-only filter below, tallied by extension —
  // surfaced on the summary as `skippedExtensions` so a project whose files
  // are silently dropped (e.g. a language with no support at all) shows up
  // as "skipped" instead of just vanishing from the inventory.
  const skippedExtensions = new Map<string, number>();

  // Code-only walk filter: keep files whose detected language is a programming
  // language, plus any user-supplied extra extensions. Disabled when codeOnly
  // is false (legacy: inventory every file).
  const acceptFile = (relPath: string): boolean => {
    if (!codeOnly) return true;
    if (PROGRAMMING_LANGUAGES.has(detectLanguage(relPath))) return true;
    const ext = extname(relPath).toLowerCase();
    if (extraExtensions.has(ext)) return true;
    if (ext) skippedExtensions.set(ext, (skippedExtensions.get(ext) ?? 0) + 1);
    return false;
  };

  const ig = await loadIgnoreFilter(absDir);
  // Code-only filter applied before files are stat'd/read.
  const filePaths: string[] = [];
  for await (const relPath of walkProjectFiles(absDir, absDir, ig, skipDirs)) {
    if (acceptFile(relPath)) filePaths.push(relPath);
  }

  const prev = options?.previousInventory;
  const prevMap = new Map<string, FileEntry>();
  if (prev) {
    for (const f of prev.files) {
      prevMap.set(f.path, f);
    }
  }

  const files: FileEntry[] = [];
  const changedFiles = new Set<string>();
  let cached = 0;
  let changed = 0;
  let added = 0;
  let touched = 0;

  const verboseScan = isVerbose();
  let lastTickMs = Date.now();

  for (let i = 0; i < filePaths.length; i++) {
    const relPath = filePaths[i];
    if (verboseScan && Date.now() - lastTickMs >= 2000) {
      verbose(`  … scanning files (${i}/${filePaths.length})`);
      lastTickMs = Date.now();
    }
    const fullPath = join(absDir, relPath);
    const st = await stat(fullPath);
    const mtime = Math.floor(st.mtimeMs);

    const prevEntry = prevMap.get(relPath);

    // Cache hit: reuse entry when both mtime and size match
    if (prevEntry && prevEntry.lastModified === mtime && prevEntry.size === st.size) {
      files.push(prevEntry);
      cached++;
      continue;
    }

    // Cache miss: read and process the file
    const buf = await readFile(fullPath);
    const hash = createHash("sha256").update(buf).digest("hex");
    const language = detectLanguage(relPath);
    const role = classifyRole(relPath, language, langConfig, readHeaderText(relPath, buf, langConfig));
    const category = deriveCategory(relPath);

    let lineCount = 0;
    if (!isBinary(buf)) {
      const text = buf.toString("utf-8");
      if (text.length > 0) {
        lineCount = text.split("\n").length;
        if (text.endsWith("\n")) lineCount--;
      }
    }

    files.push({
      path: relPath,
      size: st.size,
      language,
      lineCount,
      hash,
      role,
      category,
      lastModified: mtime,
    });

    if (prevEntry) {
      if (prevEntry.hash === hash) {
        // Mtime/size changed but content is identical (e.g. `touch`, rebuild).
        // Don't flag as changed — downstream phases need not re-process.
        touched++;
      } else {
        changedFiles.add(relPath);
        changed++;
      }
    } else {
      changedFiles.add(relPath);
      added++;
    }
  }

  // Detect deleted files
  const currentPaths = new Set(filePaths);
  let deleted = 0;
  if (prev) {
    for (const f of prev.files) {
      if (!currentPaths.has(f.path)) {
        deleted++;
      }
    }
  }

  const summary = computeInventorySummary(files);

  if (skippedExtensions.size > 0) {
    summary.skippedExtensions = Object.fromEntries(
      [...skippedExtensions.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  // Languages whose files take part in import-graph and zone analysis: JS/TS
  // and C# are always parseable (JS/TS as the backward-compatible default),
  // plus whatever the
  // detected primary language's own parser handles. Mirrors the extension set
  // analyzeImports() builds in imports.ts. Intersected with byLanguage so the
  // list only names languages actually present in this inventory.
  // Python files reach the imports phase only through the opt-in
  // @n-dx/lang-python, and this phase does not know whether it will load, so
  // Python is not listed: listing it would change inventory.json without the pack.
  const analysedExtensions = new Set<string>(
    [...typescriptConfig.parseableExtensions, ...csharpConfig.parseableExtensions, ...langConfig.parseableExtensions].filter(
      (ext) => !pythonConfig.parseableExtensions.has(ext),
    ),
  );
  const analysedLanguageNames = new Set<string>();
  for (const ext of analysedExtensions) {
    const lang = EXT_TO_LANGUAGE[ext];
    if (lang) analysedLanguageNames.add(lang);
  }
  summary.analysedLanguages = Object.keys(summary.byLanguage)
    .filter((lang) => analysedLanguageNames.has(lang))
    .sort();

  const result: InventoryResult = sortInventory({ files, summary }) as InventoryResult;

  if (prev) {
    result.stats = { cached, changed, added, deleted, touched };
    result.changedFiles = changedFiles;
  }

  return result;
}

export { toCanonicalJSON };
