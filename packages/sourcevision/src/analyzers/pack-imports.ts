/**
 * Import graph for languages analyzed through a language pack (tree-sitter
 * grammar, queries and resolver) — Java today.
 *
 * Resolution needs an index of the whole project, so every file of a pack's
 * language is parsed on each run, incremental or not. A pack whose grammar is
 * not built, or built but unloadable, leaves its language inventory-only: it is
 * reported once and no edges are produced.
 *
 * @module sourcevision/analyzers/pack-imports
 */

import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ExternalImport, ImportEdge, Inventory } from "../schema/index.js";
import { BUILTIN_PACKS, loadLanguagePacks, type LanguagePack, type PackSourceFile } from "../language/pack.js";
import { createTreeSitterRunner, loadGrammar, type RunnablePack } from "../language/runner.js";

export interface PackImportsOptions {
  /** Defaults to {@link BUILTIN_PACKS}. */
  readonly packs?: readonly LanguagePack[];
  /** Where built grammars are read from; defaults to the pack loader's directory. */
  readonly grammarDir?: string;
  /** Receives the notice for a pack whose grammar is not built. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
}

export interface PackImportGraph {
  readonly edges: ImportEdge[];
  readonly external: ExternalImport[];
}

/**
 * Packs whose files the imports phase analyzes, given the extensions it
 * parses. Only a pack with a resolver counts: one without produces no edges,
 * and counting it would make `analyzeImports` re-parse its files on every
 * incremental run. Go, for example, is structure-only and keeps its own parser.
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

  const present = (options.packs ?? BUILTIN_PACKS).filter((pack) => pack.resolver !== undefined && files.some((f) => isPackFile(f.path, [pack])));
  if (present.length === 0) return { edges, external: [] };

  const statuses = loadLanguagePacks({ packs: present, grammarDir: options.grammarDir, warn: options.warn });
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const runner = createTreeSitterRunner();
  try {
    for (const status of statuses) {
      if (status.mode !== "structure" || !status.pack.resolver) continue;
      // A grammar can exist yet fail to load (ABI mismatch, truncated build).
      // Degrade that language to inventory-only rather than failing the phase
      // and with it every other language's edges.
      try {
        await loadGrammar(status.grammarPath);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const name = status.pack.config.displayName;
        warn(
          `${name}: grammar ${status.grammarPath} could not be loaded (${reason}); ${name} files get inventory only. ` +
            "Rebuild it with `pnpm --filter @n-dx/sourcevision build:grammars` in the n-dx checkout, or reinstall n-dx.",
        );
        continue;
      }
      const target: RunnablePack = { pack: status.pack, grammarPath: status.grammarPath };
      // A loadable grammar can still reject a query (a stale build that predates
      // a query edit). Same degradation, one notice for the pack.
      try {
        await runner.prepare(target);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const name = status.pack.config.displayName;
        warn(
          `${name}: a query could not be compiled against grammar ${status.grammarPath} (${reason}); ${name} files get inventory only. ` +
            "Rebuild it with `pnpm --filter @n-dx/sourcevision build:grammars` in the n-dx checkout, or reinstall n-dx.",
        );
        continue;
      }
      const parsed = await parsePackFiles(runner, target, files, targetDir);
      const prepared = status.pack.resolver.prepare(parsed);

      for (const { path } of parsed) {
        const refs = prepared.resolve(path);
        for (const ref of refs.files) {
          edges.push({ from: path, to: ref.to, type: "static", symbols: [...ref.symbols] });
        }
        for (const ext of refs.external) {
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

  return { edges, external: [...external.values()] };
}

async function parsePackFiles(
  runner: ReturnType<typeof createTreeSitterRunner>,
  target: RunnablePack,
  files: Inventory["files"],
  targetDir: string,
): Promise<PackSourceFile[]> {
  const parsed: PackSourceFile[] = [];
  for (const file of files) {
    if (!isPackFile(file.path, [target.pack])) continue;
    let source: string;
    try {
      source = await readFile(join(targetDir, file.path), "utf-8");
    } catch {
      continue; // unreadable files are skipped, as for every other language
    }
    // Oversized files are skipped by the runner and contribute no references.
    const result = await runner.parseSource(target, file.path, source);
    if (result.status === "parsed") parsed.push({ path: file.path, captures: result.captures });
  }
  return parsed;
}
