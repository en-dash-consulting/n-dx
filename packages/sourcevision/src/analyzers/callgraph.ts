/**
 * Deterministic call graph analyzer.
 * Uses the TypeScript compiler API for AST parsing — no Claude invocation.
 *
 * Extracts function/method definitions and call relationships to build
 * a call graph. Integrates with the import graph to resolve cross-file
 * caller-callee relationships.
 */

import { open, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import ts from "typescript";
import type {
  FunctionNode,
  CallEdge,
  CallType,
  CallGraph,
  CallGraphSummary,
  FileEntry,
  Inventory,
  Imports,
  ImportEdge,
} from "../schema/index.js";
import { sortCallGraph } from "../util/sort.js";
import { isMinifiedFile, isMinifiedName, MINIFIED_HEAD_BYTES, UNMAPPED_ROLES } from "./minified.js";
import { parseJsTsSource } from "./ts-source.js";
import { isOutsideStructure } from "./third-party.js";

// ── Parseable extensions ─────────────────────────────────────────────────────

const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// ── Function extraction ─────────────────────────────────────────────────────

/**
 * Extract all function/method definitions from a source file.
 * Returns FunctionNode[] with qualified names for class/object methods.
 */
export function extractFunctions(sourceText: string, filePath: string): FunctionNode[] {
  const sf = parseJsTsSource(filePath, sourceText);
  const functions: FunctionNode[] = [];

  function getLineAndCol(pos: number): { line: number; column: number } {
    const lc = sf.getLineAndCharacterOfPosition(pos);
    return { line: lc.line + 1, column: lc.character };
  }

  function isExported(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers) return false;
    return modifiers.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword);
  }

  function visit(node: ts.Node, context: string | null) {
    // Named function declaration: function foo() {}
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const { line, column } = getLineAndCol(node.getStart(sf));
      functions.push({
        file: filePath,
        name,
        line,
        column,
        qualifiedName: context ? `${context}.${name}` : name,
        isExported: isExported(node),
      });
      // Visit body for nested definitions
      if (node.body) {
        ts.forEachChild(node.body, (child) => visit(child, null));
      }
      return;
    }

    // Variable declaration with function/arrow expression:
    // const foo = () => {} or const foo = function() {}
    if (ts.isVariableStatement(node)) {
      const exported = isExported(node);
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          if (
            ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer)
          ) {
            const name = decl.name.text;
            const { line, column } = getLineAndCol(decl.getStart(sf));
            functions.push({
              file: filePath,
              name,
              line,
              column,
              qualifiedName: context ? `${context}.${name}` : name,
              isExported: exported,
            });
            // Visit body for nested definitions
            const body = decl.initializer.body;
            if (ts.isBlock(body)) {
              ts.forEachChild(body, (child) => visit(child, null));
            }
          } else if (ts.isObjectLiteralExpression(decl.initializer)) {
            // Object literal with methods: const utils = { helper() {} }
            const objName = decl.name.text;
            visitObjectMethods(decl.initializer, objName, exported);
          }
        }
      }
      return;
    }

    // Class declaration: class Foo { method() {} }
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const classExported = isExported(node);
      for (const member of node.members) {
        if (
          (ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) &&
          member.name
        ) {
          const methodName = ts.isIdentifier(member.name) ? member.name.text :
            ts.isStringLiteral(member.name) ? member.name.text : null;
          if (methodName) {
            const { line, column } = getLineAndCol(member.getStart(sf));
            functions.push({
              file: filePath,
              name: methodName,
              line,
              column,
              qualifiedName: `${className}.${methodName}`,
              isExported: classExported,
            });
          }
        }
        // Properties with arrow/function expressions
        if (ts.isPropertyDeclaration(member) && member.name && member.initializer) {
          if (
            ts.isArrowFunction(member.initializer) ||
            ts.isFunctionExpression(member.initializer)
          ) {
            const propName = ts.isIdentifier(member.name) ? member.name.text : null;
            if (propName) {
              const { line, column } = getLineAndCol(member.getStart(sf));
              functions.push({
                file: filePath,
                name: propName,
                line,
                column,
                qualifiedName: `${className}.${propName}`,
                isExported: classExported,
              });
            }
          }
        }
        // Constructor
        if (ts.isConstructorDeclaration(member)) {
          const { line, column } = getLineAndCol(member.getStart(sf));
          functions.push({
            file: filePath,
            name: "constructor",
            line,
            column,
            qualifiedName: `${className}.constructor`,
            isExported: classExported,
          });
        }
      }
      return;
    }

    // Export default function: export default function() {}
    if (ts.isExportAssignment(node) && node.expression) {
      if (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression)) {
        const name = ts.isFunctionExpression(node.expression) && node.expression.name
          ? node.expression.name.text
          : "<default>";
        const { line, column } = getLineAndCol(node.getStart(sf));
        functions.push({
          file: filePath,
          name,
          line,
          column,
          qualifiedName: name,
          isExported: true,
        });
      }
    }

    ts.forEachChild(node, (child) => visit(child, context));
  }

  function visitObjectMethods(
    obj: ts.ObjectLiteralExpression,
    objName: string,
    exported: boolean,
  ) {
    for (const prop of obj.properties) {
      if (ts.isMethodDeclaration(prop) && prop.name) {
        const methodName = ts.isIdentifier(prop.name) ? prop.name.text :
          ts.isStringLiteral(prop.name) ? prop.name.text : null;
        if (methodName) {
          const { line, column } = getLineAndCol(prop.getStart(sf));
          functions.push({
            file: filePath,
            name: methodName,
            line,
            column,
            qualifiedName: `${objName}.${methodName}`,
            isExported: exported,
          });
        }
      }
      if (ts.isPropertyAssignment(prop) && prop.name && prop.initializer) {
        if (
          ts.isArrowFunction(prop.initializer) ||
          ts.isFunctionExpression(prop.initializer)
        ) {
          const propName = ts.isIdentifier(prop.name) ? prop.name.text :
            ts.isStringLiteral(prop.name) ? prop.name.text : null;
          if (propName) {
            const { line, column } = getLineAndCol(prop.getStart(sf));
            functions.push({
              file: filePath,
              name: propName,
              line,
              column,
              qualifiedName: `${objName}.${propName}`,
              isExported: exported,
            });
          }
        }
      }
    }
  }

  visit(sf, null);
  return functions;
}

// ── Call extraction ─────────────────────────────────────────────────────────

interface RawCall {
  caller: string;
  callee: string;
  type: CallType;
  line: number;
  column: number;
}

/**
 * Extract all function calls from a source file.
 * Uses FunctionNode[] to determine which enclosing function is the "caller".
 * Calls at module level use "<module>" as the caller.
 */
export function extractCalls(
  sourceText: string,
  filePath: string,
  functions: FunctionNode[],
): RawCall[] {
  const sf = parseJsTsSource(filePath, sourceText);
  const calls: RawCall[] = [];

  // Build a position-based lookup for enclosing function
  // Sort functions by position for binary search
  const sortedFns = [...functions].sort((a, b) => a.line - b.line || a.column - b.column);

  function getLineAndCol(pos: number): { line: number; column: number } {
    const lc = sf.getLineAndCharacterOfPosition(pos);
    return { line: lc.line + 1, column: lc.character };
  }

  /**
   * Determine the enclosing function for a given node by walking up
   * the AST parent chain.
   */
  function findEnclosingFunction(node: ts.Node): string {
    let current = node.parent;
    while (current) {
      // Function declaration
      if (ts.isFunctionDeclaration(current) && current.name) {
        // Find matching FunctionNode for qualified name
        const fn = findFunctionByDeclaration(current);
        if (fn) return fn.qualifiedName;
        return current.name.text;
      }

      // Arrow function or function expression assigned to variable
      if (
        (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        current.parent
      ) {
        // Variable declaration
        if (ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
          const fn = findFunctionByName(current.parent.name.text, current.parent.getStart(sf));
          if (fn) return fn.qualifiedName;
          return current.parent.name.text;
        }
        // Property assignment in object literal
        if (ts.isPropertyAssignment(current.parent) && current.parent.name) {
          const propName = ts.isIdentifier(current.parent.name)
            ? current.parent.name.text
            : null;
          if (propName) {
            const fn = findFunctionByPos(current.parent.getStart(sf));
            if (fn) return fn.qualifiedName;
          }
        }
        // Property declaration in class
        if (ts.isPropertyDeclaration(current.parent) && current.parent.name) {
          const propName = ts.isIdentifier(current.parent.name)
            ? current.parent.name.text
            : null;
          if (propName) {
            const fn = findFunctionByPos(current.parent.getStart(sf));
            if (fn) return fn.qualifiedName;
          }
        }
      }

      // Method declaration (class or object literal)
      if (ts.isMethodDeclaration(current) && current.name) {
        const fn = findFunctionByPos(current.getStart(sf));
        if (fn) return fn.qualifiedName;
        const methodName = ts.isIdentifier(current.name) ? current.name.text : null;
        if (methodName) return methodName;
      }

      // Constructor
      if (ts.isConstructorDeclaration(current)) {
        const fn = findFunctionByPos(current.getStart(sf));
        if (fn) return fn.qualifiedName;
      }

      // Get/Set accessor
      if ((ts.isGetAccessor(current) || ts.isSetAccessor(current)) && current.name) {
        const fn = findFunctionByPos(current.getStart(sf));
        if (fn) return fn.qualifiedName;
      }

      current = current.parent;
    }
    return "<module>";
  }

  function findFunctionByDeclaration(node: ts.FunctionDeclaration): FunctionNode | undefined {
    if (!node.name) return undefined;
    const { line } = getLineAndCol(node.getStart(sf));
    return sortedFns.find((f) => f.name === node.name!.text && f.line === line);
  }

  function findFunctionByName(name: string, _pos: number): FunctionNode | undefined {
    const { line } = getLineAndCol(_pos);
    return sortedFns.find((f) => f.name === name && f.line === line);
  }

  function findFunctionByPos(pos: number): FunctionNode | undefined {
    const { line, column } = getLineAndCol(pos);
    return sortedFns.find((f) => f.line === line && f.column === column);
  }

  /**
   * Get the callee name from a call expression.
   * Returns { name, type } where type indicates how the call was made.
   */
  function getCalleeName(expr: ts.Expression): { name: string; type: CallType } | null {
    // Direct call: foo()
    if (ts.isIdentifier(expr)) {
      return { name: expr.text, type: "direct" };
    }

    // Property access: obj.method() or a.b.c()
    if (ts.isPropertyAccessExpression(expr)) {
      const chain = getPropertyAccessChain(expr);
      if (chain.length === 2) {
        return { name: chain.join("."), type: "method" };
      }
      if (chain.length > 2) {
        return { name: chain.join("."), type: "property-chain" };
      }
      // Fallback: just the property name
      return { name: expr.name.text, type: "method" };
    }

    // Element access (computed): obj[expr]()
    if (ts.isElementAccessExpression(expr)) {
      return { name: "<computed>", type: "computed" };
    }

    return null;
  }

  /**
   * Collect property access chain: a.b.c → ["a", "b", "c"]
   * Stops when it hits a non-property-access or a call expression.
   */
  function getPropertyAccessChain(expr: ts.PropertyAccessExpression): string[] {
    const parts: string[] = [expr.name.text];
    let current: ts.Expression = expr.expression;

    while (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
    }

    if (ts.isIdentifier(current)) {
      parts.unshift(current.text);
    } else if (ts.isCallExpression(current)) {
      // Chain starts with a call: createBuilder().build()
      // Don't include the call in the chain name — it's a separate call
      // Just return the property part
      return parts;
    } else if (current.kind === ts.SyntaxKind.ThisKeyword) {
      parts.unshift("this");
    }

    return parts;
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = getCalleeName(node.expression);
      if (callee) {
        const caller = findEnclosingFunction(node);
        const { line, column } = getLineAndCol(node.getStart(sf));
        calls.push({
          caller,
          callee: callee.name,
          type: callee.type,
          line,
          column,
        });
      }
    }

    // Also detect new expressions: new Foo()
    // We skip these for now — they're constructor calls, not function calls

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return calls;
}

// ── Import-based call resolution ────────────────────────────────────────────

/**
 * Build a map from file → { importedSymbol → sourceFile } using import edges.
 * Used to resolve cross-file call targets.
 */
function buildImportSymbolMap(
  edges: ImportEdge[],
): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();

  for (const edge of edges) {
    // Skip type-only imports — they don't create runtime call targets
    if (edge.type === "type") continue;

    if (!map.has(edge.from)) {
      map.set(edge.from, new Map());
    }
    const fileMap = map.get(edge.from)!;

    for (const sym of edge.symbols) {
      if (sym === "*") {
        // Namespace or star import — can't resolve individual symbols
        continue;
      }
      fileMap.set(sym, edge.to);
    }
  }

  return map;
}

// ── Incremental types ────────────────────────────────────────────────────────

export interface CallGraphOptions {
  previousCallGraph?: CallGraph;
  changedFiles?: Set<string>;
  fileSetChanged?: boolean;
  /** `--include-minified`: map minified bundles too. Forces a full parse. */
  includeMinified?: boolean;
  /** Told how many minified files were left out, when any were. */
  onMinifiedLeftOut?: (count: number) => void;
  /** `--include-third-party`: map third-party and mirror-copy files too. Forces a full parse. */
  includeThirdParty?: boolean;
  /** Told how many third-party and mirror-copy files were left out, when any were. */
  onThirdPartyLeftOut?: (count: number) => void;
}

/** True when the file at `path` is minified, by name or by its first bytes. */
async function isMinifiedOnDisk(targetDir: string, path: string): Promise<boolean> {
  if (isMinifiedName(path)) return true;
  let handle;
  try {
    handle = await open(join(targetDir, path), "r");
    const buf = Buffer.alloc(MINIFIED_HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, MINIFIED_HEAD_BYTES, 0);
    return isMinifiedFile(path, buf.subarray(0, bytesRead));
  } catch {
    return false; // unreadable: not counted; the parse loop skips unreadable files too
  } finally {
    await handle?.close();
  }
}

/**
 * JS/TS files the call graph maps: each whose role is not in
 * {@link UNMAPPED_ROLES}, plus minified ones under `includeMinified`.
 * A minified file under a test directory keeps role `test` in the
 * inventory (a vendored `tests/js/jquery.min.js`), so test files are
 * checked here too. `minifiedLeftOut` counts the minified files it left out.
 */
export async function selectCallGraphFiles(
  targetDir: string,
  files: readonly FileEntry[],
  includeMinified = false,
  includeThirdParty = false,
): Promise<{ files: FileEntry[]; minifiedLeftOut: number; thirdPartyLeftOut: number }> {
  const selected: FileEntry[] = [];
  let minifiedLeftOut = 0;
  let thirdPartyLeftOut = 0;
  for (const f of files) {
    if (!JS_TS_EXTENSIONS.has(extname(f.path).toLowerCase())) continue;
    // Third-party and mirror-copy files (third-party.ts) are not the application's calls.
    if (!includeThirdParty && isOutsideStructure(f)) {
      thirdPartyLeftOut++;
      continue;
    }
    const unmapped = UNMAPPED_ROLES.has(f.role);
    if (!unmapped && f.role !== "test") {
      selected.push(f);
      continue;
    }
    if (!(await isMinifiedOnDisk(targetDir, f.path))) {
      if (!unmapped) selected.push(f); // an ordinary test file
      continue;
    }
    if (includeMinified) selected.push(f);
    else minifiedLeftOut++;
  }
  return { files: selected, minifiedLeftOut, thirdPartyLeftOut };
}

// ── Main analyzer ─────────────────────────────────────────────────────────

export async function analyzeCallGraph(
  targetDir: string,
  inventory: Inventory,
  imports: Imports,
  options?: CallGraphOptions,
): Promise<CallGraph> {
  const prev = options?.previousCallGraph;
  const changedFiles = options?.changedFiles;
  const fileSetChanged = options?.fileSetChanged ?? true;

  // A minified file left out last run has nothing to reuse, so including them parses everything.
  const canIncremental = prev && changedFiles && !fileSetChanged && !options?.includeMinified && !options?.includeThirdParty;

  const mapped = await selectCallGraphFiles(targetDir, inventory.files, options?.includeMinified, options?.includeThirdParty);
  if (mapped.minifiedLeftOut > 0) options?.onMinifiedLeftOut?.(mapped.minifiedLeftOut);
  if (mapped.thirdPartyLeftOut > 0) options?.onThirdPartyLeftOut?.(mapped.thirdPartyLeftOut);

  // Build import symbol resolution map
  const importSymbolMap = buildImportSymbolMap(imports.edges);

  // Collect functions and calls
  const allFunctions: FunctionNode[] = [];
  const allCalls: CallEdge[] = [];

  if (canIncremental) {
    // Keep functions and edges from unchanged files that are still inventoried
    // and mapped. fileSetChanged compares against the previous inventory, not
    // the previous call graph, so files pruned in an earlier run can still be
    // in prev (#744), as can minified files an --include-minified run mapped.
    const inventoried = new Set(inventory.files.map((f) => f.path));
    const kept = new Set(mapped.files.map((f) => f.path));
    for (const fn of prev.functions) {
      if (!changedFiles.has(fn.file) && kept.has(fn.file)) {
        allFunctions.push(fn);
      }
    }
    for (const edge of prev.edges) {
      if (!changedFiles.has(edge.callerFile) && kept.has(edge.callerFile)) {
        // A full run cannot resolve a call into a file outside the inventory.
        const calleeFile = edge.calleeFile && inventoried.has(edge.calleeFile) ? edge.calleeFile : null;
        allCalls.push(calleeFile === edge.calleeFile ? edge : { ...edge, calleeFile });
      }
    }
  }

  // Determine which files to parse
  const parseable = canIncremental ? mapped.files.filter((f) => changedFiles.has(f.path)) : mapped.files;

  for (const file of parseable) {
    const fullPath = join(targetDir, file.path);
    let sourceText: string;
    try {
      sourceText = await readFile(fullPath, "utf-8");
    } catch {
      continue; // skip unreadable files
    }

    const functions = extractFunctions(sourceText, file.path);
    allFunctions.push(...functions);

    const rawCalls = extractCalls(sourceText, file.path, functions);

    // Resolve call targets using import map
    const fileImportMap = importSymbolMap.get(file.path);

    for (const raw of rawCalls) {
      // Try to resolve the callee to a specific file
      let calleeFile: string | null = null;
      const calleeName = raw.callee;

      // Direct call — check if the callee name matches an imported symbol
      if (raw.type === "direct" && fileImportMap) {
        calleeFile = fileImportMap.get(calleeName) ?? null;
      }

      // Method call — check if the receiver matches an imported symbol
      // e.g., "utils.helper" → check if "utils" is imported
      if ((raw.type === "method" || raw.type === "property-chain") && fileImportMap) {
        const parts = calleeName.split(".");
        if (parts.length >= 2) {
          const receiver = parts[0];
          // Check if the receiver is an imported namespace
          calleeFile = fileImportMap.get(receiver) ?? null;
        }
      }

      // If callee is a local function in the same file, set calleeFile to current file
      if (!calleeFile) {
        const localMatch = allFunctions.find(
          (f) => f.file === file.path && (f.name === calleeName || f.qualifiedName === calleeName)
        );
        if (localMatch) {
          calleeFile = file.path;
        }
      }

      allCalls.push({
        callerFile: file.path,
        caller: raw.caller,
        calleeFile,
        callee: calleeName,
        type: raw.type,
        line: raw.line,
        column: raw.column,
      });
    }
  }

  // Compute summary
  const summary = computeSummary(allFunctions, allCalls);

  return sortCallGraph({
    functions: allFunctions,
    edges: allCalls,
    summary,
  });
}

// ── Summary computation ─────────────────────────────────────────────────────

function computeSummary(functions: FunctionNode[], edges: CallEdge[]): CallGraphSummary {
  // Files with calls
  const filesWithCalls = new Set<string>();
  for (const e of edges) {
    filesWithCalls.add(e.callerFile);
  }

  // Most called (by unique callers)
  const callerCountMap = new Map<string, { qualifiedName: string; file: string; callers: Set<string> }>();
  for (const e of edges) {
    const key = `${e.calleeFile ?? "<external>"}:${e.callee}`;
    if (!callerCountMap.has(key)) {
      callerCountMap.set(key, {
        qualifiedName: e.callee,
        file: e.calleeFile ?? "<external>",
        callers: new Set(),
      });
    }
    callerCountMap.get(key)!.callers.add(`${e.callerFile}:${e.caller}`);
  }

  const mostCalled = Array.from(callerCountMap.values())
    .map((v) => ({
      qualifiedName: v.qualifiedName,
      file: v.file,
      callerCount: v.callers.size,
    }))
    .sort((a, b) => b.callerCount - a.callerCount || a.qualifiedName.localeCompare(b.qualifiedName))
    .slice(0, 20);

  // Most calling (by unique callees)
  const calleeCountMap = new Map<string, { qualifiedName: string; file: string; callees: Set<string> }>();
  for (const e of edges) {
    const key = `${e.callerFile}:${e.caller}`;
    if (!calleeCountMap.has(key)) {
      calleeCountMap.set(key, {
        qualifiedName: e.caller,
        file: e.callerFile,
        callees: new Set(),
      });
    }
    calleeCountMap.get(key)!.callees.add(e.callee);
  }

  const mostCalling = Array.from(calleeCountMap.values())
    .map((v) => ({
      qualifiedName: v.qualifiedName,
      file: v.file,
      calleeCount: v.callees.size,
    }))
    .sort((a, b) => b.calleeCount - a.calleeCount || a.qualifiedName.localeCompare(b.qualifiedName))
    .slice(0, 20);

  // Detect cycles in the call graph
  const cycleCount = detectCallCycles(edges);

  return {
    totalFunctions: functions.length,
    totalCalls: edges.length,
    filesWithCalls: filesWithCalls.size,
    mostCalled,
    mostCalling,
    cycleCount,
  };
}

/**
 * Detect cycles in the call graph using DFS.
 * Returns the number of cycles found.
 * Uses function-level granularity (file:qualifiedName as node identity).
 */
function detectCallCycles(edges: CallEdge[]): number {
  // Build adjacency list from caller → callee (function-level)
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.calleeFile) continue; // Skip unresolved callees
    const callerKey = `${e.callerFile}:${e.caller}`;
    const calleeKey = `${e.calleeFile}:${e.callee}`;
    if (!adj.has(callerKey)) adj.set(callerKey, new Set());
    adj.get(callerKey)!.add(calleeKey);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  let cycleCount = 0;

  // Iterative DFS: a call chain thousands of functions deep (a mapped bundle)
  // must not overflow the stack. Each back edge counts once, as before.
  const visit = (start: string) => {
    if (visited.has(start)) return;
    visited.add(start);
    inStack.add(start);
    const frames: { node: string; next: Iterator<string> }[] = [
      { node: start, next: (adj.get(start) ?? new Set<string>()).values() },
    ];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const step = frame.next.next();
      if (step.done) {
        inStack.delete(frame.node);
        frames.pop();
        continue;
      }
      const child = step.value;
      if (inStack.has(child)) {
        cycleCount++;
      } else if (!visited.has(child)) {
        visited.add(child);
        inStack.add(child);
        frames.push({ node: child, next: (adj.get(child) ?? new Set<string>()).values() });
      }
    }
  };

  for (const node of adj.keys()) {
    visit(node);
  }

  return cycleCount;
}

// ── Zone call graph statistics ────────────────────────────────────────────

export interface ZoneCallStats {
  /** Zone ID */
  zoneId: string;
  /** Total call edges within this zone */
  internalCalls: number;
  /** Total call edges from this zone to other zones */
  outgoingCalls: number;
  /** Total call edges from other zones to this zone */
  incomingCalls: number;
  /** Call-based cohesion: internalCalls / totalCalls */
  callCohesion: number;
  /** Call-based coupling: externalCalls / totalCalls */
  callCoupling: number;
}

export interface CrossZoneCallPattern {
  /** Source zone ID */
  fromZone: string;
  /** Target zone ID */
  toZone: string;
  /** Number of call edges in this direction */
  callCount: number;
}

/**
 * Compute zone-level call graph statistics.
 * Returns per-zone call cohesion/coupling metrics and cross-zone call patterns.
 */
export function computeZoneCallStats(
  edges: CallEdge[],
  fileToZone: Map<string, string>,
): { zoneStats: ZoneCallStats[]; crossZonePatterns: CrossZoneCallPattern[] } {
  const zoneCalls = new Map<string, { internal: number; outgoing: number; incoming: number }>();
  const crossZoneCounts = new Map<string, number>();

  for (const edge of edges) {
    if (!edge.calleeFile) continue;

    const callerZone = fileToZone.get(edge.callerFile);
    const calleeZone = fileToZone.get(edge.calleeFile);

    if (!callerZone && !calleeZone) continue;

    // Ensure zone entries exist
    if (callerZone && !zoneCalls.has(callerZone)) {
      zoneCalls.set(callerZone, { internal: 0, outgoing: 0, incoming: 0 });
    }
    if (calleeZone && !zoneCalls.has(calleeZone)) {
      zoneCalls.set(calleeZone, { internal: 0, outgoing: 0, incoming: 0 });
    }

    if (callerZone && calleeZone && callerZone === calleeZone) {
      // Internal call
      zoneCalls.get(callerZone)!.internal++;
    } else if (callerZone && calleeZone) {
      // Cross-zone call
      zoneCalls.get(callerZone)!.outgoing++;
      zoneCalls.get(calleeZone)!.incoming++;
      const key = `${callerZone}\0${calleeZone}`;
      crossZoneCounts.set(key, (crossZoneCounts.get(key) ?? 0) + 1);
    } else if (callerZone) {
      zoneCalls.get(callerZone)!.outgoing++;
    } else if (calleeZone) {
      zoneCalls.get(calleeZone)!.incoming++;
    }
  }

  const zoneStats: ZoneCallStats[] = [];
  for (const [zoneId, counts] of [...zoneCalls.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = counts.internal + counts.outgoing;
    zoneStats.push({
      zoneId,
      internalCalls: counts.internal,
      outgoingCalls: counts.outgoing,
      incomingCalls: counts.incoming,
      callCohesion: total > 0 ? Math.round((counts.internal / total) * 100) / 100 : 1,
      callCoupling: total > 0 ? Math.round((counts.outgoing / total) * 100) / 100 : 0,
    });
  }

  const crossZonePatterns: CrossZoneCallPattern[] = [];
  for (const [key, count] of [...crossZoneCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const [fromZone, toZone] = key.split("\0");
    crossZonePatterns.push({ fromZone, toZone, callCount: count });
  }

  return { zoneStats, crossZonePatterns };
}
