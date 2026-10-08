/**
 * Language packs — the internal contract for tree-sitter-backed languages.
 *
 * A pack bundles a language's {@link LanguageConfig} (unchanged) with what
 * structure extraction needs: a pinned grammar built to WASM, named query
 * files, an optional reference resolver, optional build-file readers, and a
 * provenance record for every rule it ships.
 *
 * Packs are internal to sourcevision: there is no public plugin API and no
 * loading of packs from outside this package. Languages without a pack keep
 * working through `registry.ts` and `detect.ts`.
 *
 * A pack whose grammar has not been built degrades that language to
 * inventory-only and says so once per load; it never fails the analysis.
 *
 * @module sourcevision/language/pack
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildGrammarsScript, grammarBuildDir } from "./package-paths.js";
import { goPack } from "./go-pack.js";
import { javaPack } from "./java-pack.js";
import type { LanguageConfig } from "./registry.js";

// ── Pack contract ───────────────────────────────────────────────────────────

/** A tree-sitter grammar built to WASM from a pinned release. */
export interface GrammarLocator {
  /** Grammar name; the built file is `<name>.wasm` in the grammar directory. */
  readonly name: string;
  /** Pinned grammar release, e.g. `"0.23.5"`. Matches `scripts/build-grammars.mjs`. */
  readonly version: string;
}

/** A named tree-sitter query (`.scm`) shipped beside the pack. */
export interface PackQuery {
  /** Rule name, e.g. `"structure"`. Keys the pack's provenance record. */
  readonly name: string;
  /** Absolute path of the `.scm` file. */
  readonly path: string;
}

/** Where a rule's behaviour was checked, so it can be re-verified later. */
export interface RuleProvenance {
  /** Versions the rule was verified against, e.g. `["tree-sitter-java@0.23.5", "Java 21"]`. */
  readonly verifiedAgainst: readonly string[];
  /** ISO date (`YYYY-MM-DD`) the rule was last verified. */
  readonly verifiedOn: string;
  /** URL of the source the rule was verified against. */
  readonly source: string;
}

/** A position in a file. Matches the schema's call-graph positions. */
export interface SourcePosition {
  /** One-based line. */
  readonly line: number;
  /**
   * Zero-based column in UTF-16 code units — web-tree-sitter parses the
   * JavaScript string, so this indexes the line as `String.prototype` does,
   * not by UTF-8 byte.
   */
  readonly column: number;
}

/** One node captured by a pack query. */
export interface Capture {
  /** Capture name as written in the query, without the `@`. */
  readonly name: string;
  /** Tree-sitter node type, e.g. `"class_declaration"`. */
  readonly nodeType: string;
  readonly text: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

/** One project file's captures, as the runner produces them. */
export interface PackSourceFile {
  /** Project-relative, forward-slash path. */
  readonly path: string;
  /** Captures per query name, in document order. */
  readonly captures: Readonly<Record<string, readonly Capture[]>>;
}

/** A project file one file refers to, with the names that led there. */
export interface FileReference {
  /**
   * Project-relative path of the target file. A language whose imports name a
   * package directory (Go) gives the directory; the zones phase expands it to
   * the files beneath (`resolveEdgeTarget` in `analyzers/zones.ts`).
   */
  readonly to: string;
  /** Sorted, distinct; `*` for a wildcard import. */
  readonly symbols: readonly string[];
}

/** The build-system module an external package comes from, when the resolver knows it. */
export interface ExternalModule {
  readonly path: string;
  readonly version?: string;
}

/** A package outside the project that one file refers to. */
export interface ExternalReference {
  /** Package name, e.g. `java.util`. No version. */
  readonly package: string;
  /** Sorted, distinct; `*` for a wildcard import. */
  readonly symbols: readonly string[];
  /** Held in memory only; the imports schema has no field for it. */
  readonly module?: ExternalModule;
}

/** Everything one file refers to. Both lists are sorted and deduplicated. */
export interface FileReferences {
  /** Never contains the file itself. */
  readonly files: readonly FileReference[];
  readonly external: readonly ExternalReference[];
}

/**
 * Resolves references to files. Resolution needs an index of the whole
 * project (same-package and wildcard lookups), so it is built once per
 * analysis by {@link PackResolver.prepare}.
 */
export interface PackResolver {
  /**
   * A resolver bound to what resolution needs from outside the source files
   * (build files such as `go.mod`), read from `projectDir`. Call once per
   * analysis, before {@link prepare}. Absent when sources are enough (Java).
   */
  forProject?(projectDir: string): Promise<PackResolver>;
  /** Index every file of the project; call once per analysis. */
  prepare(files: readonly PackSourceFile[]): PreparedResolver;
}

/** A resolver bound to one project's index. */
export interface PreparedResolver {
  /** References from a prepared file; empty for a path that was not prepared. */
  resolve(fromFile: string): FileReferences;
}

/** A dependency declared in a build file. */
export interface DeclaredDependency {
  readonly name: string;
  readonly version?: string;
  readonly scope?: string;
}

/** Reads one kind of build file (e.g. `pom.xml`) into declared facts. */
export interface BuildFileReader {
  /** Filenames this reader handles. */
  readonly filenames: readonly string[];
  /** Parse a build file's content. `path` is project-relative. */
  read(path: string, content: string): { readonly dependencies: readonly DeclaredDependency[] };
}

/** Reserved: framework rules layered on a language pack. Not implemented yet. */
export interface FrameworkPack {
  readonly id: string;
  readonly provenance: Readonly<Record<string, RuleProvenance>>;
}

/** Reserved: an optional precise (SCIP) index tier. Not implemented yet. */
export interface PreciseIndexSource {
  readonly kind: "scip";
}

/** Everything sourcevision needs to analyze one language through tree-sitter. */
export interface LanguagePack {
  /** Same as `config.id`. */
  readonly id: string;
  /** The language's existing registry config, unchanged. */
  readonly config: LanguageConfig;
  readonly grammar: GrammarLocator;
  readonly queries: readonly PackQuery[];
  readonly resolver?: PackResolver;
  readonly buildReaders?: readonly BuildFileReader[];
  /** One record per rule, keyed by rule name (every query name at least). */
  readonly provenance: Readonly<Record<string, RuleProvenance>>;
  /** Reserved — see {@link FrameworkPack}. */
  readonly frameworks?: readonly FrameworkPack[];
  /** Reserved — see {@link PreciseIndexSource}. */
  readonly precise?: PreciseIndexSource;
}

// ── Built-in packs and loader ───────────────────────────────────────────────

/** Packs registered in sourcevision. */
export const BUILTIN_PACKS: readonly LanguagePack[] = [javaPack, goPack];

/** How a pack's language will be analyzed. */
export type PackMode = "structure" | "inventory-only";

export interface PackStatus {
  readonly pack: LanguagePack;
  /** Absolute path the grammar is expected at. */
  readonly grammarPath: string;
  readonly grammarAvailable: boolean;
  readonly mode: PackMode;
  /** Set when the language degraded; the message that was reported. */
  readonly notice?: string;
}

export interface LoadPacksOptions {
  /** Defaults to {@link BUILTIN_PACKS}. */
  readonly packs?: readonly LanguagePack[];
  /** Defaults to {@link grammarBuildDir}. */
  readonly grammarDir?: string;
  /** Receives one message per degraded pack. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
}

/**
 * The step that restores a missing grammar, for the install at hand. A source
 * checkout has the build script; a published install ships every built-in
 * grammar, so a missing one means the install is incomplete.
 */
function missingGrammarStep(): string {
  return existsSync(buildGrammarsScript())
    ? "Build it with `pnpm --filter @n-dx/sourcevision build:grammars` in the n-dx checkout."
    : "Published @n-dx/sourcevision ships this grammar, so this install is incomplete: reinstall n-dx with `npm install -g @n-dx/core@latest`.";
}

/**
 * List the packs and whether each grammar is available. A missing grammar
 * degrades that language to inventory-only and is reported once through
 * `warn`; it never throws. Call once per analysis.
 */
export function loadLanguagePacks(options: LoadPacksOptions = {}): PackStatus[] {
  const packs = options.packs ?? BUILTIN_PACKS;
  const grammarDir = options.grammarDir ?? grammarBuildDir();
  const warn = options.warn ?? ((message: string) => console.warn(message));

  return packs.map((pack) => {
    const grammarPath = join(grammarDir, `${pack.grammar.name}.wasm`);
    if (existsSync(grammarPath)) {
      return { pack, grammarPath, grammarAvailable: true, mode: "structure" };
    }
    const notice =
      `${pack.config.displayName}: grammar ${pack.grammar.name}@${pack.grammar.version} is not built ` +
      `(expected ${grammarPath}); ${pack.config.displayName} files get inventory only. ` +
      missingGrammarStep();
    warn(notice);
    return { pack, grammarPath, grammarAvailable: false, mode: "inventory-only", notice };
  });
}
