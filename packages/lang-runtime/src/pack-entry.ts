/**
 * The pack entry for a tree-sitter pack: lang-kit's `LanguagePackEntry` built
 * from a {@link LanguagePack}, its symbol rules and its package.
 *
 * `analyzeProject` loads the pack's grammar, compiles its queries, binds its
 * resolver to the project's build files, parses every requested file and
 * reads the captures into lang-kit facts. Each step that can fail for the
 * whole language — a grammar not built or not loadable, a query the grammar
 * rejects, build files that cannot be read — ends the call with a degraded
 * result instead of an exception. A file that cannot be read or is over the
 * runner's size limit is listed in `unparsed`.
 *
 * @module lang-runtime/pack-entry
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FactKind,
  FileFacts,
  LanguagePackEntry,
  PackProjectRequest,
  PackProjectResult,
} from "@n-dx/lang-kit";
import type { LanguagePack, PackResolver, PackSourceFile, PreparedResolver } from "./pack.js";
import type { PackPackage } from "./pack-package.js";
import { readPackFacts, type PackSymbolRules } from "./pack-facts.js";
import { createTreeSitterRunner, loadGrammar, type RunnablePack, type RunnerOptions } from "./runner.js";

export interface TreeSitterEntryOptions {
  /** The package the pack ships in; its grammar is read from `package.grammarDir()`. */
  readonly package: PackPackage;
  readonly pack: LanguagePack;
  /** Required when the pack produces `symbols`. */
  readonly symbolRules?: PackSymbolRules;
  readonly runner?: RunnerOptions;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const degraded = (reason: string, remedy?: string): PackProjectResult => ({
  facts: [],
  unparsed: [],
  degraded: remedy === undefined ? { reason } : { reason, remedy },
});

/** The pack entry a tree-sitter pack package exports as `pack`. */
export function createPackEntry(options: TreeSitterEntryOptions): LanguagePackEntry {
  const { package: pkg, pack } = options;
  return {
    packageName: pkg.name,
    get version() {
      return pkg.version();
    },
    id: pack.id,
    config: pack.config,
    produces: pack.produces,
    analyzeProject: (request) => analyzeProject(options, request),
  };
}

async function analyzeProject(options: TreeSitterEntryOptions, request: PackProjectRequest): Promise<PackProjectResult> {
  const { package: pkg, pack, symbolRules } = options;
  const kinds: readonly FactKind[] = (request.kinds ?? pack.produces).filter((kind) => pack.produces.includes(kind));
  const grammarPath = join(pkg.grammarDir(), `${pack.grammar.name}.wasm`);
  if (!existsSync(grammarPath)) {
    return degraded(
      `grammar ${pack.grammar.name}@${pack.grammar.version} is not built (expected ${grammarPath})`,
      pkg.missingGrammarStep(),
    );
  }
  // A grammar can exist yet fail to load (ABI mismatch, truncated build).
  try {
    await loadGrammar(grammarPath);
  } catch (error) {
    return degraded(`grammar ${grammarPath} could not be loaded (${errorText(error)})`, pkg.rebuildStep());
  }

  const runner = createTreeSitterRunner(options.runner);
  try {
    const target: RunnablePack = { pack, grammarPath };
    // A loadable grammar can still reject a query (a stale build that predates a query edit).
    try {
      await runner.prepare(target);
    } catch (error) {
      return degraded(`a query could not be compiled against grammar ${grammarPath} (${errorText(error)})`, pkg.rebuildStep());
    }
    // Reading the project's build files (go.mod, go.work) can fail too.
    let resolver: PackResolver | undefined;
    if (kinds.includes("imports") && pack.resolver) {
      try {
        resolver = (await pack.resolver.forProject?.(request.projectDir)) ?? pack.resolver;
      } catch (error) {
        return degraded(`the project's build files could not be read (${errorText(error)})`);
      }
    }

    const parsed: PackSourceFile[] = [];
    const unparsed: string[] = [];
    for (const path of request.files) {
      let source: string;
      try {
        source = await readFile(join(request.projectDir, path), "utf-8");
      } catch {
        unparsed.push(path); // unreadable files are skipped, as for every other language
        continue;
      }
      // Oversized files are skipped by the runner and contribute no references.
      const result = await runner.parseSource(target, path, source);
      if (result.status === "parsed") parsed.push({ path, captures: result.captures });
      else unparsed.push(path);
    }

    const prepared: PreparedResolver | undefined = resolver?.prepare(parsed, unparsed);
    const facts: FileFacts[] = parsed.map((file) => readPackFacts(pack, file, { kinds, resolver: prepared, symbolRules }));
    return { facts, unparsed };
  } finally {
    runner.dispose();
  }
}
