/**
 * Deterministic import graph analyzer.
 * Uses the TypeScript compiler API for JS/TS AST parsing and the Go import
 * parser for .go files — no Claude invocation.
 */

import { readFile } from "node:fs/promises";
import { join, dirname, relative, extname, resolve } from "node:path";
import ts from "typescript";
import type {
  ImportEdge,
  ImportType,
  ExternalImport,
  Imports,
  ImportsSummary,
  Inventory,
} from "../schema/index.js";
import { sortImports } from "../util/sort.js";
import { detectCirculars } from "../util/merge.js";
import { toPosix } from "../util/paths.js";
import { extractGoImports, readGoModulePath } from "./go-imports.js";
import { readManifest } from "./manifest.js";
import { getLanguageConfig, detectLanguages, mergeLanguageConfigs } from "../language/index.js";
import type { LanguageConfig } from "../language/index.js";

// ── Parseable extensions ─────────────────────────────────────────────────────

const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const GO_EXTENSION = ".go";
const PROBE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

// ── AST extraction ───────────────────────────────────────────────────────────

export interface RawImport {
  specifier: string;
  type: ImportType;
  symbols: string[];
}

export function extractImports(sourceText: string, filePath: string): RawImport[] {
  const ext = extname(filePath);
  const scriptKind =
    ext === ".tsx" || ext === ".jsx"
      ? ts.ScriptKind.TSX
      : ext === ".ts"
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;

  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, false, scriptKind);
  const imports: RawImport[] = [];

  function visit(node: ts.Node) {
    // const { a, b } = await import("specifier") or const { a, b } = require("specifier")
    if (
      ts.isVariableStatement(node)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && ts.isObjectBindingPattern(decl.name)) {
          // Unwrap optional AwaitExpression
          let inner = decl.initializer;
          if (ts.isAwaitExpression(inner)) {
            inner = inner.expression;
          }

          // Check for import() or require()
          if (ts.isCallExpression(inner)) {
            const isDynamicImport = inner.expression.kind === ts.SyntaxKind.ImportKeyword;
            const isRequire = ts.isIdentifier(inner.expression) && inner.expression.text === "require";

            if ((isDynamicImport || isRequire) && inner.arguments.length === 1) {
              const arg = inner.arguments[0];
              if (ts.isStringLiteral(arg)) {
                const symbols = decl.name.elements.map((el) => {
                  // For renamed bindings like { default: mod }, use the propertyName ("default")
                  if (el.propertyName && ts.isIdentifier(el.propertyName)) {
                    return el.propertyName.text;
                  }
                  return ts.isIdentifier(el.name) ? el.name.text : "*";
                });
                imports.push({
                  specifier: arg.text,
                  type: isDynamicImport ? "dynamic" : "require",
                  symbols,
                });
                return; // Skip child traversal to prevent duplicate from CallExpression handler
              }
            }
          }
        }
      }
    }

    // import ... from "specifier"
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const isTypeOnly = node.importClause?.isTypeOnly ?? false;

      if (isTypeOnly) {
        // `import type { Foo } from "x"` — whole clause is type-only
        imports.push({ specifier, type: "type", symbols: extractImportSymbols(node) });
      } else {
        // Check for inline type specifiers: `import { type Foo, bar } from "x"`
        const { typeSymbols, valueSymbols } = splitImportSymbols(node);
        if (typeSymbols.length > 0) {
          imports.push({ specifier, type: "type", symbols: typeSymbols });
        }
        if (valueSymbols.length > 0) {
          imports.push({ specifier, type: "static", symbols: valueSymbols });
        }
        // If neither (side-effect import), still record it
        if (typeSymbols.length === 0 && valueSymbols.length === 0) {
          imports.push({ specifier, type: "static", symbols: extractImportSymbols(node) });
        }
      }
    }

    // export ... from "specifier"
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const isTypeOnly = node.isTypeOnly ?? false;
      const symbols: string[] = [];
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          symbols.push(el.name.text);
        }
      } else {
        symbols.push("*");
      }
      imports.push({ specifier, type: isTypeOnly ? "type" : "reexport", symbols });
    }

    // import("specifier") or require("specifier")
    if (ts.isCallExpression(node)) {
      // Dynamic import
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1) {
        const arg = node.arguments[0];
        if (ts.isStringLiteral(arg)) {
          imports.push({ specifier: arg.text, type: "dynamic", symbols: ["*"] });
        }
      }

      // require("specifier")
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length === 1
      ) {
        const arg = node.arguments[0];
        if (ts.isStringLiteral(arg)) {
          imports.push({ specifier: arg.text, type: "require", symbols: ["*"] });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return imports;
}

function extractImportSymbols(node: ts.ImportDeclaration): string[] {
  const symbols: string[] = [];
  const clause = node.importClause;
  if (!clause) return ["*"]; // side-effect import

  if (clause.name) {
    symbols.push("default");
  }

  if (clause.namedBindings) {
    if (ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        symbols.push(el.name.text);
      }
    } else if (ts.isNamespaceImport(clause.namedBindings)) {
      symbols.push("*");
    }
  }

  return symbols.length > 0 ? symbols : ["*"];
}

/**
 * Split import symbols into type-only and value symbols.
 * Handles inline `type` specifiers: `import { type Foo, bar } from "x"`
 */
function splitImportSymbols(node: ts.ImportDeclaration): { typeSymbols: string[]; valueSymbols: string[] } {
  const typeSymbols: string[] = [];
  const valueSymbols: string[] = [];
  const clause = node.importClause;

  if (!clause) return { typeSymbols, valueSymbols }; // side-effect import

  // Default import is always a value
  if (clause.name) {
    valueSymbols.push("default");
  }

  if (clause.namedBindings) {
    if (ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        if (el.isTypeOnly) {
          typeSymbols.push(el.name.text);
        } else {
          valueSymbols.push(el.name.text);
        }
      }
    } else if (ts.isNamespaceImport(clause.namedBindings)) {
      valueSymbols.push("*");
    }
  }

  return { typeSymbols, valueSymbols };
}

// ── Module resolution ────────────────────────────────────────────────────────

interface Resolver {
  resolve(specifier: string, fromFile: string): string | null;
}

function createResolver(
  fileSet: Set<string>,
  targetDir: string,
  tsconfigPaths: Record<string, string[]> | null
): Resolver {
  return {
    resolve(specifier: string, fromFile: string): string | null {
      // Relative imports
      if (specifier.startsWith(".")) {
        const fromDir = dirname(fromFile);
        const resolved = toPosix(join(fromDir, specifier));
        return probeFile(resolved, fileSet);
      }

      // Aliased imports (tsconfig paths)
      if (tsconfigPaths) {
        for (const [pattern, targets] of Object.entries(tsconfigPaths)) {
          const prefix = pattern.replace(/\*$/, "");
          if (specifier.startsWith(prefix)) {
            const rest = specifier.slice(prefix.length);
            for (const target of targets) {
              const targetPrefix = target.replace(/\*$/, "");
              const candidate = toPosix(join(targetPrefix, rest));
              const found = probeFile(candidate, fileSet);
              if (found) return found;
            }
          }
        }
      }

      // Not resolved — must be external
      return null;
    },
  };
}

function probeFile(candidate: string, fileSet: Set<string>): string | null {
  // Normalize path separators
  candidate = candidate.replace(/\\/g, "/");

  // Exact match
  if (fileSet.has(candidate)) return candidate;

  // Strip .js/.jsx extension (TypeScript projects import .js but files are .ts)
  const stripped = candidate.replace(/\.(js|jsx)$/, "");

  // Try the stripped path with TS/JS extensions
  for (const ext of PROBE_EXTENSIONS) {
    if (fileSet.has(stripped + ext)) return stripped + ext;
  }

  // Try /index.* on the stripped path
  for (const ext of PROBE_EXTENSIONS) {
    if (fileSet.has(stripped + "/index" + ext)) return stripped + "/index" + ext;
  }

  // Also try extensions on the original (for extensionless specifiers)
  if (stripped !== candidate) {
    // Already tried above with stripped
  } else {
    // No extension was stripped — try appending extensions directly
    for (const ext of PROBE_EXTENSIONS) {
      if (fileSet.has(candidate + ext)) return candidate + ext;
    }
    for (const ext of PROBE_EXTENSIONS) {
      if (fileSet.has(candidate + "/index" + ext)) return candidate + "/index" + ext;
    }
  }

  return null;
}

// ── Extract package name from bare specifier ─────────────────────────────────

export function extractPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    // @scope/pkg/sub → @scope/pkg
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  // pkg/sub → pkg
  return specifier.split("/")[0];
}

// ── Read tsconfig paths ──────────────────────────────────────────────────────

async function readTsconfigPaths(targetDir: string): Promise<Record<string, string[]> | null> {
  try {
    const raw = await readFile(join(targetDir, "tsconfig.json"), "utf-8");
    // tsconfig.json allows comments (JSONC format) but JSON.parse does not.
    // Strip single-line comments (//) and multi-line comments (/* ... */)
    // before parsing. Handles comments inside strings correctly by matching
    // quoted strings first and only stripping unquoted comment patterns.
    const stripped = raw.replace(
      /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      (match, quoted) => quoted ?? "",
    );
    // Also strip trailing commas before } or ] (common in tsconfig)
    const cleaned = stripped.replace(/,\s*([}\]])/g, "$1");
    const config = JSON.parse(cleaned);
    const paths = config?.compilerOptions?.paths;
    if (paths && typeof paths === "object") {
      return paths as Record<string, string[]>;
    }
  } catch {
    // No tsconfig or no paths — that's fine
  }
  return null;
}

// ── Incremental types ────────────────────────────────────────────────────────

export interface ImportsOptions {
  previousImports?: Imports;
  changedFiles?: Set<string>;
  fileSetChanged?: boolean;
  /** Primary language id (e.g. "go", "typescript"). Reads manifest.language / detectLanguage when omitted. */
  language?: string;
}

// ── analyzeImports helpers ───────────────────────────────────────────────────

/** Resolve effective language config from manifest, options, or auto-detection. */
async function resolveLanguageConfig(
  targetDir: string,
  manifest: ReturnType<typeof readManifest>,
  options?: ImportsOptions,
): Promise<LanguageConfig> {
  if (manifest.languages && manifest.languages.length > 0) {
    const configs = manifest.languages
      .map((id) => getLanguageConfig(id))
      .filter((c): c is NonNullable<typeof c> => c != null);
    if (configs.length > 0) return mergeLanguageConfigs(configs);
  }
  if (options?.language) {
    const config = getLanguageConfig(options.language);
    if (config) return config;
  }
  if (manifest.language) {
    const config = getLanguageConfig(manifest.language);
    if (config) return config;
  }
  return mergeLanguageConfigs(await detectLanguages(targetDir));
}

interface IncrementalState {
  edgeMap: Map<string, ImportEdge>;
  externalMap: Map<string, ExternalImport>;
  unchangedExternalFiles: Set<string>;
}

/**
 * Build starting edge/external maps from a previous run, carrying forward only
 * the entries for unchanged files. Files in changedFiles are excluded so they
 * can be re-parsed fresh.
 */
function buildIncrementalState(prev: Imports, changedFiles: Set<string>): IncrementalState {
  const edgeMap = new Map<string, ImportEdge>();
  const externalMap = new Map<string, ExternalImport>();
  const unchangedExternalFiles = new Set<string>();

  for (const edge of prev.edges) {
    if (!changedFiles.has(edge.from)) {
      edgeMap.set(`${edge.from}\0${edge.to}\0${edge.type}`, edge);
    }
  }

  for (const ext of prev.external) {
    const unchangedImporters = ext.importedBy.filter((f) => !changedFiles.has(f));
    if (unchangedImporters.length === 0) continue;

    const hasChangedImporters = unchangedImporters.length < ext.importedBy.length;
    if (hasChangedImporters) {
      // Mixed importers: symbols must be re-extracted from unchanged files
      for (const f of unchangedImporters) unchangedExternalFiles.add(f);
      externalMap.set(ext.package, { package: ext.package, importedBy: [...unchangedImporters], symbols: [] });
    } else {
      // All importers unchanged: symbols are accurate as-is
      externalMap.set(ext.package, { package: ext.package, importedBy: [...unchangedImporters], symbols: [...ext.symbols] });
    }
  }

  return { edgeMap, externalMap, unchangedExternalFiles };
}

/**
 * Re-extract external symbols from unchanged files that share a package with
 * at least one changed importer. Mutates externalMap in place.
 */
async function reExtractUnchangedExternals(
  unchangedExternalFiles: Set<string>,
  targetDir: string,
  goModulePath: string | null,
  externalMap: Map<string, ExternalImport>,
): Promise<void> {
  for (const filePath of unchangedExternalFiles) {
    let sourceText: string;
    try {
      sourceText = await readFile(join(targetDir, filePath), "utf-8");
    } catch {
      continue;
    }

    if (extname(filePath).toLowerCase() === GO_EXTENSION) {
      for (const goExt of extractGoImports(sourceText, filePath, goModulePath).external) {
        const existing = externalMap.get(goExt.package);
        if (existing) {
          existing.symbols = Array.from(new Set([...existing.symbols, ...goExt.symbols]));
        }
      }
    } else {
      for (const raw of extractImports(sourceText, filePath)) {
        if (raw.specifier.startsWith("node:") || raw.specifier.startsWith(".")) continue;
        const existing = externalMap.get(extractPackageName(raw.specifier));
        if (existing) {
          existing.symbols = Array.from(new Set([...existing.symbols, ...raw.symbols]));
        }
      }
    }
  }
}

/** Parse JS/TS files and append edges and external imports to the provided maps. */
async function processJsTsFiles(
  files: Inventory["files"],
  targetDir: string,
  resolver: Resolver,
  edgeMap: Map<string, ImportEdge>,
  externalMap: Map<string, ExternalImport>,
): Promise<void> {
  for (const file of files) {
    let sourceText: string;
    try {
      sourceText = await readFile(join(targetDir, file.path), "utf-8");
    } catch {
      continue; // skip unreadable files
    }

    for (const raw of extractImports(sourceText, file.path)) {
      if (raw.specifier.startsWith("node:")) continue;

      const resolved = resolver.resolve(raw.specifier, file.path);
      if (resolved) {
        const key = `${file.path}\0${resolved}\0${raw.type}`;
        const existing = edgeMap.get(key);
        if (existing) {
          edgeMap.set(key, { ...existing, symbols: Array.from(new Set([...existing.symbols, ...raw.symbols])) });
        } else {
          edgeMap.set(key, { from: file.path, to: resolved, type: raw.type, symbols: [...raw.symbols] });
        }
      } else if (!raw.specifier.startsWith(".")) {
        // External package
        const pkg = extractPackageName(raw.specifier);
        const existing = externalMap.get(pkg);
        if (existing) {
          externalMap.set(pkg, {
            package: pkg,
            importedBy: Array.from(new Set([...existing.importedBy, file.path])),
            symbols: Array.from(new Set([...existing.symbols, ...raw.symbols])),
          });
        } else {
          externalMap.set(pkg, { package: pkg, importedBy: [file.path], symbols: [...raw.symbols] });
        }
      }
      // Unresolved relative imports are silently skipped
    }
  }
}

/** Parse Go files and append edges and external imports to the provided maps. */
async function processGoFiles(
  files: Inventory["files"],
  targetDir: string,
  goModulePath: string | null,
  edgeMap: Map<string, ImportEdge>,
  externalMap: Map<string, ExternalImport>,
): Promise<void> {
  for (const file of files) {
    let sourceText: string;
    try {
      sourceText = await readFile(join(targetDir, file.path), "utf-8");
    } catch {
      continue;
    }

    const goResult = extractGoImports(sourceText, file.path, goModulePath);

    for (const edge of goResult.edges) {
      const key = `${edge.from}\0${edge.to}\0${edge.type}`;
      const existing = edgeMap.get(key);
      if (existing) {
        edgeMap.set(key, { ...existing, symbols: Array.from(new Set([...existing.symbols, ...edge.symbols])) });
      } else {
        edgeMap.set(key, edge);
      }
    }

    for (const goExt of goResult.external) {
      const existing = externalMap.get(goExt.package);
      if (existing) {
        externalMap.set(goExt.package, {
          package: goExt.package,
          importedBy: Array.from(new Set([...existing.importedBy, ...goExt.importedBy])),
          symbols: Array.from(new Set([...existing.symbols, ...goExt.symbols])),
        });
      } else {
        externalMap.set(goExt.package, { ...goExt });
      }
    }
  }
}

/** Compute ImportsSummary statistics from collected edges and external packages. */
function buildImportSummary(edges: ImportEdge[], external: ExternalImport[]): ImportsSummary {
  // Exclude type-only imports from mostImported: they don't create runtime
  // dependencies and inflate rankings for schema/type-definition files.
  const importCounts = new Map<string, number>();
  for (const e of edges) {
    if (e.type === "type") continue;
    importCounts.set(e.to, (importCounts.get(e.to) || 0) + 1);
  }

  const mostImported = Array.from(importCounts.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const filesWith = new Set(edges.map((e) => e.from));
  const avgImportsPerFile =
    filesWith.size > 0 ? Math.round((edges.length / filesWith.size) * 100) / 100 : 0;

  const circulars = detectCirculars(edges);

  return {
    totalEdges: edges.length,
    totalExternal: external.length,
    circularCount: circulars.length,
    circulars,
    mostImported,
    avgImportsPerFile,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function analyzeImports(
  targetDir: string,
  inventory: Inventory,
  options?: ImportsOptions
): Promise<Imports> {
  const fileSet = new Set(inventory.files.map((f) => f.path));
  const tsconfigPaths = await readTsconfigPaths(targetDir);
  const resolver = createResolver(fileSet, targetDir, tsconfigPaths);

  const manifest = readManifest(targetDir);
  const langConfig = await resolveLanguageConfig(targetDir, manifest, options);

  // Always include JS/TS for backward compatibility; add resolved language extensions.
  const parseableExts = new Set<string>(JS_TS_EXTENSIONS);
  for (const ext of langConfig.parseableExtensions) parseableExts.add(ext);

  // Read go.mod once if any Go files exist in the inventory.
  const hasGoFiles = inventory.files.some((f) => extname(f.path).toLowerCase() === GO_EXTENSION);
  const goModulePath = hasGoFiles ? await readGoModulePath(targetDir) : null;

  const prev = options?.previousImports;
  const changedFiles = options?.changedFiles;
  const fileSetChanged = options?.fileSetChanged ?? true;
  // Incremental path: no adds/deletes, have previous, have change list
  const canIncremental = prev && changedFiles && !fileSetChanged;

  const edgeMap = new Map<string, ImportEdge>();
  const externalMap = new Map<string, ExternalImport>();

  if (canIncremental) {
    const state = buildIncrementalState(prev, changedFiles);
    for (const [k, v] of state.edgeMap) edgeMap.set(k, v);
    for (const [k, v] of state.externalMap) externalMap.set(k, v);
    await reExtractUnchangedExternals(state.unchangedExternalFiles, targetDir, goModulePath, externalMap);
  }

  // Determine which files to parse
  const parseable = inventory.files.filter((f) => {
    const ext = extname(f.path).toLowerCase();
    if (!parseableExts.has(ext)) return false;
    if (canIncremental) return changedFiles.has(f.path);
    return true;
  });

  // Partition into JS/TS and Go to prevent cross-language contamination
  const jsTsFiles = parseable.filter((f) => JS_TS_EXTENSIONS.has(extname(f.path).toLowerCase()));
  const goParseableFiles = parseable.filter((f) => extname(f.path).toLowerCase() === GO_EXTENSION);

  await processJsTsFiles(jsTsFiles, targetDir, resolver, edgeMap, externalMap);
  await processGoFiles(goParseableFiles, targetDir, goModulePath, edgeMap, externalMap);

  // Incremental cleanup: remove packages whose importers were all changed
  if (canIncremental) {
    for (const [pkg, ext] of externalMap) {
      if (ext.importedBy.length === 0) externalMap.delete(pkg);
    }
  }

  const edges = Array.from(edgeMap.values());
  const external = Array.from(externalMap.values());
  return sortImports({ edges, external, summary: buildImportSummary(edges, external) });
}
