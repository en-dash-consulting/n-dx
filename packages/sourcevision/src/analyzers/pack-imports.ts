/**
 * Import graph for languages analyzed through a language pack (tree-sitter
 * grammar, queries and resolver) — Java and Go.
 *
 * Resolution needs an index of the whole project, so every file of a pack's
 * language is parsed on each run, incremental or not. A pack degrades when its
 * `produces` omits "imports", its grammar is not built or will not load, a query will not compile against it,
 * or its resolver cannot read the project's build files. It is reported once,
 * produces no edges, and is listed in {@link PackImportGraph.degraded} so a
 * caller with another parser for the language (Go's regex parser) can run it.
 *
 * Edges and externals come from each file's lang-kit imports facts, read by
 * `language/pack-facts.ts` from the pack's resolver.
 *
 * @module sourcevision/analyzers/pack-imports
 */

import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ExternalImport, ImportEdge, Inventory } from "../schema/index.js";
import {
  BUILTIN_PACKS,
  inventoryOnlyOutcome,
  loadLanguagePacks,
  type LanguagePack,
  type PackResolver,
  type PackSourceFile,
} from "../language/pack.js";
import { readPackFacts } from "../language/pack-facts.js";
import { createTreeSitterRunner, loadGrammar, type RunnablePack } from "../language/runner.js";

export interface PackImportsOptions {
  /** Defaults to {@link BUILTIN_PACKS}. */
  readonly packs?: readonly LanguagePack[];
  /** Where built grammars are read from; defaults to the pack loader's directory. */
  readonly grammarDir?: string;
  /** Receives the notice for a pack that degrades. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
  /**
   * Pack id → the parser the caller runs for that language when the pack
   * degrades (e.g. "the regex import parser"); the notice names it instead of
   * inventory-only.
   */
  readonly fallbacks?: ReadonlyMap<string, string>;
}

export interface PackImportGraph {
  readonly edges: ImportEdge[];
  readonly external: ExternalImport[];
  /** Ids of packs that had files but degraded, so produced no edges. */
  readonly degraded: string[];
}

/**
 * Packs whose files the imports phase analyzes, given the extensions it
 * parses. Only a pack with a resolver counts: one without produces no edges,
 * and counting it would make `analyzeImports` re-parse its files on every
 * incremental run.
 */
export function packsFor(parseableExtensions: ReadonlySet<string>, packs: readonly LanguagePack[] = BUILTIN_PACKS): LanguagePack[] {
  return packs.filter(
    (pack) => pack.resolver !== undefined && [...pack.config.parseableExtensions].some((ext) => parseableExtensions.has(ext)),
  );
}

/** True when `path` belongs to one of `packs`. */
export function isPackFile(path: string, packs: readonly LanguagePack[]): boolean {
  const ext = extname(path).toLowerCase();
  return packs.some((pack) => pack.config.parseableExtensions.has(ext));
}

const REBUILD_STEP =
  "Rebuild it with `pnpm --filter @n-dx/sourcevision build:grammars` in the n-dx checkout, or reinstall n-dx.";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Parse every file of each pack's language and resolve its references into
 * file-to-file edges and external packages. Packs with no files in
 * `files` are not loaded, so they never report a missing grammar.
 */
export async function buildPackImportGraph(
  files: Inventory["files"],
  targetDir: string,
  options: PackImportsOptions = {},
): Promise<PackImportGraph> {
  const edges: ImportEdge[] = [];
  const external = new Map<string, ExternalImport>();
  const degraded: string[] = [];

  const present = (options.packs ?? BUILTIN_PACKS).filter((pack) => pack.resolver !== undefined && files.some((f) => isPackFile(f.path, [pack])));
  if (present.length === 0) return { edges, external: [], degraded };

  const outcome = (pack: LanguagePack): string => {
    const fallback = options.fallbacks?.get(pack.id);
    return fallback ? `${pack.config.displayName} imports come from ${fallback}` : inventoryOnlyOutcome(pack);
  };
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const degrade = (pack: LanguagePack, message: string): void => {
    warn(message);
    degraded.push(pack.id);
  };
  // A resolver's references reach the graph only as the pack's imports facts.
  // A pack that does not produce them would parse every file for no edges, so
  // degrade it before its grammar is loaded and let a fallback parser run.
  const readable = present.filter((pack) => {
    if (pack.produces.includes("imports")) return true;
    degrade(pack, `${pack.config.displayName}: the pack has a resolver but does not produce "imports"; ${outcome(pack)}.`);
    return false;
  });
  const statuses = loadLanguagePacks({ packs: readable, grammarDir: options.grammarDir, warn: options.warn, outcome });
  const runner = createTreeSitterRunner();
  try {
    for (const status of statuses) {
      const pack = status.pack;
      if (!pack.resolver) continue;
      if (status.mode !== "structure") {
        degraded.push(pack.id); // the loader has reported it
        continue;
      }
      const name = pack.config.displayName;
      // A grammar can exist yet fail to load (ABI mismatch, truncated build).
      // Degrade that language rather than failing the phase and with it every
      // other language's edges.
      try {
        await loadGrammar(status.grammarPath);
      } catch (error) {
        degrade(pack, `${name}: grammar ${status.grammarPath} could not be loaded (${errorText(error)}); ${outcome(pack)}. ${REBUILD_STEP}`);
        continue;
      }
      const target: RunnablePack = { pack, grammarPath: status.grammarPath };
      // A loadable grammar can still reject a query (a stale build that predates
      // a query edit). Same degradation, one notice for the pack.
      try {
        await runner.prepare(target);
      } catch (error) {
        degrade(
          pack,
          `${name}: a query could not be compiled against grammar ${status.grammarPath} (${errorText(error)}); ${outcome(pack)}. ${REBUILD_STEP}`,
        );
        continue;
      }
      // Reading the project's build files (go.mod, go.work) can fail too.
      let resolver: PackResolver;
      try {
        resolver = (await pack.resolver.forProject?.(targetDir)) ?? pack.resolver;
      } catch (error) {
        degrade(pack, `${name}: the project's build files could not be read (${errorText(error)}); ${outcome(pack)}.`);
        continue;
      }
      const { parsed, unparsed } = await parsePackFiles(runner, target, files, targetDir);
      const prepared = resolver.prepare(parsed, unparsed);

      for (const file of parsed) {
        const { path, imports } = readPackFacts(pack, file, { kinds: ["imports"], resolver: prepared });
        if (!imports) continue;
        for (const ref of imports.files) {
          edges.push({ from: path, to: ref.to, type: "static", symbols: [...ref.symbols] });
        }
        for (const ext of imports.external) {
          const existing = external.get(ext.package);
          if (existing) {
            existing.importedBy.push(path);
            existing.symbols = Array.from(new Set([...existing.symbols, ...ext.symbols]));
          } else {
            external.set(ext.package, { package: ext.package, importedBy: [path], symbols: [...ext.symbols] });
          }
        }
      }
    }
  } finally {
    runner.dispose();
  }

  return { edges, external: [...external.values()], degraded };
}

async function parsePackFiles(
  runner: ReturnType<typeof createTreeSitterRunner>,
  target: RunnablePack,
  files: Inventory["files"],
  targetDir: string,
): Promise<{ parsed: PackSourceFile[]; unparsed: string[] }> {
  const parsed: PackSourceFile[] = [];
  const unparsed: string[] = [];
  for (const file of files) {
    if (!isPackFile(file.path, [target.pack])) continue;
    let source: string;
    try {
      source = await readFile(join(targetDir, file.path), "utf-8");
    } catch {
      unparsed.push(file.path); // unreadable files are skipped, as for every other language
      continue;
    }
    // Oversized files are skipped by the runner and contribute no references.
    const result = await runner.parseSource(target, file.path, source);
    if (result.status === "parsed") parsed.push({ path: file.path, captures: result.captures });
    else unparsed.push(file.path);
  }
  return { parsed, unparsed };
}
