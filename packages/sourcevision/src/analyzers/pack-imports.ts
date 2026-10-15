/**
 * Import graph for languages analyzed through a language pack — Java and Go.
 *
 * Each pack is a package loaded at run time (`language/pack-loader.ts`).
 * Resolution needs an index of the whole project, so every file of a pack's
 * language goes to the pack on each run, incremental or not. A pack degrades
 * when it is missing, of another version or not a pack entry, when its
 * `produces` omits "imports", or when it reports that it could not run (its
 * grammar is not built or will not load, a query will not compile, the
 * project's build files cannot be read), or when its `analyzeProject` rejects
 * anyway (a defect in the pack). It is reported once, produces no
 * edges, and is listed in {@link PackImportGraph.degraded} so a caller with
 * another parser for the language (Go's regex parser) can run it.
 *
 * Edges and externals come from each file's lang-kit imports facts.
 *
 * @module sourcevision/analyzers/pack-imports
 */

import { extname } from "node:path";
import type { LanguageConfig, PackDegradation, PackProjectResult } from "@n-dx/lang-kit";
import type { ExternalImport, ImportEdge, Inventory } from "../schema/index.js";
import {
  KNOWN_PACKS,
  loadPack,
  packInstallCommand,
  type KnownPack,
  type PackLoaderOptions,
} from "../language/pack-loader.js";

export interface PackImportsOptions {
  /** Defaults to {@link KNOWN_PACKS}. */
  readonly packs?: readonly KnownPack[];
  /** Where and how packs are found; see `loadPack`. */
  readonly loader?: PackLoaderOptions;
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

/** Packs whose files the imports phase analyzes, given the extensions it parses. */
export function packsFor(parseableExtensions: ReadonlySet<string>, packs: readonly KnownPack[] = KNOWN_PACKS): KnownPack[] {
  return packs.filter((pack) => [...pack.config.parseableExtensions].some((ext) => parseableExtensions.has(ext)));
}

/** True when `path` belongs to one of `packs`. */
export function isPackFile(path: string, packs: readonly { readonly config: LanguageConfig }[]): boolean {
  const ext = extname(path).toLowerCase();
  return packs.some((pack) => pack.config.parseableExtensions.has(ext));
}

/**
 * Hand every file of each pack's language to the pack and read its imports
 * facts into file-to-file edges and external packages. Packs with no files in
 * `files` are not loaded, so they never report anything.
 */
export async function buildPackImportGraph(
  files: Inventory["files"],
  targetDir: string,
  options: PackImportsOptions = {},
): Promise<PackImportGraph> {
  const edges: ImportEdge[] = [];
  const external = new Map<string, ExternalImport>();
  const degraded: string[] = [];

  const warn = options.warn ?? ((message: string) => console.warn(message));
  /** One notice: what failed, what the language gets instead, how to fix it. */
  const degrade = (pack: KnownPack, notice: PackDegradation): void => {
    const name = pack.config.displayName;
    const fallback = options.fallbacks?.get(pack.id);
    const outcome = fallback ? `${name} imports come from ${fallback}` : `${name} files get inventory only`;
    warn(`${name}: ${notice.reason}; ${outcome}.${notice.remedy === undefined ? "" : ` ${notice.remedy}`}`);
    degraded.push(pack.id);
  };

  for (const pack of options.packs ?? KNOWN_PACKS) {
    const paths = files.filter((f) => isPackFile(f.path, [pack])).map((f) => f.path);
    if (paths.length === 0) continue;

    const load = await loadPack(pack, options.loader);
    if (load.status !== "loaded") {
      degrade(pack, load.notice);
      continue;
    }
    // A pack that does not produce imports would read every file for no
    // edges, so degrade it before it runs and let a fallback parser run.
    if (!load.entry.produces.includes("imports")) {
      degrade(pack, { reason: 'the pack does not produce "imports"' });
      continue;
    }
    // The entry contract says a pack does not throw for its own failures, but a
    // resolver bug or a pack built against another contract can still reject;
    // that must cost only this language, as a missing pack does.
    let result: PackProjectResult;
    try {
      result = await load.entry.analyzeProject({ projectDir: targetDir, files: paths, kinds: ["imports"] });
    } catch (error) {
      degrade(pack, {
        reason: `the pack failed (${error instanceof Error ? error.message : String(error)})`,
        remedy: `Reinstall it with \`${packInstallCommand(pack)}\`.`,
      });
      continue;
    }
    if (result.degraded) {
      degrade(pack, result.degraded);
      continue;
    }

    for (const { path, imports } of result.facts) {
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

  return { edges, external: [...external.values()], degraded };
}
