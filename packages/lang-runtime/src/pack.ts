/**
 * Language packs — the contract for tree-sitter-backed languages.
 *
 * A pack bundles a language's {@link LanguageConfig} (unchanged) with what
 * structure extraction needs: a pinned grammar built to WASM, named query
 * files, an optional reference resolver, and a provenance record for every
 * rule it ships. What a pack yields to its caller is lang-kit's per-file
 * facts, read from its captures by `pack-facts.ts`; build files are read by
 * lang-kit's build readers into `ModuleBuildModel`.
 *
 * There is no public plugin API. Languages without a pack keep working
 * through lang-kit's registry and detection.
 *
 * A pack whose grammar has not been built degrades that language to
 * inventory-only and says so once per load; it never fails the analysis.
 *
 * @module lang-runtime/pack
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ExternalModule,
  ExternalReference,
  FactKind,
  FactProducer,
  FileFacts,
  FileReference,
  FileReferences,
  LanguageConfig,
  SourcePosition,
} from "@n-dx/lang-kit";

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

/**
 * Positions are lang-kit's: one-based line, zero-based column in UTF-16 code
 * units. web-tree-sitter parses the JavaScript string, so its columns already
 * index the line as `String.prototype` does, not by UTF-8 byte.
 */
export type { SourcePosition };

/** One node captured by a pack query. */
export interface Capture {
  /**
   * Capture name as written in the query, without the `@`. Names starting
   * with `_` are predicate-only and never reach a `Capture`.
   */
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

/** What a resolver returns is lang-kit's imports fact. */
export type { ExternalModule, ExternalReference, FileReference, FileReferences };

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
  /**
   * Index every file of the project; call once per analysis. `unparsed` lists
   * the pack's files that produced no captures (over the size limit, unreadable):
   * they exist, so a resolver that maps references to directories must still
   * count them. They are never passed to {@link PreparedResolver.resolve}.
   */
  prepare(files: readonly PackSourceFile[], unparsed?: readonly string[]): PreparedResolver;
}

/** A resolver bound to one project's index. */
export interface PreparedResolver {
  /** References from a prepared file; empty for a path that was not prepared. */
  resolve(fromFile: string): FileReferences;
}

/** What a framework reads from a project: facts per file path, and what it skipped. */
export interface FrameworkFacts {
  /** Merged into each file's facts; a list kind another reader also fills is concatenated. */
  readonly facts: ReadonlyMap<string, Omit<FileFacts, "path">>;
  /** One sentence each, reported as the pack entry's `notices`. */
  readonly notices: readonly string[];
}

/**
 * Framework rules layered on a language pack (Spring Boot on Java). Its
 * queries run in the same parse as the language pack's, and only when a kind
 * it produces is wanted, so a caller asking for imports alone pays nothing
 * for it; the golden harness runs the language pack's queries only. Query
 * names must differ from the language pack's: captures are keyed by them.
 * Every kind it produces is listed in the language pack's `produces` too.
 */
export interface FrameworkPack extends FactProducer {
  readonly id: string;
  readonly queries: readonly PackQuery[];
  /** One record per rule, keyed by rule name (every query name at least). */
  readonly provenance: Readonly<Record<string, RuleProvenance>>;
  /**
   * Read every parsed file's captures (the language pack's and this
   * framework's) into the wanted kinds it produces. Called once per analysis.
   */
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[]): FrameworkFacts;
}

/** Reserved: an optional precise (SCIP) index tier. Not implemented yet. */
export interface PreciseIndexSource {
  readonly kind: "scip";
}

/**
 * Everything needed to analyze one language through tree-sitter.
 * `produces` names the lang-kit fact kinds `pack-facts.ts` reads from this
 * pack's captures (and, for `imports`, its resolver).
 */
export interface LanguagePack extends FactProducer {
  /** Same as `config.id`. */
  readonly id: string;
  /** The language's existing registry config, unchanged. */
  readonly config: LanguageConfig;
  readonly grammar: GrammarLocator;
  readonly queries: readonly PackQuery[];
  readonly resolver?: PackResolver;
  /** One record per rule, keyed by rule name (every query name at least). */
  readonly provenance: Readonly<Record<string, RuleProvenance>>;
  /** Framework rules over this language; see {@link FrameworkPack}. */
  readonly frameworks?: readonly FrameworkPack[];
  /** Reserved — see {@link PreciseIndexSource}. */
  readonly precise?: PreciseIndexSource;
}

// ── Loader ──────────────────────────────────────────────────────────────────

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
  readonly packs: readonly LanguagePack[];
  /** Directory holding each pack's `<grammar name>.wasm`. */
  readonly grammarDir: string;
  /** The sentence that ends a degraded pack's notice: how to restore the missing grammar. */
  readonly missingGrammarStep: string;
  /** Receives one message per degraded pack. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
  /**
   * What a degraded pack's files get, for the notice. Defaults to
   * {@link inventoryOnlyOutcome}; a caller with another parser for the
   * language says so instead.
   */
  readonly outcome?: (pack: LanguagePack) => string;
}

/** The notice clause for a degraded pack whose files get no import edges. */
export const inventoryOnlyOutcome = (pack: LanguagePack): string => `${pack.config.displayName} files get inventory only`;

/**
 * List the packs and whether each grammar is available. A missing grammar
 * degrades that language to inventory-only and is reported once through
 * `warn`; it never throws. Call once per analysis.
 */
export function loadLanguagePacks(options: LoadPacksOptions): PackStatus[] {
  const { packs, grammarDir, missingGrammarStep } = options;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const outcome = options.outcome ?? inventoryOnlyOutcome;

  return packs.map((pack) => {
    const grammarPath = join(grammarDir, `${pack.grammar.name}.wasm`);
    if (existsSync(grammarPath)) {
      return { pack, grammarPath, grammarAvailable: true, mode: "structure" };
    }
    const notice =
      `${pack.config.displayName}: grammar ${pack.grammar.name}@${pack.grammar.version} is not built ` +
      `(expected ${grammarPath}); ${outcome(pack)}. ` +
      missingGrammarStep;
    warn(notice);
    return { pack, grammarPath, grammarAvailable: false, mode: "inventory-only", notice };
  });
}
