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
 * runner's size limit is listed in `unparsed`. Every file that does not parse
 * cleanly (syntax errors, oversized, unreadable, not valid UTF-8) is listed in
 * `parse`, which is returned with empty lists when all of them do; facts from a file with syntax
 * errors are still read from its partial tree.
 *
 * @module lang-runtime/pack-entry
 */

import { existsSync } from "node:fs";
import { isUtf8 } from "node:buffer";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FactKind,
  FileFacts,
  LanguagePackEntry,
  PackLegacySyntaxFile,
  PackParseReport,
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
  SourceRewrite,
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
import { createTreeSitterRunner, DEFAULT_MAX_FILE_BYTES, loadGrammar, type RunnablePack, type RunnerOptions } from "./runner.js";

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
  /** A complete declaration prefix whose imports can be read when the full file is oversized. */
  readonly oversizedImportSource?: (source: string) => string | undefined;
  /**
   * For a file whose parse has error or missing nodes: the same text with the
   * constructs an older version of the language allowed, and the grammar does
   * not, rewritten in place to the same length (PHP's `$s{0}` → `$s[0]`), or
   * `undefined` when there are none. The rewrite is parsed instead, its
   * rewrites travel on `PackSourceFile.rewrites`, and a file it parses cleanly
   * is reported under `parse.legacySyntax`, not `syntaxErrors`.
   */
  readonly legacySyntax?: (source: string) => { readonly source: string; readonly rewrites: readonly SourceRewrite[] } | undefined;
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
    const importsOnly = new Set<string>();
    const fallbackNotices: string[] = [];
    const issues = { syntaxErrors: [] as string[], oversized: [] as string[], unreadable: [] as string[], notUtf8: [] as string[] };
    const legacySyntax: PackLegacySyntaxFile[] = [];
    for (const path of request.files) {
      let bytes: Buffer;
      try {
        bytes = await readFile(join(request.projectDir, path));
      } catch {
        unparsed.push(path); // unreadable files are skipped, as for every other language
        issues.unreadable.push(path);
        continue;
      }
      // Decoding never throws: invalid bytes become U+FFFD and the file is still parsed.
      if (!isUtf8(bytes)) issues.notUtf8.push(path);
      const source = bytes.toString("utf8");
      // A pack may recover a complete import header without parsing the oversized body.
      let result = await runner.parseSource(target, path, source);
      if (result.status === "skipped" && wantsImports && options.oversizedImportSource) {
        try {
          const prefix = options.oversizedImportSource(source);
          if (prefix !== undefined) {
            const recovered = await runner.parseSource(target, path, prefix);
            if (recovered.status === "parsed" && !recovered.hasErrorNodes && !recovered.hasMissingNodes) {
              result = recovered;
              importsOnly.add(path);
            }
          }
        } catch (error) {
          fallbackNotices.push(`${path} oversized import recovery failed (${errorText(error)}); left unparsed`);
        }
      }
      // Legacy syntax: parse the same-length rewrite instead, so the facts come from a whole tree.
      let rewrites: readonly SourceRewrite[] | undefined;
      if (result.status === "parsed" && !importsOnly.has(path) && (result.hasErrorNodes || result.hasMissingNodes) && options.legacySyntax) {
        try {
          const rewritten = options.legacySyntax(source);
          if (rewritten !== undefined && rewritten.rewrites.length > 0 && rewritten.source.length === source.length) {
            const reparsed = await runner.parseSource(target, path, rewritten.source);
            if (reparsed.status === "parsed") {
              result = reparsed;
              rewrites = rewritten.rewrites;
              if (!reparsed.hasErrorNodes && !reparsed.hasMissingNodes) legacySyntax.push({ path, constructs: countConstructs(rewrites) });
            }
          }
        } catch (error) {
          fallbackNotices.push(`${path} legacy-syntax rewrite failed (${errorText(error)}); facts read from the partial tree`);
        }
      }
      // A file whose imports came from its declaration prefix is still oversized: its structure was not parsed.
      if (result.status === "skipped" || importsOnly.has(path)) issues.oversized.push(path);
      else if (result.hasErrorNodes || result.hasMissingNodes) issues.syntaxErrors.push(path);
      if (result.status === "parsed") parsed.push(rewrites === undefined ? { path, captures: result.captures } : { path, captures: result.captures, rewrites });
      else unparsed.push(path);
    }
    // Reported even when every file parsed cleanly, so a clean parse reads as zero counts, not as no report.
    const parse: PackParseReport = {
      files: request.files.length,
      sizeLimitBytes: options.runner?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      ...issues,
      ...(legacySyntax.length === 0 ? {} : { legacySyntax }),
    };

    // Prepared for imports, or on a framework's first lookup: a framework that never follows a reference costs nothing.
    let preparedOnce: PreparedResolver | undefined;
    const prepare = (bound: PackResolver): PreparedResolver => (preparedOnce ??= bound.prepare(parsed, unparsed));
    const prepared: PreparedResolver | undefined = wantsImports && resolver ? prepare(resolver) : undefined;
    const context: FrameworkContext | undefined = resolver && {
      resolve: (fromFile) => prepare(resolver).resolve(fromFile),
      module: (fromFile, specifier) => prepare(resolver).module?.(fromFile, specifier),
      configFiles: () => resolver.configFiles?.() ?? new Map(),
    };
    const structural = parsed.filter((file) => !importsOnly.has(file.path));
    const project = options.projectFacts && readProjectFacts(options.projectFacts, pack, structural, kinds);
    const framed = frameworks.map((f) => readFramework(f, structural, kinds, context));
    const refined = containRefine(pack, symbolRules);
    const facts: FileFacts[] = parsed.map((file) =>
      framed.reduce(
        (merged, { facts: byPath }) => mergeFileFacts(merged, byPath.get(file.path)),
        mergeFileFacts(
          readPackFacts(pack, file, { kinds: importsOnly.has(file.path) ? ["imports"] : kinds, resolver: prepared, symbolRules: refined.rules }),
          project?.facts.get(file.path),
        ),
      ),
    );
    const notices = [
      ...fallbackNotices,
      ...[...importsOnly].map((path) => `${path} exceeds the parser size limit; imports read from its declaration prefix, structure skipped`),
      ...framed.flatMap((f) => f.notices),
      ...(project?.notices ?? []),
      ...refined.notices(),
      ...(options.projectNotices ? readProjectNotices(options.projectNotices, pack, structural, kinds) : []),
      ...(prepared?.notices?.() ?? []),
    ];
    return { facts, unparsed, ...(notices.length === 0 ? {} : { notices }), parse };
  } finally {
    runner.dispose();
  }
}

/** Rewrites by construct, keys in first-seen order. */
function countConstructs(rewrites: readonly SourceRewrite[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rewrites) counts[r.construct] = (counts[r.construct] ?? 0) + 1;
  return counts;
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
    return {
      facts: new Map(),
      notices: [`${pack.config.displayName}: the project facts reader failed (${errorText(error)}); ${what}.`],
    };
  }
}

/** The pack's project notices; one that throws loses them, reported as a single notice of its own. */
function readProjectNotices(
  read: NonNullable<TreeSitterEntryOptions["projectNotices"]>,
  pack: LanguagePack,
  files: readonly PackSourceFile[],
  kinds: readonly FactKind[],
): readonly string[] {
  try {
    return read(files, kinds);
  } catch (error) {
    return [`${pack.config.displayName}: the project notices reader failed (${errorText(error)}); what the pack read but skipped is not reported.`];
  }
}

/** How many files a refine failure notice names before it counts the rest. */
const NAMED_REFINE_FAILURES = 3;

/**
 * The symbol rules with a `refine` that cannot throw: a file whose refine
 * throws keeps the symbols the rules read, without what refine adds, and is
 * named in one notice for every such file.
 */
function containRefine(pack: LanguagePack, rules: PackSymbolRules | undefined): {
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
    return [`${pack.config.displayName}: symbol refinement failed on ${count}: ${named}; their symbols are the rules' reading alone.`];
  };
  return { rules: contained, notices };
}
