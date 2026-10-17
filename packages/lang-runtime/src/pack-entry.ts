/**
 * The pack entry for a tree-sitter pack: lang-kit's `LanguagePackEntry` built
 * from a {@link LanguagePack}, its symbol rules and its package.
 *
 * `analyzeProject` loads the pack's grammar, compiles its queries, binds its
 * resolver to the project's build files, parses every requested file and
 * reads the captures into lang-kit facts: per file, then the pack's project
 * facts reader (if any) and each wanted framework over every parsed file at
 * once, with the pack's resolver as its context; frameworks' skips and the
 * pack's `projectNotices` come back as `notices`, and the resolver's own
 * notices only when imports are wanted. Each step that can fail for the
 * whole language — a grammar not built or not loadable, a query the grammar
 * rejects, build files that cannot be read — ends the call with a degraded
 * result instead of an exception. A framework, the project facts reader or
 * the project notices reader that throws loses only its own output, and a
 * symbol `refine` that throws on a file leaves that file the rules' symbols;
 * each is reported as a notice, so imports never depend on them. A file that cannot be read or is over the
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
import type {
  FrameworkContext,
  FrameworkFacts,
  FrameworkPack,
  LanguagePack,
  PackResolver,
  PackSourceFile,
  PreparedResolver,
} from "./pack.js";
import type { PackPackage } from "./pack-package.js";
import {
  mergeFileFacts,
  projectKinds,
  readPackFacts,
  type FileFactFields,
  type PackSymbolRules,
  type ProjectFactsReader,
} from "./pack-facts.js";
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
    // Frameworks follow references through the resolver, so they bind it as imports do.
    const wantsImports = kinds.includes("imports");
    let resolver: PackResolver | undefined;
    if ((wantsImports || frameworks.length > 0) && pack.resolver) {
      try {
        resolver = (await pack.resolver.forProject?.(request.projectDir, request.files)) ?? pack.resolver;
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

    // Prepared for imports, or on a framework's first lookup: a framework that never follows a reference costs nothing.
    let preparedOnce: PreparedResolver | undefined;
    const prepare = (bound: PackResolver): PreparedResolver => (preparedOnce ??= bound.prepare(parsed, unparsed));
    const prepared: PreparedResolver | undefined = wantsImports && resolver ? prepare(resolver) : undefined;
    const context: FrameworkContext | undefined = resolver && {
      resolve: (fromFile) => prepare(resolver).resolve(fromFile),
      module: (fromFile, specifier) => prepare(resolver).module?.(fromFile, specifier),
    };
    const project = options.projectFacts && readProjectFacts(options.projectFacts, pack, parsed, kinds);
    const framed = frameworks.map((f) => readFramework(f, parsed, kinds, context));
    const refined = containRefine(symbolRules);
    const facts: FileFacts[] = parsed.map((file) =>
      framed.reduce(
        (merged, { facts: byPath }) => mergeFileFacts(merged, byPath.get(file.path)),
        mergeFileFacts(
          readPackFacts(pack, file, { kinds, resolver: prepared, symbolRules: refined.rules }),
          project?.facts.get(file.path),
        ),
      ),
    );
    const notices = [
      ...framed.flatMap((f) => f.notices),
      ...(project?.notices ?? []),
      ...refined.notices(),
      ...(options.projectNotices ? readProjectNotices(options.projectNotices, parsed, kinds) : []),
      ...(prepared?.notices?.() ?? []),
    ];
    return notices.length === 0 ? { facts, unparsed } : { facts, unparsed, notices };
  } finally {
    runner.dispose();
  }
}

/**
 * One framework's facts. A framework that throws loses only its own facts, as
 * a notice naming it: the language's imports, symbols and other frameworks'
 * facts are still returned, and the pack is not degraded, since a reinstall
 * would not help.
 */
function readFramework(
  framework: FrameworkPack,
  files: readonly PackSourceFile[],
  kinds: readonly FactKind[],
  context: FrameworkContext | undefined,
): FrameworkFacts {
  try {
    return framework.read(files, kinds, context);
  } catch (error) {
    const lost = framework.produces.filter((kind) => kinds.includes(kind));
    return {
      facts: new Map(),
      notices: [`framework ${framework.id} failed (${errorText(error)}); its ${lost.join(" and ")} were not recorded.`],
    };
  }
}

/**
 * The project facts reader's facts. A reader that throws loses only the kinds
 * no single file answers (Terraform's resources), as a notice: imports,
 * symbols and frameworks' facts are still returned and the pack is not degraded.
 */
function readProjectFacts(
  reader: ProjectFactsReader,
  pack: LanguagePack,
  files: readonly PackSourceFile[],
  kinds: readonly FactKind[],
): { readonly facts: ReadonlyMap<string, FileFactFields>; readonly notices: readonly string[] } {
  try {
    return { facts: reader(files, kinds), notices: [] };
  } catch (error) {
    const lost = projectKinds(pack).filter((kind) => kinds.includes(kind));
    const what = lost.length === 0 ? "nothing it read was recorded" : `its ${lost.join(" and ")} were not recorded`;
    return { facts: new Map(), notices: [`the project facts reader failed (${errorText(error)}); ${what}.`] };
  }
}

/** The pack's project notices; one that throws loses them, reported as a single notice of its own. */
function readProjectNotices(
  read: NonNullable<TreeSitterEntryOptions["projectNotices"]>,
  files: readonly PackSourceFile[],
  kinds: readonly FactKind[],
): readonly string[] {
  try {
    return read(files, kinds);
  } catch (error) {
    return [`the project notices reader failed (${errorText(error)}); what the pack read but skipped is not reported.`];
  }
}

/** How many files a refine failure notice names before it counts the rest. */
const NAMED_REFINE_FAILURES = 3;

/**
 * The symbol rules with a `refine` that cannot throw: a file whose refine
 * throws keeps the symbols the rules read, without what refine adds, and is
 * named in one notice for every such file.
 */
function containRefine(rules: PackSymbolRules | undefined): {
  readonly rules: PackSymbolRules | undefined;
  readonly notices: () => readonly string[];
} {
  const refine = rules?.refine;
  if (rules === undefined || refine === undefined) return { rules, notices: () => [] };
  const failed: string[] = [];
  const contained: PackSymbolRules = {
    ...rules,
    refine: (symbols, file) => {
      try {
        return refine(symbols, file);
      } catch (error) {
        failed.push(`${file.path} (${errorText(error)})`);
        return [...symbols];
      }
    },
  };
  const notices = (): readonly string[] => {
    if (failed.length === 0) return [];
    const rest = failed.length - NAMED_REFINE_FAILURES;
    const named = failed.slice(0, NAMED_REFINE_FAILURES).join(", ") + (rest > 0 ? ` and ${rest} more` : "");
    const count = failed.length === 1 ? "1 file" : `${failed.length} files`;
    return [`symbol refinement failed on ${count}: ${named}; their symbols are the rules' reading alone.`];
  };
  return { rules: contained, notices };
}
