/**
 * Generate deterministic architectural findings from call graph data.
 *
 * Analyzes call graph patterns to identify:
 * - God functions (excessive outgoing calls)
 * - Tightly coupled modules (dense cross-file call patterns)
 * - Potentially dead code (exported functions with no incoming calls)
 * - Refactoring suggestions (hub functions, fan-in hotspots)
 *
 * All findings are deterministic (pass 0) — no AI invocation.
 */

import type { CallGraph, CallEdge, FunctionNode, Finding, Inventory, ImportEdge } from "../schema/index.js";

// ── Thresholds ──────────────────────────────────────────────────────────────

/** Functions calling more than this many unique callees are "god functions". */
const GOD_FUNCTION_THRESHOLD = 30;

/** File pairs with more than this many cross-file call edges are tightly coupled. */
const TIGHT_COUPLING_THRESHOLD = 30;

/** Functions called from more than this many distinct files are hub functions. */
const HUB_FUNCTION_FILE_THRESHOLD = 6;

/** Files receiving calls from more than this many distinct files are hotspots. */
const HOTSPOT_FILE_THRESHOLD = 5;

/** Maximum number of dead-export findings to emit. */
const MAX_DEAD_EXPORT_FINDINGS = 10;

/**
 * Built-in / standard-library method names excluded from god function detection.
 * Only excluded when the call type is "method" — a user-defined function named
 * "filter" called directly (type: "direct") is still counted.
 */
const BUILTIN_METHOD_NAMES = new Set([
  // Array
  "at", "concat", "copyWithin", "entries", "every", "fill", "filter", "find",
  "findIndex", "findLast", "findLastIndex", "flat", "flatMap", "forEach",
  "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "pop", "push",
  "reduce", "reduceRight", "reverse", "shift", "slice", "some", "sort",
  "splice", "toReversed", "toSorted", "toSpliced", "unshift", "values", "with",
  // String
  "charAt", "charCodeAt", "codePointAt", "endsWith", "localeCompare", "match",
  "matchAll", "normalize", "padEnd", "padStart", "repeat", "replace",
  "replaceAll", "search", "split", "startsWith", "substring", "toLocaleLowerCase",
  "toLocaleUpperCase", "toLowerCase", "toUpperCase", "trim", "trimEnd", "trimStart",
  // Object / generic
  "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString",
  "toString", "valueOf",
  // Number
  "toExponential", "toFixed", "toPrecision",
  // Map / Set
  "clear", "delete", "get", "has", "set",
  // Promise
  "then", "catch", "finally",
  // RegExp
  "exec", "test",
  // Iterable/Iterator
  "next", "return", "throw",
  // Console/logging (commonly chained)
  "log", "warn", "error", "info", "debug",
  // DOM (commonly seen in UI code)
  "addEventListener", "removeEventListener", "appendChild", "removeChild",
  "querySelector", "querySelectorAll", "getAttribute", "setAttribute",
  "createElement", "getElementById", "preventDefault", "stopPropagation",
]);

/** Files where uncalled exports are expected (entry points, configs, etc.). */
const ENTRY_POINT_PATTERNS = [
  /(?:^|\/)index\.[tj]sx?$/,
  /(?:^|\/)main\.[tj]sx?$/,
  /(?:^|\/)cli\.[tj]sx?$/,
  /(?:^|\/)public\.[tj]sx?$/,
  /(?:^|\/)mod\.[tj]sx?$/,
  /\.config\.[tj]sx?$/,
  /\.d\.ts$/,
];

// ── Options ─────────────────────────────────────────────────────────────────

export interface CallGraphFindingsOptions {
  /** Inventory for file role detection (skip test files, identify entry points). */
  inventory?: Inventory;
  /** Import edges for re-export detection (skip exports consumed by re-export chains). */
  importEdges?: ImportEdge[];
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Generate architectural findings from call graph data.
 * Returns deterministic `Finding[]` objects at pass 0 (structural).
 */
export function generateCallGraphFindings(
  callGraph: CallGraph,
  options?: CallGraphFindingsOptions,
): Finding[] {
  const { functions, edges } = callGraph;

  // Skip trivial call graphs (no functions to analyze at all)
  if (functions.length === 0) return [];

  const findings: Finding[] = [];

  // Build set of test files from inventory — test files are excluded from
  // god-function and tight-coupling detection because tests inherently call
  // many functions and are tightly coupled to their subjects by design.
  const testFiles = buildTestFileSet(options?.inventory);

  // Edge-based findings require at least some call edges
  if (edges.length > 0) {
    findings.push(...detectGodFunctions(edges, testFiles));
    findings.push(...detectTightlyCoupledModules(edges, testFiles));
    findings.push(...detectHubFunctions(edges));
    findings.push(...detectHotspotFiles(edges));
  }

  // Dead export detection works with or without edges
  findings.push(...detectDeadExports(functions, edges, options?.inventory, options?.importEdges));

  return findings;
}

// ── God functions ───────────────────────────────────────────────────────────

/**
 * Identify functions with excessive outgoing calls (god functions).
 * These functions likely do too much and should be decomposed.
 * Test files are excluded — tests naturally call many functions.
 */
function detectGodFunctions(edges: CallEdge[], testFiles: Set<string>): Finding[] {
  // Count unique callees per caller (file:qualifiedName), excluding built-in
  // method calls that inflate counts without indicating real complexity.
  const callerCallees = new Map<string, { file: string; name: string; callees: Set<string> }>();

  for (const e of edges) {
    // Skip built-in method calls — only when call type is "method", so a
    // user-defined function named "filter" called directly is still counted.
    if (e.type === "method" && BUILTIN_METHOD_NAMES.has(e.callee)) continue;

    const key = `${e.callerFile}:${e.caller}`;
    if (!callerCallees.has(key)) {
      callerCallees.set(key, {
        file: e.callerFile,
        name: e.caller,
        callees: new Set(),
      });
    }
    callerCallees.get(key)!.callees.add(e.callee);
  }

  const findings: Finding[] = [];

  const sorted = [...callerCallees.values()]
    .filter((v) => v.callees.size > GOD_FUNCTION_THRESHOLD)
    .filter((v) => !testFiles.has(v.file))
    .sort((a, b) => b.callees.size - a.callees.size);

  for (const { file, name, callees } of sorted.slice(0, 5)) {
    findings.push({
      type: "anti-pattern",
      pass: 0,
      scope: "global",
      text: `God function: ${name} in ${file} calls ${callees.size} unique functions — consider decomposing into smaller, focused functions`,
      severity: callees.size > GOD_FUNCTION_THRESHOLD * 3 ? "critical" : "warning",
      related: [file],
    });
  }

  return findings;
}

// ── Tightly coupled modules ─────────────────────────────────────────────────

/**
 * Detect file pairs with dense cross-file call patterns.
 * Dense bidirectional or unidirectional call traffic suggests
 * the files should be merged or have a shared interface extracted.
 * Pairs where either file is a test are excluded — tests are
 * naturally tightly coupled to the modules they exercise.
 */
function detectTightlyCoupledModules(edges: CallEdge[], testFiles: Set<string>): Finding[] {
  // Count call edges between file pairs
  const pairCounts = new Map<string, { a: string; b: string; ab: number; ba: number }>();

  for (const e of edges) {
    if (!e.calleeFile || e.callerFile === e.calleeFile) continue;

    const [a, b] = e.callerFile < e.calleeFile
      ? [e.callerFile, e.calleeFile]
      : [e.calleeFile, e.callerFile];
    const key = `${a}\0${b}`;

    if (!pairCounts.has(key)) {
      pairCounts.set(key, { a, b, ab: 0, ba: 0 });
    }
    const pair = pairCounts.get(key)!;
    if (e.callerFile === a) pair.ab++;
    else pair.ba++;
  }

  const findings: Finding[] = [];

  const sorted = [...pairCounts.values()]
    .filter((p) => p.ab + p.ba >= TIGHT_COUPLING_THRESHOLD)
    .filter((p) => !testFiles.has(p.a) && !testFiles.has(p.b))
    .sort((a, b) => (b.ab + b.ba) - (a.ab + a.ba));

  for (const pair of sorted.slice(0, 5)) {
    const total = pair.ab + pair.ba;
    const isBidirectional = pair.ab > 0 && pair.ba > 0;
    const direction = isBidirectional
      ? `bidirectional (${pair.ab}↔${pair.ba})`
      : `unidirectional`;

    // Critical only for bidirectional coupling — unidirectional high-call-count
    // pairs (e.g., route handler → utility module) are normal consumer-provider
    // relationships, not architectural problems requiring immediate attention.
    const isCritical = isBidirectional && total > TIGHT_COUPLING_THRESHOLD * 3;

    findings.push({
      type: "relationship",
      pass: 0,
      scope: "global",
      text: `Tightly coupled modules: ${pair.a} and ${pair.b} — ${total} cross-file calls (${direction}). Consider extracting shared interface or merging`,
      severity: isCritical ? "critical" : "warning",
      related: [pair.a, pair.b],
    });
  }

  return findings;
}

// ── Dead code detection ─────────────────────────────────────────────────────

/**
 * Find exported functions with no incoming calls.
 * Groups findings by file to avoid noise.
 */
function detectDeadExports(
  functions: FunctionNode[],
  edges: CallEdge[],
  inventory?: Inventory,
  importEdges?: ImportEdge[],
): Finding[] {
  // Build set of functions that are called
  const calledFunctions = new Set<string>();
  for (const e of edges) {
    if (e.calleeFile) {
      calledFunctions.add(`${e.calleeFile}:${e.callee}`);
    }
    // Also match by callee name alone for same-file calls
    calledFunctions.add(`${e.callerFile}:${e.callee}`);
  }

  // Build set of re-exported symbols per file.
  // If file B has `export { foo } from "./A"`, then foo in A is consumed via re-export
  // and should not be flagged as dead code.
  const reexportedSymbols = buildReexportedSymbolSet(importEdges);

  // Build set of symbols consumed via import edges (static, dynamic, require).
  // Exports that appear in any import edge's symbols array are in use even if
  // the call graph has no corresponding CallExpression edge — this covers:
  //   - dynamic imports:  `const { cmdConfig } = await import("./config.js")`
  //   - JSX usage:        `<HealthGauge />` (no call edge produced)
  //   - validators/guards imported but called inline rather than via function call
  const importedSymbols = buildImportedSymbolSet(importEdges);

  // Build set of test files from inventory
  const testFiles = buildTestFileSet(inventory);

  // Find exported functions with no incoming calls
  const deadByFile = new Map<string, string[]>();

  for (const fn of functions) {
    if (!fn.isExported) continue;

    // Skip entry-point files
    if (isEntryPointFile(fn.file)) continue;

    // Skip test files
    if (testFiles.has(fn.file)) continue;

    // Skip <module> and <default> pseudo-functions
    if (fn.name.startsWith("<")) continue;

    // Skip class/object methods — they inherit isExported from their parent
    // but are accessed via instance.method(), not as direct module exports.
    // A qualified name like "ClassName.method" indicates a member, not a
    // top-level export.
    if (fn.qualifiedName !== fn.name) continue;

    // Skip exports consumed by re-export chains — another file re-exports this
    // symbol, so it is reachable even without direct call edges to this file.
    if (reexportedSymbols.has(`${fn.file}:${fn.name}`)) continue;

    // Skip exports consumed by import edges (static, dynamic, or require).
    // These are in use even without a call graph edge.
    if (importedSymbols.has(`${fn.file}:${fn.name}`)) continue;

    // Check if this function is called anywhere
    const key = `${fn.file}:${fn.qualifiedName}`;
    const keyByName = `${fn.file}:${fn.name}`;
    if (calledFunctions.has(key) || calledFunctions.has(keyByName)) continue;

    // Also check by just the name (cross-file calls may only have name)
    let isCalledAnywhere = false;
    for (const e of edges) {
      if (e.callee === fn.name && e.calleeFile === fn.file) {
        isCalledAnywhere = true;
        break;
      }
      if (e.callee === fn.qualifiedName && e.calleeFile === fn.file) {
        isCalledAnywhere = true;
        break;
      }
    }
    if (isCalledAnywhere) continue;

    if (!deadByFile.has(fn.file)) {
      deadByFile.set(fn.file, []);
    }
    deadByFile.get(fn.file)!.push(fn.name);
  }

  const findings: Finding[] = [];
  const sortedFiles = [...deadByFile.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  for (const [file, names] of sortedFiles.slice(0, MAX_DEAD_EXPORT_FINDINGS)) {
    if (names.length === 1) {
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: "global",
        text: `Potentially unused export: ${names[0]} in ${file} has no incoming calls — verify if still needed`,
        severity: "info",
        related: [file],
      });
    } else {
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: "global",
        text: `${names.length} potentially unused exports in ${file} have no incoming calls: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` (+${names.length - 5} more)` : ""}`,
        severity: names.length >= 5 ? "warning" : "info",
        related: [file],
      });
    }
  }

  return findings;
}

/**
 * Build a set of "file:symbol" keys for exports consumed by re-export chains.
 * If file B has `export { foo } from "./A"`, then "A:foo" is in the set.
 */
function buildReexportedSymbolSet(importEdges?: ImportEdge[]): Set<string> {
  const result = new Set<string>();
  if (!importEdges) return result;

  for (const edge of importEdges) {
    if (edge.type !== "reexport") continue;
    for (const sym of edge.symbols) {
      if (sym === "*") continue; // Can't resolve individual symbols from star re-exports
      result.add(`${edge.to}:${sym}`);
    }
  }

  return result;
}

/**
 * Build a set of "file:symbol" keys for exports consumed via import edges.
 * An export is considered used if any import edge (static, dynamic, or require)
 * targets the file and includes the symbol name. This catches usages that don't
 * produce CallExpression nodes in the call graph (e.g., JSX components, dynamic
 * imports, validators used inline).
 */
function buildImportedSymbolSet(importEdges?: ImportEdge[]): Set<string> {
  const result = new Set<string>();
  if (!importEdges) return result;

  for (const edge of importEdges) {
    // Only consider consumption edges — reexports are handled separately
    if (edge.type === "reexport" || edge.type === "type") continue;
    for (const sym of edge.symbols) {
      if (sym === "*") continue; // Can't resolve individual symbols from namespace imports
      result.add(`${edge.to}:${sym}`);
    }
  }

  return result;
}

/**
 * Build a set of test file paths from the inventory.
 * Used to exclude test files from architectural findings — tests inherently
 * call many functions and are tightly coupled to their subjects by design.
 */
function buildTestFileSet(inventory?: Inventory): Set<string> {
  const result = new Set<string>();
  if (!inventory) return result;
  for (const f of inventory.files) {
    if (f.role === "test") result.add(f.path);
  }
  return result;
}

function isEntryPointFile(filePath: string): boolean {
  return ENTRY_POINT_PATTERNS.some((p) => p.test(filePath));
}

// ── Hub functions ───────────────────────────────────────────────────────────

/**
 * Identify functions called from many different files.
 * These are high-impact functions where changes ripple widely.
 */
function detectHubFunctions(edges: CallEdge[]): Finding[] {
  // Count unique caller files per callee
  const calleeFiles = new Map<string, { name: string; file: string; callerFiles: Set<string> }>();

  for (const e of edges) {
    if (!e.calleeFile) continue;
    const key = `${e.calleeFile}:${e.callee}`;
    if (!calleeFiles.has(key)) {
      calleeFiles.set(key, {
        name: e.callee,
        file: e.calleeFile,
        callerFiles: new Set(),
      });
    }
    calleeFiles.get(key)!.callerFiles.add(e.callerFile);
  }

  const findings: Finding[] = [];

  const sorted = [...calleeFiles.values()]
    .filter((v) => v.callerFiles.size >= HUB_FUNCTION_FILE_THRESHOLD)
    .sort((a, b) => b.callerFiles.size - a.callerFiles.size);

  for (const { name, file, callerFiles } of sorted.slice(0, 5)) {
    findings.push({
      type: "suggestion",
      pass: 0,
      scope: "global",
      text: `Hub function: ${name} in ${file} is called from ${callerFiles.size} files — changes here have wide impact, consider if responsibilities can be narrowed`,
      severity: callerFiles.size >= HUB_FUNCTION_FILE_THRESHOLD * 2 ? "warning" : "info",
      related: [file, ...Array.from(callerFiles).sort().slice(0, 3)],
    });
  }

  return findings;
}

// ── Hotspot files ───────────────────────────────────────────────────────────

/**
 * Identify files that receive calls from many different files (fan-in hotspots).
 * These are architectural bottlenecks where many modules depend on one file.
 */
function detectHotspotFiles(edges: CallEdge[]): Finding[] {
  // Count unique caller files per callee file
  const fileCallers = new Map<string, Set<string>>();

  for (const e of edges) {
    if (!e.calleeFile || e.callerFile === e.calleeFile) continue;
    if (!fileCallers.has(e.calleeFile)) {
      fileCallers.set(e.calleeFile, new Set());
    }
    fileCallers.get(e.calleeFile)!.add(e.callerFile);
  }

  const findings: Finding[] = [];

  const sorted = [...fileCallers.entries()]
    .filter(([, callers]) => callers.size >= HOTSPOT_FILE_THRESHOLD)
    .sort((a, b) => b[1].size - a[1].size);

  for (const [file, callers] of sorted.slice(0, 5)) {
    findings.push({
      type: "observation",
      pass: 0,
      scope: "global",
      text: `Fan-in hotspot: ${file} receives calls from ${callers.size} files — high-impact module, changes may have wide ripple effects`,
      severity: callers.size >= HOTSPOT_FILE_THRESHOLD * 2 ? "warning" : "info",
      related: [file, ...Array.from(callers).sort().slice(0, 3)],
    });
  }

  return findings;
}
