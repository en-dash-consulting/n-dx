/**
 * What a zone's code calls itself.
 *
 * Until now a zone was shown to a judgment as paths plus the leading comments
 * of its sampled files. That is thin evidence: a path says where a file sits,
 * a header says what its author wrote in prose, and neither says what the
 * module actually offers. The names are already in the analysis — the import
 * graph records the symbols every edge carries, so the symbols a zone exports
 * are the ones its inbound edges name — and the declarations are one AST walk
 * over files the judgment already reads for headers.
 *
 * Three things come out of here, and they go everywhere a zone is judged:
 * naming, fragility, the heuristic real-problem Noul and finding evidence.
 *
 * - `exportedSymbols` — the most common symbol names on edges pointing into
 *   the zone. `reexport` edges are the barrel's own view of its surface, but
 *   every import edge names what it took, so all inbound edges count.
 * - `declarations` — exported top-level declarations of the sampled files:
 *   what the zone defines, in its own words, with the line each sits on.
 * - `testFiles` — the zone's test files by name. A zone that tests something
 *   says what it tests in those names, and a zone that is *only* tests is a
 *   different kind of zone; both are judgments the file list alone obscures.
 *
 * @module sourcevision/analyzers/zone-symbols
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import ts from "typescript";
import type { Imports, Zone } from "../schema/index.js";

/** Exported symbol names carried per zone; enough to see a vocabulary. */
export const MAX_EXPORTED_SYMBOLS = 30;
/** Files parsed for declarations per zone. Each is a full TS parse. */
export const DECLARATION_FILE_SAMPLE = 20;
/** Declarations carried per zone. */
export const MAX_DECLARATIONS = 40;
/** Test file names carried per zone. */
export const MAX_TEST_FILES = 15;

/** Extensions the TypeScript parser handles; everything else uses the regex pass. */
const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Edge symbols that name no declaration. */
const UNINFORMATIVE_SYMBOLS = new Set(["default", "*", ""]);

/** One exported top-level declaration. */
export interface Declaration {
  name: string;
  /** `function`, `class`, `interface`, `type`, `enum`, `const`. */
  kind: string;
  /** 1-indexed line of the declaration. */
  line: number;
}

/** A zone's symbol evidence. Every field may be empty; none is ever absent. */
export interface ZoneSymbols {
  exportedSymbols: string[];
  declarations: Declaration[];
  testFiles: string[];
}

export function emptyZoneSymbols(): ZoneSymbols {
  return { exportedSymbols: [], declarations: [], testFiles: [] };
}

/** True when nothing was found — callers omit the block rather than send empties. */
export function isEmptyZoneSymbols(s: ZoneSymbols): boolean {
  return s.exportedSymbols.length === 0 && s.declarations.length === 0 && s.testFiles.length === 0;
}

// ── Test files ───────────────────────────────────────────────────────────────

/**
 * Whether a path is a test file, by the conventions of the languages this
 * analyser reads. Kept deliberately narrow: a directory called `tests/` and
 * the `.test.`/`.spec.` infixes are near-universal, `_test.go` and
 * `test_*.py` are the two other conventions worth encoding.
 */
export function isTestPath(path: string): boolean {
  const p = path.toLowerCase();
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
    /(^|\/)(tests?|__tests__|spec|specs)\//.test(p) ||
    /_test\.(go|py|rb)$/.test(p) ||
    /(^|\/)test_[^/]*\.py$/.test(p) ||
    /tests?\.swift$/.test(p)
  );
}

// ── Declarations ─────────────────────────────────────────────────────────────

/**
 * Exported top-level declarations of one source file.
 *
 * Top level only: a judgment wants the module's surface, and walking into
 * bodies would bury it under local helpers. JS/TS goes through the TypeScript
 * parser (the package already depends on it for the call graph); every other
 * language falls back to a keyword regex, which is enough for names.
 */
export function extractTopLevelDeclarations(sourceText: string, filePath: string): Declaration[] {
  const ext = extname(filePath);
  if (!JS_TS_EXTENSIONS.has(ext)) return extractDeclarationsByPattern(sourceText);

  const scriptKind =
    ext === ".tsx" || ext === ".jsx"
      ? ts.ScriptKind.TSX
      : ext === ".ts"
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const out: Declaration[] = [];

  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const exported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const node of sf.statements) {
    if (!exported(node)) continue;
    if (ts.isFunctionDeclaration(node) && node.name) {
      out.push({ name: node.name.text, kind: "function", line: lineOf(node) });
    } else if (ts.isClassDeclaration(node) && node.name) {
      out.push({ name: node.name.text, kind: "class", line: lineOf(node) });
    } else if (ts.isInterfaceDeclaration(node)) {
      out.push({ name: node.name.text, kind: "interface", line: lineOf(node) });
    } else if (ts.isTypeAliasDeclaration(node)) {
      out.push({ name: node.name.text, kind: "type", line: lineOf(node) });
    } else if (ts.isEnumDeclaration(node)) {
      out.push({ name: node.name.text, kind: "enum", line: lineOf(node) });
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const kind = decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
            ? "function"
            : "const";
          out.push({ name: decl.name.text, kind, line: lineOf(decl) });
        }
      }
    }
  }
  return out;
}

/** Keyword-regex declarations for the languages the TS parser cannot read. */
function extractDeclarationsByPattern(sourceText: string): Declaration[] {
  const out: Declaration[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/^\s*(?:pub\s+)?func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/, "function"],
    [/^\s*(?:public\s+|open\s+)?(?:final\s+)?(?:class|struct|protocol|enum|actor)\s+([A-Za-z_][\w]*)/, "class"],
    [/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/, "function"],
    [/^\s*def\s+([A-Za-z_][\w]*)/, "function"],
    [/^\s*type\s+([A-Za-z_][\w]*)\s/, "type"],
  ];
  const lines = sourceText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const [re, kind] of patterns) {
      const m = re.exec(lines[i]);
      if (m && m[1] && !m[1].startsWith("_")) {
        out.push({ name: m[1], kind, line: i + 1 });
        break;
      }
    }
  }
  return out;
}

// ── Collection ───────────────────────────────────────────────────────────────

export interface ZoneSymbolOptions {
  /** Import graph; its edge symbols are what the zone exports. */
  imports?: Imports;
  /** Project root; without it no file is read and declarations stay empty. */
  projectDir?: string;
  /** Files parsed for declarations. Defaults to {@link DECLARATION_FILE_SAMPLE}. */
  fileSample?: number;
}

/**
 * Symbol evidence for one zone. Safe to call with neither imports nor a
 * project directory: the result is then empty rather than partial, and
 * {@link isEmptyZoneSymbols} tells the caller to omit it.
 */
export function collectZoneSymbols(zone: Zone, opts: ZoneSymbolOptions): ZoneSymbols {
  const files = new Set(zone.files);
  const out = emptyZoneSymbols();

  if (opts.imports) {
    const counts = new Map<string, number>();
    for (const edge of opts.imports.edges) {
      if (!files.has(edge.to)) continue;
      for (const s of edge.symbols) {
        if (UNINFORMATIVE_SYMBOLS.has(s)) continue;
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    out.exportedSymbols = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_EXPORTED_SYMBOLS)
      .map(([name]) => name);
  }

  const sources = zone.files.filter((f) => !isTestPath(f));
  if (opts.projectDir) {
    const sample = (sources.length > 0 ? sources : zone.files).slice(0, opts.fileSample ?? DECLARATION_FILE_SAMPLE);
    const seen = new Set<string>();
    for (const rel of sample) {
      if (out.declarations.length >= MAX_DECLARATIONS) break;
      const abs = join(opts.projectDir, rel);
      if (!existsSync(abs)) continue;
      let text: string;
      try {
        text = readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      for (const d of extractTopLevelDeclarations(text, rel)) {
        if (seen.has(d.name)) continue;
        seen.add(d.name);
        out.declarations.push(d);
        if (out.declarations.length >= MAX_DECLARATIONS) break;
      }
    }
  }

  out.testFiles = zone.files.filter(isTestPath).map((f) => basename(f)).slice(0, MAX_TEST_FILES);
  return out;
}

// ── Symbol vocabulary ────────────────────────────────────────────────────────

/**
 * Words that say what kind of thing a symbol is, not what it is about.
 * Stripping them from `StandupService`, `StandupRepo` and `useStandup` leaves
 * `Standup` three times over, which is the zone's actual subject.
 */
const ROLE_WORDS = new Set([
  "service", "services", "repo", "repository", "controller", "manager", "provider",
  "factory", "client", "store", "handler", "handlers", "builder", "helper", "helpers",
  "util", "utils", "config", "options", "option", "result", "error", "errors",
  "type", "types", "props", "state", "context", "hook", "hooks", "component",
  "use", "get", "set", "is", "to", "from", "with", "create", "make", "build",
  "parse", "format", "render", "default", "index", "main", "new", "init",
  "data", "info", "item", "items", "list", "map", "entry", "value", "node",
]);

/** `StandupService` → `["standup", "service"]`; `use_standup` → `["use", "standup"]`. */
export function symbolWords(symbol: string): string[] {
  return symbol
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * The subject the zone's exported symbols share, if they share one.
 *
 * A word must appear in at least {@link SUBJECT_MIN_SYMBOLS} distinct symbols
 * and in at least {@link SUBJECT_MIN_SHARE} of them — one repeated prefix is a
 * coincidence, a majority is the module's subject.
 */
export const SUBJECT_MIN_SYMBOLS = 2;
export const SUBJECT_MIN_SHARE = 0.3;

export function dominantSymbolNoun(symbols: string[]): { word: string; count: number } | undefined {
  if (symbols.length < SUBJECT_MIN_SYMBOLS) return undefined;
  const counts = new Map<string, number>();
  for (const s of symbols) {
    for (const w of new Set(symbolWords(s))) {
      if (w.length < 3 || ROLE_WORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!best) return undefined;
  const [word, count] = best;
  if (count < SUBJECT_MIN_SYMBOLS || count / symbols.length < SUBJECT_MIN_SHARE) return undefined;
  return { word, count };
}
