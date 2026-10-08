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
import { fileURLToPath } from "node:url";
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

/** Resolves a reference in one source file to the project files it names. */
export interface PackResolver {
  /**
   * @param specifier The reference as written, e.g. an import name.
   * @param fromFile  Project-relative path of the referencing file.
   * @returns Project-relative paths of the target files; empty when external or unresolved.
   */
  resolve(specifier: string, fromFile: string): readonly string[];
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

/** Packs registered in sourcevision. Java joins when it is registered as a language. */
export const BUILTIN_PACKS: readonly LanguagePack[] = [];

/**
 * Where `scripts/build-grammars.mjs` writes grammars: `<package>/build/grammars`.
 * Resolves the same from `src/language/` and `dist/language/`.
 */
export const DEFAULT_GRAMMAR_DIR = fileURLToPath(new URL("../../build/grammars", import.meta.url));

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
  /** Defaults to {@link DEFAULT_GRAMMAR_DIR}. */
  readonly grammarDir?: string;
  /** Receives one message per degraded pack. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
}

/**
 * List the packs and whether each grammar is available. A missing grammar
 * degrades that language to inventory-only and is reported once through
 * `warn`; it never throws. Call once per analysis.
 */
export function loadLanguagePacks(options: LoadPacksOptions = {}): PackStatus[] {
  const packs = options.packs ?? BUILTIN_PACKS;
  const grammarDir = options.grammarDir ?? DEFAULT_GRAMMAR_DIR;
  const warn = options.warn ?? ((message: string) => console.warn(message));

  return packs.map((pack) => {
    const grammarPath = join(grammarDir, `${pack.grammar.name}.wasm`);
    if (existsSync(grammarPath)) {
      return { pack, grammarPath, grammarAvailable: true, mode: "structure" };
    }
    const notice =
      `${pack.config.displayName}: grammar ${pack.grammar.name}@${pack.grammar.version} is not built ` +
      `(expected ${grammarPath}); ${pack.config.displayName} files get inventory only. ` +
      `Build it with sourcevision's scripts/build-grammars.mjs.`;
    warn(notice);
    return { pack, grammarPath, grammarAvailable: false, mode: "inventory-only", notice };
  });
}
