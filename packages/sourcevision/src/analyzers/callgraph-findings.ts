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

import type { CallGraph, CallEdge, FunctionNode, Finding, Inventory, ImportEdge, Classifications } from "../schema/index.js";
import { BUILTIN_ARCHETYPES } from "./archetypes.js";
import { buildClassificationMap } from "./classify.js";

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

/** Path segments that identify modules where high fan-in is expected. */
const HIGH_FANIN_PATH_SEGMENTS = ["/core/", "/utils/", "/helpers/", "/lib/", "/store/", "/stores/"];

/** Basename patterns identifying modules where high fan-in is expected. */
const HIGH_FANIN_BASENAMES = [
  /(?:^|\/)output\.[tj]sx?$/,
  /(?:^|\/)logger\.[tj]sx?$/,
  /(?:^|\/)logging\.[tj]sx?$/,
  /(?:^|\/)errors\.[tj]sx?$/,
];

/**
 * Archetype IDs where high fan-in is expected, derived from analysisHints.
 * Any archetype with hubThresholdMultiplier or hotspotThresholdMultiplier
 * is included automatically — no hardcoded archetype names needed.
 */
const HIGH_FANIN_ARCHETYPES = new Set(
  BUILTIN_ARCHETYPES
    .filter(a => a.analysisHints?.hubThresholdMultiplier || a.analysisHints?.hotspotThresholdMultiplier)
    .map(a => a.id)
);

/**
 * Archetype IDs where elevated god function thresholds apply, derived from analysisHints.
 * Components and pages have inflated call counts from hooks, state setters, and JSX.
 */
const HIGH_GOD_THRESHOLD_ARCHETYPES = new Set(
  BUILTIN_ARCHETYPES
    .filter(a => a.analysisHints?.godFunctionThresholdMultiplier)
    .map(a => a.id)
);

/** Basename patterns that identify types/constants files where unidirectional coupling is expected. */
const TYPES_FILE_PATTERNS = [
  /(?:^|\/)types\.[tj]sx?$/,
  /(?:^|\/)constants\.[tj]sx?$/,
  /(?:^|\/)enums\.[tj]sx?$/,
  /\.types\.[tj]sx?$/,
  /\.constants\.[tj]sx?$/,
  /\.d\.ts$/,
];

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
  /** Classifications for archetype-based file role detection. When provided, archetype
   *  lookups replace hard-coded path patterns for utility/entrypoint/types detection. */
  classifications?: Classifications;
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

  // Build archetype lookup map from classifications
  const archetypeMap = buildClassificationMap(options?.classifications);

  // Build set of files where high fan-in is expected, checking both primary
  // and secondary archetypes against the hints-derived HIGH_FANIN_ARCHETYPES set.
  const highFanInFiles = buildHighFanInFileSet(options?.classifications);

  // Build set of files where god function thresholds are elevated (components, pages)
  const highGodThresholdFiles = buildArchetypeFileSet(options?.classifications, HIGH_GOD_THRESHOLD_ARCHETYPES);

  // Build set of test files from inventory — test files are excluded from
  // all architectural findings because tests inherently call many functions,
  // are tightly coupled to their subjects, and inflate fan-in counts.
  const testFiles = buildTestFileSet(options?.inventory);

  // Edge-based findings require at least some call edges
  if (edges.length > 0) {
    findings.push(...detectGodFunctions(edges, testFiles, highGodThresholdFiles));
    findings.push(...detectTightlyCoupledModules(edges, testFiles));
    findings.push(...detectHubFunctions(edges, testFiles, archetypeMap, highFanInFiles));
    findings.push(...detectHotspotFiles(edges, testFiles, archetypeMap, highFanInFiles));
  }

  // Dead export detection works with or without edges
  findings.push(...detectDeadExports(functions, edges, options?.inventory, options?.importEdges, archetypeMap));

  return findings;
}

// ── God functions ───────────────────────────────────────────────────────────

/**
 * Identify functions with excessive outgoing calls (god functions).
 * These functions likely do too much and should be decomposed.
 * Test files are excluded — tests naturally call many functions.
 * Components/pages get an elevated threshold — hooks, state setters, and JSX
 * inflate call counts without indicating real complexity.
 */
function detectGodFunctions(edges: CallEdge[], testFiles: Set<string>, highGodThresholdFiles?: Set<string>): Finding[] {
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
    .filter((v) => {
      const threshold = highGodThresholdFiles?.has(v.file)
        ? GOD_FUNCTION_THRESHOLD * 2
        : GOD_FUNCTION_THRESHOLD;
      return v.callees.size > threshold;
    })
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

    // Determine severity based on coupling direction and target file type:
    // - Bidirectional coupling above 3x threshold → critical (tangled modules)
    // - Bidirectional coupling → warning (should investigate)
    // - Unidirectional coupling → info (normal consumer-provider relationship)
    //   A 3000-line route file making 129 calls to its companion types module
    //   is expected, not problematic.
    let severity: Finding["severity"];
    if (isBidirectional && total > TIGHT_COUPLING_THRESHOLD * 3) {
      severity = "critical";
    } else if (isBidirectional) {
      severity = "warning";
    } else {
      severity = "info";
    }

    findings.push({
      type: "relationship",
      pass: 0,
      scope: "global",
      text: `Tightly coupled modules: ${pair.a} and ${pair.b} — ${total} cross-file calls (${direction}). Consider extracting shared interface or merging`,
      severity,
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
  archetypeMap?: Map<string, string | null>,
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
    if (isEntryPointFile(fn.file, archetypeMap)) continue;

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

    // Defensive fallback: direct edge scan catches any set-building edge cases.
    // O(n) per exported function but only runs for the small number that passed
    // all other checks — a safety net that makes the cross-reference impossible
    // to silently fail.
    if (importEdges?.some(e =>
      e.to === fn.file &&
      e.type !== "reexport" && e.type !== "type" &&
      e.symbols.includes(fn.name)
    )) continue;

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

/**
 * Build a set of file paths whose primary or secondary archetypes match
 * the given archetype set. Used for fan-in, god function, and other
 * archetype-driven threshold adjustments.
 */
function buildArchetypeFileSet(classifications: Classifications | undefined, archetypeSet: Set<string>): Set<string> {
  const result = new Set<string>();
  if (!classifications) return result;
  for (const fc of classifications.files) {
    const allArchetypes = [fc.archetype, ...(fc.secondaryArchetypes ?? [])].filter(Boolean) as string[];
    if (allArchetypes.some(a => archetypeSet.has(a))) {
      result.add(fc.path);
    }
  }
  return result;
}

/** Convenience wrapper: files where high fan-in is expected. */
function buildHighFanInFileSet(classifications?: Classifications): Set<string> {
  return buildArchetypeFileSet(classifications, HIGH_FANIN_ARCHETYPES);
}

function isEntryPointFile(filePath: string, archetypeMap?: Map<string, string | null>): boolean {
  if (archetypeMap?.size) {
    const archetype = archetypeMap.get(filePath);
    if (archetype === "entrypoint") return true;
    if (archetype) return false; // classified as something else
  }
  return ENTRY_POINT_PATTERNS.some((p) => p.test(filePath));
}

/**
 * Check if high fan-in is expected for this file based on archetype hints or path patterns.
 * Checks the pre-built highFanInFiles set first (which includes secondary archetypes),
 * then falls back to primary archetype, then path-based heuristics.
 */
function expectsHighFanIn(filePath: string, archetypeMap?: Map<string, string | null>, highFanInFiles?: Set<string>): boolean {
  // Pre-built set checks both primary and secondary archetypes
  if (highFanInFiles?.has(filePath)) return true;
  if (archetypeMap?.size) {
    const archetype = archetypeMap.get(filePath);
    if (archetype && HIGH_FANIN_ARCHETYPES.has(archetype)) return true;
    if (archetype) return false; // classified as something else
  }
  return HIGH_FANIN_PATH_SEGMENTS.some((seg) => filePath.includes(seg))
    || HIGH_FANIN_BASENAMES.some((p) => p.test(filePath));
}

/** Check if a file is a types/constants module (companion helper, not logic). */
function isTypesFile(filePath: string, archetypeMap?: Map<string, string | null>): boolean {
  if (archetypeMap?.size) {
    const archetype = archetypeMap.get(filePath);
    if (archetype === "types") return true;
    if (archetype) return false; // classified as something else
  }
  return TYPES_FILE_PATTERNS.some((p) => p.test(filePath));
}

// ── Hub functions ───────────────────────────────────────────────────────────

/**
 * Identify functions called from many different files.
 * These are high-impact functions where changes ripple widely.
 *
 * Modules where high fan-in is expected (utilities, stores, config, types)
 * get downgraded to "info" — hub status is inherent to their architectural role.
 * This is driven by archetype analysisHints, not hardcoded archetype names.
 */
function detectHubFunctions(edges: CallEdge[], testFiles: Set<string>, archetypeMap?: Map<string, string | null>, highFanInFiles?: Set<string>): Finding[] {
  // Count unique caller files per callee, excluding test file callers
  const calleeFiles = new Map<string, { name: string; file: string; callerFiles: Set<string> }>();

  for (const e of edges) {
    if (!e.calleeFile) continue;
    if (testFiles.has(e.callerFile)) continue;
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
    const highFanInExpected = expectsHighFanIn(file, archetypeMap, highFanInFiles);
    // Modules where high fan-in is expected (utilities, stores, config, types)
    // always get "info" — being a hub is inherent to their role.
    // Other modules get "warning" when above 2x threshold.
    const severity: Finding["severity"] = highFanInExpected
      ? "info"
      : callerFiles.size >= HUB_FUNCTION_FILE_THRESHOLD * 2 ? "warning" : "info";
    const note = highFanInExpected ? " (high fan-in expected for this module type)" : "";

    findings.push({
      type: "suggestion",
      pass: 0,
      scope: "global",
      text: `Hub function: ${name} in ${file} is called from ${callerFiles.size} files${note} — changes here have wide impact, consider if responsibilities can be narrowed`,
      severity,
      related: [file, ...Array.from(callerFiles).sort().slice(0, 3)],
    });
  }

  return findings;
}

// ── Hotspot files ───────────────────────────────────────────────────────────

/**
 * Identify files that receive calls from many different files (fan-in hotspots).
 * These are architectural bottlenecks where many modules depend on one file.
 *
 * Modules where high fan-in is expected (utilities, stores, config, types)
 * get downgraded to "info" — driven by archetype analysisHints.
 */
function detectHotspotFiles(edges: CallEdge[], testFiles: Set<string>, archetypeMap?: Map<string, string | null>, highFanInFiles?: Set<string>): Finding[] {
  // Count unique caller files per callee file, excluding test file callers
  const fileCallers = new Map<string, Set<string>>();

  for (const e of edges) {
    if (!e.calleeFile || e.callerFile === e.calleeFile) continue;
    if (testFiles.has(e.callerFile)) continue;
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
    const highFanInExpected = expectsHighFanIn(file, archetypeMap, highFanInFiles);
    // Modules where high fan-in is expected (utilities, stores, config, types)
    // always get "info" — high fan-in is inherent to their role.
    // Other modules get "warning" when above 2x threshold.
    const severity: Finding["severity"] = highFanInExpected
      ? "info"
      : callers.size >= HOTSPOT_FILE_THRESHOLD * 2 ? "warning" : "info";
    const note = highFanInExpected ? " (high fan-in expected for this module type)" : "";

    findings.push({
      type: "observation",
      pass: 0,
      scope: "global",
      text: `Fan-in hotspot: ${file} receives calls from ${callers.size} files${note} — high-impact module, changes may have wide ripple effects`,
      severity,
      related: [file, ...Array.from(callers).sort().slice(0, 3)],
    });
  }

  return findings;
}
