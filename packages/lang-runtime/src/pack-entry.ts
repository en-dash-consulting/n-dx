/**
 * The pack entry for a tree-sitter pack: lang-kit's `LanguagePackEntry` built
 * from a {@link LanguagePack}, its symbol rules and its package.
 *
 * `analyzeProject` loads the pack's grammar, compiles its queries, binds its
 * resolver to the project's build files, parses every requested file and
 * reads the captures into lang-kit facts: per file, then the pack's project
 * facts reader (if any) and each wanted framework over every parsed file at
 * once; frameworks' skips and the pack's `projectNotices` come back as
 * `notices`. Each step that can fail for the
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
import { mergeFileFacts, readPackFacts, type PackSymbolRules, type ProjectFactsReader } from "./pack-facts.js";
import { createTreeSitterRunner, loadGrammar, type RunnablePack, type RunnerOptions } from "./runner.js";

export interface TreeSitterEntryOptions {
  /** The package the pack ships in; its grammar is read from `package.grammarDir()`. */
  readonly package: PackPackage;
  readonly pack: LanguagePack;
  /** Required when the pack produces `symbols`. */
  readonly symbolRules?: PackSymbolRules;
  /** Required when the pack produces a kind read over the whole project (`resources`). */
  readonly projectFacts?: ProjectFactsReader;
  /**
   * What the pack read but does not report as facts (Python's dynamic
   * imports), one sentence each, from every parsed file and the kinds wanted;
   * returned as the entry's `notices` after the frameworks'.
   */
  readonly projectNotices?: (files: readonly PackSourceFile[], kinds: readonly FactKind[]) => readonly string[];
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

  // Framework queries join the parse only when a kind they produce is wanted.
  const frameworks = (pack.frameworks ?? []).filter((f) => f.produces.some((kind) => kinds.includes(kind)));
  const runnable: LanguagePack =
    frameworks.length === 0 ? pack : { ...pack, queries: [...pack.queries, ...frameworks.flatMap((f) => f.queries)] };

  const runner = createTreeSitterRunner(options.runner);
  try {
    const target: RunnablePack = { pack: runnable, grammarPath };
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
    const project = options.projectFacts?.(parsed, kinds);
    const framed = frameworks.map((f) => f.read(parsed, kinds));
    const facts: FileFacts[] = parsed.map((file) =>
      framed.reduce(
        (merged, { facts: byPath }) => mergeFileFacts(merged, byPath.get(file.path)),
        mergeFileFacts(readPackFacts(pack, file, { kinds, resolver: prepared, symbolRules }), project?.get(file.path)),
      ),
    );
    const notices = [...framed.flatMap((f) => f.notices), ...(options.projectNotices?.(parsed, kinds) ?? [])];
    return notices.length === 0 ? { facts, unparsed } : { facts, unparsed, notices };
  } finally {
    runner.dispose();
  }
}
