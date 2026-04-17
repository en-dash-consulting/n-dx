/**
 * Dead-code and duplication analyzer for production files.
 *
 * Reads sourcevision analysis data from disk and identifies cleanup candidates:
 * - Dead exports not referenced anywhere in the import graph (excluding test consumers)
 * - Unused imports (imported symbols never referenced in file body)
 * - Near-duplicate utility functions using structural/textual similarity
 *
 * Produces a prioritized list with confidence scores and blast radius estimates.
 * This module is analysis-only — it does not modify any files.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import ts from "typescript";
import type { AnalyzerOutput, DeadExport, UnusedImport, DuplicateUtility } from "./cleanup-transformations.js";
import { isTestFilePath } from "./cleanup-transformations.js";

// ---------------------------------------------------------------------------
// Sourcevision Schema Types (subset for reading JSON files)
// ---------------------------------------------------------------------------

/**
 * Import edge from sourcevision's imports.json.
 * Simplified type — only the fields we need for analysis.
 */
interface SVImportEdge {
  from: string;
  to: string;
  type: "static" | "dynamic" | "require" | "reexport" | "type";
  symbols: string[];
}

/**
 * External import from sourcevision's imports.json.
 */
interface SVExternalImport {
  package: string;
  importedBy: string[];
  symbols: string[];
}

/**
 * Sourcevision imports.json structure.
 */
interface SVImports {
  edges: SVImportEdge[];
  external: SVExternalImport[];
  summary: {
    totalEdges: number;
    totalExternal: number;
    circularCount: number;
  };
}

/**
 * File entry from sourcevision's inventory.json.
 */
interface SVFileEntry {
  path: string;
  size: number;
  language: string;
  lineCount: number;
  role: "source" | "test" | "config" | "docs" | "generated" | "asset" | "build" | "other";
}

/**
 * Sourcevision inventory.json structure.
 */
interface SVInventory {
  files: SVFileEntry[];
}

/**
 * Function node from sourcevision's callgraph.json.
 */
interface SVFunctionNode {
  file: string;
  name: string;
  line: number;
  column: number;
  qualifiedName: string;
  isExported: boolean;
}

/**
 * Call edge from sourcevision's callgraph.json.
 */
interface SVCallEdge {
  callerFile: string;
  caller: string;
  calleeFile: string | null;
  callee: string;
  type: "direct" | "method" | "property-chain" | "computed";
  line: number;
  column: number;
}

/**
 * Sourcevision callgraph.json structure.
 */
interface SVCallGraph {
  functions: SVFunctionNode[];
  edges: SVCallEdge[];
}

// ---------------------------------------------------------------------------
// Cleanup Candidate Types
// ---------------------------------------------------------------------------

/**
 * Confidence level for cleanup candidate detection.
 */
export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * Base interface for all cleanup candidates.
 */
interface CleanupCandidateBase {
  /** File path relative to project root. */
  file: string;
  /** Detection confidence level. */
  confidence: ConfidenceLevel;
  /** Estimated number of files/imports affected if removed. Lower = safer to remove. */
  blastRadius: number;
  /** Human-readable explanation of why this was flagged. */
  reason: string;
}

/**
 * Dead export candidate — an export not imported anywhere in the codebase.
 */
export interface DeadExportCandidate extends CleanupCandidateBase {
  type: "dead_export";
  /** Export name. */
  name: string;
  /** Line number of the export declaration. */
  line: number;
  /** End line of the export declaration (for removal). */
  endLine: number;
}

/**
 * Unused import candidate — an import where the symbol is never used in the file.
 */
export interface UnusedImportCandidate extends CleanupCandidateBase {
  type: "unused_import";
  /** The full import statement. */
  importStatement: string;
  /** Unused symbol names. */
  symbols: string[];
  /** Line number of the import. */
  line: number;
  /** End line of the import statement. */
  endLine: number;
}

/**
 * Duplicate utility candidate — near-duplicate functions across files.
 */
export interface DuplicateUtilityCandidate extends CleanupCandidateBase {
  type: "duplicate_utility";
  /** Function name. */
  name: string;
  /** Line number of the function. */
  line: number;
  /** End line of the function. */
  endLine: number;
  /** File containing the canonical version to keep. */
  canonicalFile: string;
  /** Similarity score (0-1). */
  similarity: number;
}

/**
 * Union type for all cleanup candidates.
 */
export type CleanupCandidate =
  | DeadExportCandidate
  | UnusedImportCandidate
  | DuplicateUtilityCandidate;

/**
 * Options for the dead-code analyzer.
 */
export interface DeadCodeAnalyzerOptions {
  /** Project root directory. */
  projectDir: string;
  /** Path to .sourcevision directory (default: .sourcevision). */
  sourcevisionDir?: string;
  /** Minimum similarity threshold for duplicate detection (0-1, default: 0.8). */
  duplicateSimilarityThreshold?: number;
  /** Maximum number of candidates per category to return (default: 50). */
  maxCandidatesPerCategory?: number;
  /** Additional file patterns to exclude (beyond test files). */
  excludePatterns?: RegExp[];
}

/**
 * Result of dead-code analysis.
 */
export interface DeadCodeAnalysisResult {
  /** Whether analysis ran successfully. */
  ran: boolean;
  /** Error message if analysis failed. */
  error?: string;
  /** Ranked list of cleanup candidates. */
  candidates: CleanupCandidate[];
  /** Summary counts by category. */
  summary: {
    deadExports: number;
    unusedImports: number;
    duplicateUtilities: number;
    totalFiles: number;
    filesAnalyzed: number;
    filesExcluded: number;
  };
  /** Total elapsed time (ms). */
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SIMILARITY_THRESHOLD = 0.8;
const DEFAULT_MAX_CANDIDATES = 50;
const SOURCEVISION_DIR = ".sourcevision";

/** Entry point files where unused exports are expected. */
const ENTRY_POINT_PATTERNS = [
  /(?:^|\/)index\.[jt]sx?$/,
  /(?:^|\/)main\.[jt]sx?$/,
  /(?:^|\/)cli\.[jt]sx?$/,
  /(?:^|\/)public\.[jt]sx?$/,
  /\.config\.[jt]sx?$/,
  /\.d\.ts$/,
];

/** JS/TS file extensions for AST parsing. */
const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// ---------------------------------------------------------------------------
// File Loading
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file from the sourcevision directory.
 * Returns null if the file doesn't exist or can't be parsed.
 */
async function readSourcevisionFile<T>(
  projectDir: string,
  filename: string,
  svDir: string = SOURCEVISION_DIR,
): Promise<T | null> {
  try {
    const filePath = join(projectDir, svDir, filename);
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dead Export Detection
// ---------------------------------------------------------------------------

/**
 * Find dead exports — exports not imported anywhere in the codebase.
 * Excludes test consumers from consideration.
 */
async function findDeadExports(
  projectDir: string,
  imports: SVImports,
  inventory: SVInventory,
  callGraph: SVCallGraph | null,
  options: DeadCodeAnalyzerOptions,
): Promise<DeadExportCandidate[]> {
  const candidates: DeadExportCandidate[] = [];
  const maxCandidates = options.maxCandidatesPerCategory ?? DEFAULT_MAX_CANDIDATES;

  // Build set of test files
  const testFiles = new Set<string>();
  for (const file of inventory.files) {
    if (file.role === "test" || isTestFilePath(file.path)) {
      testFiles.add(file.path);
    }
  }

  // Build map of file -> imported symbols (excluding test consumer imports)
  const importedSymbols = new Map<string, Set<string>>();

  for (const edge of imports.edges) {
    // Skip if consumer is a test file
    if (testFiles.has(edge.from)) continue;

    // Skip type-only imports for dead code detection
    if (edge.type === "type") continue;

    if (!importedSymbols.has(edge.to)) {
      importedSymbols.set(edge.to, new Set());
    }
    const symbols = importedSymbols.get(edge.to)!;
    for (const sym of edge.symbols) {
      symbols.add(sym);
    }
  }

  // Build map of file -> called functions (from call graph)
  const calledFunctions = new Map<string, Set<string>>();
  if (callGraph) {
    for (const edge of callGraph.edges) {
      if (edge.calleeFile) {
        // Skip if caller is a test file
        if (testFiles.has(edge.callerFile)) continue;

        if (!calledFunctions.has(edge.calleeFile)) {
          calledFunctions.set(edge.calleeFile, new Set());
        }
        calledFunctions.get(edge.calleeFile)!.add(edge.callee);
      }
    }
  }

  // Analyze each source file for dead exports
  for (const file of inventory.files) {
    if (file.role !== "source") continue;
    if (testFiles.has(file.path)) continue;
    if (isEntryPointFile(file.path)) continue;
    if (!JS_TS_EXTENSIONS.has(extname(file.path))) continue;
    if (options.excludePatterns?.some((p) => p.test(file.path))) continue;

    const filePath = join(projectDir, file.path);
    let sourceText: string;
    try {
      sourceText = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    // Parse and find exports
    const exports = extractExports(sourceText, file.path);
    const usedSymbols = importedSymbols.get(file.path) ?? new Set();
    const calledSymbols = calledFunctions.get(file.path) ?? new Set();

    for (const exp of exports) {
      // Skip if imported anywhere (excluding tests)
      if (usedSymbols.has(exp.name) || usedSymbols.has("*")) continue;
      // Skip if called anywhere (excluding tests)
      if (calledSymbols.has(exp.name)) continue;
      // Skip re-exports (they're not true dead code in this file)
      if (exp.isReexport) continue;

      // Determine confidence based on export type
      let confidence: ConfidenceLevel = "medium";
      if (exp.isDefault) {
        confidence = "high"; // Default exports are more certain
      }

      // Blast radius is 0 since nothing imports this
      const blastRadius = 0;

      candidates.push({
        type: "dead_export",
        file: file.path,
        name: exp.name,
        line: exp.line,
        endLine: exp.endLine,
        confidence,
        blastRadius,
        reason: `Export "${exp.name}" has no non-test consumers in the import graph`,
      });

      if (candidates.length >= maxCandidates) break;
    }

    if (candidates.length >= maxCandidates) break;
  }

  return candidates;
}

interface ExportInfo {
  name: string;
  line: number;
  endLine: number;
  isDefault: boolean;
  isReexport: boolean;
}

/**
 * Extract export declarations from a TypeScript/JavaScript file.
 */
function extractExports(sourceText: string, filePath: string): ExportInfo[] {
  const ext = extname(filePath);
  const scriptKind =
    ext === ".tsx" || ext === ".jsx"
      ? ts.ScriptKind.TSX
      : ext === ".ts"
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;

  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, false, scriptKind);
  const exports: ExportInfo[] = [];

  function getLineInfo(node: ts.Node): { line: number; endLine: number } {
    const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    return { line: startLine, endLine };
  }

  function visit(node: ts.Node) {
    // export function foo() {}
    // export const bar = ...
    // export class Baz {}
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
      const { line, endLine } = getLineInfo(node);
      exports.push({
        name: node.name.text,
        line,
        endLine,
        isDefault: hasDefaultModifier(node),
        isReexport: false,
      });
    }

    if (ts.isClassDeclaration(node) && node.name && hasExportModifier(node)) {
      const { line, endLine } = getLineInfo(node);
      exports.push({
        name: node.name.text,
        line,
        endLine,
        isDefault: hasDefaultModifier(node),
        isReexport: false,
      });
    }

    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const { line, endLine } = getLineInfo(node);
          exports.push({
            name: decl.name.text,
            line,
            endLine,
            isDefault: false,
            isReexport: false,
          });
        }
      }
    }

    // export { foo, bar }
    if (ts.isExportDeclaration(node)) {
      const { line, endLine } = getLineInfo(node);
      const isReexport = node.moduleSpecifier != null;

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          exports.push({
            name: element.name.text,
            line,
            endLine,
            isDefault: false,
            isReexport,
          });
        }
      }
    }

    // export default ...
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const { line, endLine } = getLineInfo(node);
      exports.push({
        name: "default",
        line,
        endLine,
        isDefault: true,
        isReexport: false,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return exports;
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasDefaultModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function isEntryPointFile(filePath: string): boolean {
  return ENTRY_POINT_PATTERNS.some((p) => p.test(filePath));
}

// ---------------------------------------------------------------------------
// Unused Import Detection
// ---------------------------------------------------------------------------

/**
 * Find unused imports — imports where symbols are never used in the file body.
 */
async function findUnusedImports(
  projectDir: string,
  inventory: SVInventory,
  options: DeadCodeAnalyzerOptions,
): Promise<UnusedImportCandidate[]> {
  const candidates: UnusedImportCandidate[] = [];
  const maxCandidates = options.maxCandidatesPerCategory ?? DEFAULT_MAX_CANDIDATES;

  // Build set of test files
  const testFiles = new Set<string>();
  for (const file of inventory.files) {
    if (file.role === "test" || isTestFilePath(file.path)) {
      testFiles.add(file.path);
    }
  }

  // Analyze each source file
  for (const file of inventory.files) {
    if (file.role !== "source") continue;
    if (testFiles.has(file.path)) continue;
    if (!JS_TS_EXTENSIONS.has(extname(file.path))) continue;
    if (options.excludePatterns?.some((p) => p.test(file.path))) continue;

    const filePath = join(projectDir, file.path);
    let sourceText: string;
    try {
      sourceText = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const unusedImports = findFileUnusedImports(sourceText, file.path);

    for (const unused of unusedImports) {
      candidates.push({
        type: "unused_import",
        file: file.path,
        importStatement: unused.statement,
        symbols: unused.unusedSymbols,
        line: unused.line,
        endLine: unused.endLine,
        confidence: unused.confidence,
        blastRadius: 0, // Unused imports have no blast radius
        reason: `Import${unused.unusedSymbols.length > 1 ? "s" : ""} "${unused.unusedSymbols.join(", ")}" ${unused.unusedSymbols.length > 1 ? "are" : "is"} not referenced in the file`,
      });

      if (candidates.length >= maxCandidates) break;
    }

    if (candidates.length >= maxCandidates) break;
  }

  return candidates;
}

interface UnusedImportInfo {
  statement: string;
  unusedSymbols: string[];
  line: number;
  endLine: number;
  confidence: ConfidenceLevel;
}

/**
 * Find unused imports in a single file by parsing the AST and
 * checking if imported symbols are referenced in the file body.
 */
function findFileUnusedImports(sourceText: string, filePath: string): UnusedImportInfo[] {
  const ext = extname(filePath);
  const scriptKind =
    ext === ".tsx" || ext === ".jsx"
      ? ts.ScriptKind.TSX
      : ext === ".ts"
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;

  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const results: UnusedImportInfo[] = [];

  // Collect all import declarations with their symbols
  interface ImportDecl {
    node: ts.ImportDeclaration;
    symbols: Array<{ local: string; isNamespace: boolean; isDefault: boolean }>;
  }
  const importDecls: ImportDecl[] = [];

  // Collect all identifier references in the file (excluding imports)
  const usedIdentifiers = new Set<string>();

  function collectImports(node: ts.Node) {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      const symbols: ImportDecl["symbols"] = [];

      // import foo from "..."
      if (clause.name) {
        symbols.push({ local: clause.name.text, isNamespace: false, isDefault: true });
      }

      // import { a, b } from "..." or import * as ns from "..."
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          symbols.push({ local: clause.namedBindings.name.text, isNamespace: true, isDefault: false });
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            symbols.push({ local: el.name.text, isNamespace: false, isDefault: false });
          }
        }
      }

      if (symbols.length > 0) {
        importDecls.push({ node, symbols });
      }
    }

    ts.forEachChild(node, collectImports);
  }

  function collectUsages(node: ts.Node, skipImportDecl: boolean = false) {
    // Skip import declarations themselves
    if (skipImportDecl && ts.isImportDeclaration(node)) {
      return;
    }

    // Collect identifier usages
    if (ts.isIdentifier(node)) {
      // Check if this identifier is in a non-declaration context
      const parent = node.parent;
      if (parent) {
        // Skip if this is the name being declared in a variable declaration
        if (ts.isVariableDeclaration(parent) && parent.name === node) return;
        // Skip if this is a function parameter name
        if (ts.isParameter(parent) && parent.name === node) return;
        // Skip if this is a function name declaration
        if (ts.isFunctionDeclaration(parent) && parent.name === node) return;
        // Skip if this is a class name declaration
        if (ts.isClassDeclaration(parent) && parent.name === node) return;
        // Skip import specifier names
        if (ts.isImportSpecifier(parent)) return;
        if (ts.isImportClause(parent)) return;
        if (ts.isNamespaceImport(parent)) return;
        // Skip property access property names (in x.foo, skip foo but keep x)
        if (ts.isPropertyAccessExpression(parent) && parent.name === node) return;
        // Skip property names in object literals
        if (ts.isPropertyAssignment(parent) && parent.name === node) return;
        // Skip property names in shorthand property assignment
        if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
          // For shorthand { foo }, foo is both name and value - count as used
          usedIdentifiers.add(node.text);
          return;
        }
        // Skip type reference names (for now - they're type-only)
        if (ts.isTypeReferenceNode(parent)) {
          // Still mark as used if in non-type context
          usedIdentifiers.add(node.text);
          return;
        }

        usedIdentifiers.add(node.text);
      }
    }

    // Handle JSX elements - the tag name is an identifier reference
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName;
      if (ts.isIdentifier(tagName)) {
        usedIdentifiers.add(tagName.text);
      } else if (ts.isPropertyAccessExpression(tagName)) {
        // <Foo.Bar /> - mark the base as used
        let base = tagName.expression;
        while (ts.isPropertyAccessExpression(base)) {
          base = base.expression;
        }
        if (ts.isIdentifier(base)) {
          usedIdentifiers.add(base.text);
        }
      }
    }

    ts.forEachChild(node, (child) => collectUsages(child, true));
  }

  // Collect imports and usages
  collectImports(sf);
  collectUsages(sf, false);

  // Find unused imports
  for (const decl of importDecls) {
    const unusedSymbols: string[] = [];

    for (const sym of decl.symbols) {
      if (!usedIdentifiers.has(sym.local)) {
        unusedSymbols.push(sym.local);
      }
    }

    if (unusedSymbols.length > 0) {
      const startLine = sf.getLineAndCharacterOfPosition(decl.node.getStart(sf)).line + 1;
      const endLine = sf.getLineAndCharacterOfPosition(decl.node.getEnd()).line + 1;
      const statement = decl.node.getText(sf);

      // Confidence: high if all symbols unused, medium if partial
      const confidence: ConfidenceLevel = unusedSymbols.length === decl.symbols.length ? "high" : "medium";

      results.push({
        statement,
        unusedSymbols,
        line: startLine,
        endLine,
        confidence,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Duplicate Utility Detection
// ---------------------------------------------------------------------------

/**
 * Find near-duplicate utility functions across files.
 * Uses structural similarity based on normalized function bodies.
 */
async function findDuplicateUtilities(
  projectDir: string,
  inventory: SVInventory,
  options: DeadCodeAnalyzerOptions,
): Promise<DuplicateUtilityCandidate[]> {
  const candidates: DuplicateUtilityCandidate[] = [];
  const maxCandidates = options.maxCandidatesPerCategory ?? DEFAULT_MAX_CANDIDATES;
  const similarityThreshold = options.duplicateSimilarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  // Build set of test files
  const testFiles = new Set<string>();
  for (const file of inventory.files) {
    if (file.role === "test" || isTestFilePath(file.path)) {
      testFiles.add(file.path);
    }
  }

  // Collect all utility functions from source files
  interface FunctionSignature {
    file: string;
    name: string;
    line: number;
    endLine: number;
    normalizedBody: string;
    lineCount: number;
  }
  const allFunctions: FunctionSignature[] = [];

  // Only analyze utility-like paths
  const utilityPathPatterns = [
    /(?:^|\/)utils?\//i,
    /(?:^|\/)helpers?\//i,
    /(?:^|\/)lib\//i,
    /(?:^|\/)common\//i,
    /(?:^|\/)shared\//i,
  ];

  for (const file of inventory.files) {
    if (file.role !== "source") continue;
    if (testFiles.has(file.path)) continue;
    if (!JS_TS_EXTENSIONS.has(extname(file.path))) continue;
    if (options.excludePatterns?.some((p) => p.test(file.path))) continue;

    // Skip non-utility files for duplicate detection
    const isUtilityPath = utilityPathPatterns.some((p) => p.test(file.path));
    if (!isUtilityPath) continue;

    const filePath = join(projectDir, file.path);
    let sourceText: string;
    try {
      sourceText = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const functions = extractFunctions(sourceText, file.path);
    allFunctions.push(...functions);
  }

  // Compare functions for similarity
  const processedPairs = new Set<string>();
  const duplicateGroups = new Map<string, FunctionSignature[]>();

  for (let i = 0; i < allFunctions.length; i++) {
    const funcA = allFunctions[i];

    // Skip very short functions (likely getters/setters)
    if (funcA.lineCount < 3) continue;

    for (let j = i + 1; j < allFunctions.length; j++) {
      const funcB = allFunctions[j];

      // Skip if same file
      if (funcA.file === funcB.file) continue;

      // Skip very short functions
      if (funcB.lineCount < 3) continue;

      // Skip if already compared
      const pairKey = [funcA.file + ":" + funcA.name, funcB.file + ":" + funcB.name].sort().join("|||");
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      // Compare normalized bodies
      const similarity = computeSimilarity(funcA.normalizedBody, funcB.normalizedBody);

      if (similarity >= similarityThreshold) {
        // Add to duplicate group
        const groupKey = funcA.file + ":" + funcA.name;
        if (!duplicateGroups.has(groupKey)) {
          duplicateGroups.set(groupKey, [funcA]);
        }
        duplicateGroups.get(groupKey)!.push(funcB);
      }
    }
  }

  // Convert groups to candidates
  for (const [_, group] of duplicateGroups) {
    if (group.length < 2) continue;

    // Sort by file path to pick canonical (first alphabetically)
    group.sort((a, b) => a.file.localeCompare(b.file));
    const canonical = group[0];
    const duplicates = group.slice(1);

    for (const dup of duplicates) {
      const similarity = computeSimilarity(canonical.normalizedBody, dup.normalizedBody);

      // Confidence based on similarity
      let confidence: ConfidenceLevel = "low";
      if (similarity >= 0.95) confidence = "high";
      else if (similarity >= 0.85) confidence = "medium";

      // Blast radius is 1 (the duplicate file itself)
      candidates.push({
        type: "duplicate_utility",
        file: dup.file,
        name: dup.name,
        line: dup.line,
        endLine: dup.endLine,
        canonicalFile: canonical.file,
        similarity,
        confidence,
        blastRadius: 1,
        reason: `Function "${dup.name}" is ${Math.round(similarity * 100)}% similar to ${canonical.name} in ${canonical.file}`,
      });

      if (candidates.length >= maxCandidates) break;
    }

    if (candidates.length >= maxCandidates) break;
  }

  return candidates;
}

interface FunctionInfo {
  file: string;
  name: string;
  line: number;
  endLine: number;
  normalizedBody: string;
  lineCount: number;
}

/**
 * Extract function declarations from a file with normalized bodies for comparison.
 */
function extractFunctions(sourceText: string, filePath: string): FunctionInfo[] {
  const ext = extname(filePath);
  const scriptKind =
    ext === ".tsx" || ext === ".jsx"
      ? ts.ScriptKind.TSX
      : ext === ".ts"
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;

  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, false, scriptKind);
  const functions: FunctionInfo[] = [];

  function visit(node: ts.Node) {
    let name: string | undefined;
    let body: ts.Block | ts.ConciseBody | undefined;

    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      name = node.name.text;
      body = node.body;
    } else if (ts.isArrowFunction(node) && node.body && node.parent) {
      // Arrow function assigned to a variable
      if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        name = node.parent.name.text;
        body = node.body;
      }
    } else if (ts.isFunctionExpression(node) && node.body && node.parent) {
      // Function expression assigned to a variable
      if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        name = node.parent.name.text;
        body = node.body;
      }
    }

    if (name && body) {
      const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const bodyText = ts.isBlock(body) ? body.getText(sf) : body.getText(sf);
      const normalizedBody = normalizeForComparison(bodyText);

      functions.push({
        file: filePath,
        name,
        line: startLine,
        endLine,
        normalizedBody,
        lineCount: endLine - startLine + 1,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return functions;
}

/**
 * Normalize code for similarity comparison.
 * Removes whitespace, comments, and normalizes variable names.
 */
function normalizeForComparison(code: string): string {
  return code
    // Remove comments
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    // Remove leading/trailing whitespace
    .trim()
    // Normalize string quotes
    .replace(/"/g, "'")
    // Remove semicolons (style difference)
    .replace(/;/g, "")
    .toLowerCase();
}

/**
 * Compute Jaccard similarity between two normalized strings.
 * Uses character n-grams for comparison.
 */
function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  // Use 3-grams for comparison
  const ngramSize = 3;
  const ngramsA = getNgrams(a, ngramSize);
  const ngramsB = getNgrams(b, ngramSize);

  // Jaccard similarity
  const intersection = new Set([...ngramsA].filter((x) => ngramsB.has(x)));
  const union = new Set([...ngramsA, ...ngramsB]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function getNgrams(str: string, n: number): Set<string> {
  const ngrams = new Set<string>();
  for (let i = 0; i <= str.length - n; i++) {
    ngrams.add(str.slice(i, i + n));
  }
  return ngrams;
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Run dead-code analysis on a project.
 *
 * Reads sourcevision analysis data and identifies cleanup candidates:
 * - Dead exports not referenced in the import graph (excluding test consumers)
 * - Unused imports within files
 * - Near-duplicate utility functions
 *
 * Returns a ranked list sorted by confidence and blast radius.
 */
export async function analyzeDeadCode(
  options: DeadCodeAnalyzerOptions,
): Promise<DeadCodeAnalysisResult> {
  const startMs = Date.now();
  const svDir = options.sourcevisionDir ?? SOURCEVISION_DIR;

  // Load sourcevision data files
  const imports = await readSourcevisionFile<SVImports>(options.projectDir, "imports.json", svDir);
  const inventory = await readSourcevisionFile<SVInventory>(options.projectDir, "inventory.json", svDir);
  const callGraph = await readSourcevisionFile<SVCallGraph>(options.projectDir, "callgraph.json", svDir);

  if (!imports || !inventory) {
    return {
      ran: false,
      error: `Missing sourcevision data files. Run 'sourcevision analyze' first.`,
      candidates: [],
      summary: {
        deadExports: 0,
        unusedImports: 0,
        duplicateUtilities: 0,
        totalFiles: 0,
        filesAnalyzed: 0,
        filesExcluded: 0,
      },
      totalDurationMs: Date.now() - startMs,
    };
  }

  // Count files
  const testFiles = new Set<string>();
  let filesExcluded = 0;
  for (const file of inventory.files) {
    if (file.role === "test" || isTestFilePath(file.path)) {
      testFiles.add(file.path);
      filesExcluded++;
    } else if (options.excludePatterns?.some((p) => p.test(file.path))) {
      filesExcluded++;
    }
  }
  const totalFiles = inventory.files.length;
  const filesAnalyzed = totalFiles - filesExcluded;

  // Run all analyses
  const [deadExports, unusedImports, duplicateUtilities] = await Promise.all([
    findDeadExports(options.projectDir, imports, inventory, callGraph, options),
    findUnusedImports(options.projectDir, inventory, options),
    findDuplicateUtilities(options.projectDir, inventory, options),
  ]);

  // Combine and rank candidates
  const allCandidates: CleanupCandidate[] = [
    ...deadExports,
    ...unusedImports,
    ...duplicateUtilities,
  ];

  // Sort by confidence (high first), then by blast radius (low first)
  allCandidates.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    const confDiff = confOrder[a.confidence] - confOrder[b.confidence];
    if (confDiff !== 0) return confDiff;
    return a.blastRadius - b.blastRadius;
  });

  return {
    ran: true,
    candidates: allCandidates,
    summary: {
      deadExports: deadExports.length,
      unusedImports: unusedImports.length,
      duplicateUtilities: duplicateUtilities.length,
      totalFiles,
      filesAnalyzed,
      filesExcluded,
    },
    totalDurationMs: Date.now() - startMs,
  };
}

/**
 * Convert dead-code analysis result to AnalyzerOutput for cleanup transformations.
 *
 * This function bridges the analysis phase (this module) with the transformation
 * phase (cleanup-transformations.ts). Only high/medium confidence candidates
 * are included in the output to avoid false positives.
 */
export function toAnalyzerOutput(result: DeadCodeAnalysisResult): AnalyzerOutput {
  const output: AnalyzerOutput = {};

  // Filter for high/medium confidence only
  const highMediumCandidates = result.candidates.filter(
    (c) => c.confidence === "high" || c.confidence === "medium",
  );

  // Convert dead exports
  const deadExports: DeadExport[] = [];
  for (const c of highMediumCandidates) {
    if (c.type === "dead_export") {
      deadExports.push({
        file: c.file,
        name: c.name,
        startLine: c.line,
        endLine: c.endLine,
      });
    }
  }
  if (deadExports.length > 0) {
    output.deadExports = deadExports;
  }

  // Convert unused imports
  const unusedImports: UnusedImport[] = [];
  for (const c of highMediumCandidates) {
    if (c.type === "unused_import") {
      unusedImports.push({
        file: c.file,
        importStatement: c.importStatement,
        startLine: c.line,
        endLine: c.endLine,
        symbols: c.symbols,
      });
    }
  }
  if (unusedImports.length > 0) {
    output.unusedImports = unusedImports;
  }

  // Convert duplicate utilities
  const duplicateUtilities: DuplicateUtility[] = [];
  // Group by canonical file
  const byCanonical = new Map<string, DuplicateUtilityCandidate[]>();
  for (const c of highMediumCandidates) {
    if (c.type === "duplicate_utility") {
      if (!byCanonical.has(c.canonicalFile)) {
        byCanonical.set(c.canonicalFile, []);
      }
      byCanonical.get(c.canonicalFile)!.push(c);
    }
  }
  for (const [canonicalFile, dups] of byCanonical) {
    // For simplicity, use the first duplicate's info for canonical
    const firstDup = dups[0];
    duplicateUtilities.push({
      canonical: {
        file: canonicalFile,
        name: firstDup.name,
        startLine: 1, // We don't have exact line info for canonical
        endLine: 1,
      },
      duplicates: dups.map((d) => ({
        file: d.file,
        name: d.name,
        startLine: d.line,
        endLine: d.endLine,
      })),
      callerFiles: [], // Would need import graph analysis to populate
    });
  }
  if (duplicateUtilities.length > 0) {
    output.duplicateUtilities = duplicateUtilities;
  }

  return output;
}

/**
 * Format analysis results for human-readable output.
 */
export function formatDeadCodeResults(result: DeadCodeAnalysisResult): string {
  const lines: string[] = [];

  lines.push("Dead Code Analysis Results");
  lines.push("=".repeat(60));
  lines.push("");

  if (!result.ran) {
    lines.push(`Error: ${result.error}`);
    return lines.join("\n");
  }

  lines.push(`Files analyzed: ${result.summary.filesAnalyzed}`);
  lines.push(`Files excluded (tests/fixtures): ${result.summary.filesExcluded}`);
  lines.push(`Duration: ${result.totalDurationMs}ms`);
  lines.push("");

  lines.push("Summary:");
  lines.push(`  Dead exports: ${result.summary.deadExports}`);
  lines.push(`  Unused imports: ${result.summary.unusedImports}`);
  lines.push(`  Duplicate utilities: ${result.summary.duplicateUtilities}`);
  lines.push("");

  if (result.candidates.length === 0) {
    lines.push("No cleanup candidates found.");
    return lines.join("\n");
  }

  lines.push("Cleanup Candidates (sorted by confidence):");
  lines.push("-".repeat(60));

  for (const c of result.candidates.slice(0, 20)) {
    const conf = c.confidence.toUpperCase().padEnd(6);
    const type = c.type.replace(/_/g, " ").padEnd(18);
    lines.push(`[${conf}] ${type} ${c.file}:${c.type === "dead_export" ? (c as DeadExportCandidate).name : ""}`);
    lines.push(`         ${c.reason}`);
    lines.push("");
  }

  if (result.candidates.length > 20) {
    lines.push(`... and ${result.candidates.length - 20} more candidates`);
  }

  return lines.join("\n");
}
