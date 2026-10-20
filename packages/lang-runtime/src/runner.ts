/**
 * Tree-sitter runner — parses files with a pack's grammar and runs its queries.
 *
 * web-tree-sitter is initialised once per process and each grammar is loaded
 * at most once per process, on first use. A runner compiles each pack's query
 * files once and frees them in {@link TreeSitterRunner.dispose}; every parse
 * tree is freed before `parse` returns. Files above the size limit are
 * skipped and counted rather than parsed.
 *
 * @module lang-runtime/runner
 */

import { readFileSync, statSync } from "node:fs";
import { Language, Parser, Query, type Node } from "web-tree-sitter";
import type { Capture, LanguagePack, SourcePosition } from "./pack.js";

// ── Process-wide state ──────────────────────────────────────────────────────

let initialised: Promise<void> | undefined;
const grammars = new Map<string, Promise<Language>>();

/** Initialise web-tree-sitter; later calls share the first. */
export function initTreeSitter(): Promise<void> {
  initialised ??= Parser.init();
  return initialised;
}

/** Load a grammar WASM; each path is loaded at most once per process. */
export function loadGrammar(grammarPath: string): Promise<Language> {
  let grammar = grammars.get(grammarPath);
  if (!grammar) {
    grammar = initTreeSitter().then(() => Language.load(grammarPath));
    // A failed load is not cached, so a grammar built later can still load.
    grammar.catch(() => grammars.delete(grammarPath));
    grammars.set(grammarPath, grammar);
  }
  return grammar;
}

// ── Results ─────────────────────────────────────────────────────────────────

export type { Capture, SourcePosition };

export interface ParsedFile {
  readonly status: "parsed";
  readonly path: string;
  /** The tree contains at least one ERROR node. */
  readonly hasErrorNodes: boolean;
  /** The tree contains at least one MISSING node (inserted during recovery). */
  readonly hasMissingNodes: boolean;
  /** Captures per query name, in document order. */
  readonly captures: Readonly<Record<string, readonly Capture[]>>;
}

export interface SkippedFile {
  readonly status: "skipped";
  readonly path: string;
  readonly reason: "oversized";
  readonly sizeBytes: number;
}

export type FileResult = ParsedFile | SkippedFile;

export interface RunnerStats {
  readonly parsed: number;
  readonly skippedOversized: number;
}

// ── Runner ──────────────────────────────────────────────────────────────────

/** Files above this many bytes are skipped unless the runner is told otherwise. */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

export interface RunnerOptions {
  /** Defaults to {@link DEFAULT_MAX_FILE_BYTES}. */
  readonly maxFileBytes?: number;
}

/** A pack whose grammar is available, e.g. a `structure`-mode `PackStatus`. */
export interface RunnablePack {
  readonly pack: LanguagePack;
  readonly grammarPath: string;
}

export interface TreeSitterRunner {
  /** Parse a file from disk and run every query of the pack over it. */
  parseFile(target: RunnablePack, path: string): Promise<FileResult>;
  /** Parse source already in memory; `path` labels the result. */
  parseSource(target: RunnablePack, path: string, source: string): Promise<FileResult>;
  /** Load the grammar and compile the pack's queries without parsing; rejects when either fails. */
  prepare(target: RunnablePack): Promise<void>;
  stats(): RunnerStats;
  /** Free the parser and every compiled query. The runner is unusable afterwards. */
  dispose(): void;
}

interface CompiledPack {
  readonly language: Language;
  readonly queries: ReadonlyArray<{ readonly name: string; readonly query: Query }>;
}

export function createTreeSitterRunner(options: RunnerOptions = {}): TreeSitterRunner {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const compiled = new Map<string, Promise<CompiledPack>>();
  /** Every query this runner compiled, freed by `dispose`. */
  const owned: Query[] = [];
  let parser: Parser | undefined;
  let parsed = 0;
  let skippedOversized = 0;
  let disposed = false;

  function compile(target: RunnablePack): Promise<CompiledPack> {
    // Query names are in the key: a pack runs with its framework queries added only when they are wanted.
    const key = [target.pack.id, target.grammarPath, ...target.pack.queries.map((q) => q.name)].join("\0");
    let entry = compiled.get(key);
    if (!entry) {
      entry = loadGrammar(target.grammarPath).then((language) => {
        // Compiling after dispose() would leave queries nothing frees.
        assertLive();
        const queries = target.pack.queries.map((q) => {
          const query = new Query(language, readFileSync(q.path, "utf8"));
          owned.push(query);
          return { name: q.name, query };
        });
        return { language, queries };
      });
      entry.catch(() => compiled.delete(key));
      compiled.set(key, entry);
    }
    return entry;
  }

  function assertLive(): void {
    if (disposed) throw new Error("tree-sitter runner used after dispose()");
  }

  function skip(path: string, sizeBytes: number): SkippedFile {
    skippedOversized++;
    return { status: "skipped", path, reason: "oversized", sizeBytes };
  }

  async function parseSource(target: RunnablePack, path: string, source: string): Promise<FileResult> {
    assertLive();
    const sizeBytes = Buffer.byteLength(source, "utf8");
    if (sizeBytes > maxFileBytes) return skip(path, sizeBytes);

    const { language, queries } = await compile(target);
    // dispose() may have run during the await; the freed parser and queries
    // would then be used from inside the process-wide WASM heap.
    assertLive();
    parser ??= new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source);
    if (!tree) throw new Error(`tree-sitter returned no tree for ${path}`);

    try {
      const root = tree.rootNode;
      const captures: Record<string, Capture[]> = {};
      for (const { name, query } of queries) {
        // A capture named `@_…` exists only for a predicate to test (the
        // tree-sitter convention), so it is not part of the output.
        captures[name] = query
          .captures(root)
          .filter(({ name: capture }) => !capture.startsWith("_"))
          .map(({ name: capture, node }) => ({
            name: capture,
            nodeType: node.type,
            text: node.text,
            start: { line: node.startPosition.row + 1, column: node.startPosition.column },
            end: { line: node.endPosition.row + 1, column: node.endPosition.column },
          }));
      }
      parsed++;
      return { status: "parsed", path, ...findErrorNodes(root), captures };
    } finally {
      tree.delete();
    }
  }

  return {
    parseSource,
    async prepare(target) {
      assertLive();
      await compile(target);
    },
    async parseFile(target, path) {
      const sizeBytes = statSync(path).size;
      if (sizeBytes > maxFileBytes) return skip(path, sizeBytes);
      return parseSource(target, path, readFileSync(path, "utf8"));
    },
    stats: () => ({ parsed, skippedOversized }),
    dispose() {
      if (disposed) return;
      disposed = true;
      parser?.delete();
      for (const query of owned.splice(0)) query.delete();
      compiled.clear();
    },
  };
}

/** Walk only the subtrees that report an error, noting ERROR and MISSING nodes. */
function findErrorNodes(root: Node): { hasErrorNodes: boolean; hasMissingNodes: boolean } {
  let hasErrorNodes = false;
  let hasMissingNodes = false;
  if (!root.hasError) return { hasErrorNodes, hasMissingNodes };

  const pending: Node[] = [root];
  while (pending.length > 0 && !(hasErrorNodes && hasMissingNodes)) {
    const node = pending.pop()!;
    if (node.isError) hasErrorNodes = true;
    if (node.isMissing) hasMissingNodes = true;
    for (const child of node.children) {
      if (child?.hasError) pending.push(child);
    }
  }
  return { hasErrorNodes, hasMissingNodes };
}
