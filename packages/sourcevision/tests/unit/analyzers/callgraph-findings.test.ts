import { describe, it, expect } from "vitest";
import { generateCallGraphFindings } from "../../../src/analyzers/callgraph-findings.js";
import type { CallGraph, FunctionNode, CallEdge, Inventory, ImportEdge } from "../../../src/schema/v1.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFn(overrides: Partial<FunctionNode> & { file: string; name: string }): FunctionNode {
  return {
    line: 1,
    column: 0,
    qualifiedName: overrides.qualifiedName ?? overrides.name,
    isExported: overrides.isExported ?? false,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<CallEdge> & { callerFile: string; caller: string; callee: string }): CallEdge {
  return {
    calleeFile: null,
    type: "direct",
    line: 1,
    column: 0,
    ...overrides,
  };
}

function makeCallGraph(functions: FunctionNode[], edges: CallEdge[]): CallGraph {
  return {
    functions,
    edges,
    summary: {
      totalFunctions: functions.length,
      totalCalls: edges.length,
      filesWithCalls: new Set(edges.map((e) => e.callerFile)).size,
      mostCalled: [],
      mostCalling: [],
      cycleCount: 0,
    },
  };
}

function makeInventory(files: string[]): Inventory {
  return {
    files: files.map((path) => ({
      path,
      language: "TypeScript",
      role: "source" as const,
      category: "code" as const,
      size: 100,
      hash: "abc123",
    })),
    summary: {
      totalFiles: files.length,
      totalSize: files.length * 100,
      languages: { TypeScript: files.length },
      roles: { source: files.length },
    },
  };
}

// ── God functions (excessive outgoing calls) ──────────────────────────────

describe("god functions", () => {
  it("identifies functions with excessive outgoing calls", () => {
    const godFn = makeFn({ file: "src/main.ts", name: "orchestrate" });
    const functions = [godFn];
    const edges: CallEdge[] = [];

    // 15 unique callees — well above any reasonable threshold
    for (let i = 0; i < 15; i++) {
      functions.push(makeFn({ file: "src/helpers.ts", name: `helper${i}` }));
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "orchestrate",
        callee: `helper${i}`,
        calleeFile: "src/helpers.ts",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const godFindings = findings.filter((f) => f.text.includes("orchestrate"));
    expect(godFindings.length).toBeGreaterThanOrEqual(1);
    expect(godFindings[0].severity).toBe("warning");
    expect(godFindings[0].type).toBe("anti-pattern");
    // Should mention the function name and call count
    expect(godFindings[0].text).toMatch(/orchestrate/);
    expect(godFindings[0].text).toMatch(/15/);
  });

  it("does not flag functions with moderate call counts", () => {
    const fn = makeFn({ file: "src/main.ts", name: "init" });
    const functions = [fn];
    const edges: CallEdge[] = [];

    // Only 4 callees — under threshold
    for (let i = 0; i < 4; i++) {
      functions.push(makeFn({ file: "src/helpers.ts", name: `step${i}` }));
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "init",
        callee: `step${i}`,
        calleeFile: "src/helpers.ts",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const godFindings = findings.filter((f) => f.text.includes("god function") || f.text.includes("excessive"));
    expect(godFindings).toHaveLength(0);
  });
});

// ── Tightly coupled modules ──────────────────────────────────────────────

describe("tightly coupled modules", () => {
  it("detects dense call patterns between file pairs", () => {
    const functions = [
      makeFn({ file: "src/a.ts", name: "a1" }),
      makeFn({ file: "src/a.ts", name: "a2" }),
      makeFn({ file: "src/a.ts", name: "a3" }),
      makeFn({ file: "src/b.ts", name: "b1" }),
      makeFn({ file: "src/b.ts", name: "b2" }),
      makeFn({ file: "src/b.ts", name: "b3" }),
    ];

    const edges: CallEdge[] = [];
    // a→b: 6 calls
    for (const caller of ["a1", "a2", "a3"]) {
      for (const callee of ["b1", "b2"]) {
        edges.push(makeEdge({
          callerFile: "src/a.ts",
          caller,
          callee,
          calleeFile: "src/b.ts",
        }));
      }
    }
    // b→a: 4 calls (bidirectional)
    for (const caller of ["b1", "b2"]) {
      for (const callee of ["a1", "a2"]) {
        edges.push(makeEdge({
          callerFile: "src/b.ts",
          caller,
          callee,
          calleeFile: "src/a.ts",
        }));
      }
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const couplingFindings = findings.filter(
      (f) => f.text.includes("src/a.ts") && f.text.includes("src/b.ts")
    );
    expect(couplingFindings.length).toBeGreaterThanOrEqual(1);
    expect(couplingFindings[0].severity).toBe("warning");
    expect(couplingFindings[0].type).toBe("relationship");
  });

  it("does not flag loosely connected file pairs", () => {
    const functions = [
      makeFn({ file: "src/a.ts", name: "a1" }),
      makeFn({ file: "src/b.ts", name: "b1" }),
    ];

    const edges = [
      makeEdge({
        callerFile: "src/a.ts",
        caller: "a1",
        callee: "b1",
        calleeFile: "src/b.ts",
      }),
    ];

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const couplingFindings = findings.filter(
      (f) => f.type === "relationship" && f.text.includes("tightly coupled")
    );
    expect(couplingFindings).toHaveLength(0);
  });
});

// ── Potentially dead code ────────────────────────────────────────────────

describe("dead code detection", () => {
  it("finds exported functions with no incoming calls", () => {
    const functions = [
      makeFn({ file: "src/utils.ts", name: "usedHelper", isExported: true }),
      makeFn({ file: "src/utils.ts", name: "unusedHelper", isExported: true }),
      makeFn({ file: "src/main.ts", name: "main", isExported: true }),
    ];

    const edges = [
      makeEdge({
        callerFile: "src/main.ts",
        caller: "main",
        callee: "usedHelper",
        calleeFile: "src/utils.ts",
      }),
    ];

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/utils.ts", "src/main.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory });

    const deadCodeFindings = findings.filter((f) => f.text.includes("unusedHelper"));
    expect(deadCodeFindings.length).toBeGreaterThanOrEqual(1);
    expect(deadCodeFindings[0].severity).toBe("info");
    expect(deadCodeFindings[0].type).toBe("suggestion");
  });

  it("does not flag non-exported functions as dead code", () => {
    const functions = [
      makeFn({ file: "src/utils.ts", name: "privateHelper", isExported: false }),
      makeFn({ file: "src/main.ts", name: "main", isExported: true }),
    ];

    const edges = [
      makeEdge({
        callerFile: "src/main.ts",
        caller: "main",
        callee: "otherThing",
        calleeFile: "src/other.ts",
      }),
    ];

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/utils.ts", "src/main.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory });

    const deadCodeFindings = findings.filter((f) => f.text.includes("privateHelper"));
    expect(deadCodeFindings).toHaveLength(0);
  });

  it("does not flag entry-point files", () => {
    // Main/index files should not be flagged even if not called internally
    const functions = [
      makeFn({ file: "src/index.ts", name: "init", isExported: true }),
      makeFn({ file: "src/cli/index.ts", name: "run", isExported: true }),
    ];

    const cg = makeCallGraph(functions, []);
    const inventory = makeInventory(["src/index.ts", "src/cli/index.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory });

    const deadCodeFindings = findings.filter(
      (f) => f.type === "suggestion" && f.text.includes("no incoming calls")
    );
    expect(deadCodeFindings).toHaveLength(0);
  });

  it("does not flag class instance methods as dead exports", () => {
    // Class methods have qualifiedName "ClassName.method" but are called via
    // instance.method() — these are not individual module exports.
    const functions = [
      makeFn({
        file: "src/renderer.ts",
        name: "constructor",
        qualifiedName: "GraphRenderer.constructor",
        isExported: true,
      }),
      makeFn({
        file: "src/renderer.ts",
        name: "highlightNode",
        qualifiedName: "GraphRenderer.highlightNode",
        isExported: true,
      }),
      makeFn({
        file: "src/renderer.ts",
        name: "centerOnNode",
        qualifiedName: "GraphRenderer.centerOnNode",
        isExported: true,
      }),
      makeFn({
        file: "src/renderer.ts",
        name: "destroy",
        qualifiedName: "GraphRenderer.destroy",
        isExported: true,
      }),
      // A real top-level unused export should still be flagged
      makeFn({ file: "src/utils.ts", name: "unusedHelper", isExported: true }),
    ];

    const cg = makeCallGraph(functions, []);
    const inventory = makeInventory(["src/renderer.ts", "src/utils.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory });

    // Class methods should NOT be flagged
    const rendererFindings = findings.filter(
      (f) => f.text.includes("src/renderer.ts") && f.text.includes("unused")
    );
    expect(rendererFindings).toHaveLength(0);

    // Top-level export should still be flagged
    const utilFindings = findings.filter((f) => f.text.includes("unusedHelper"));
    expect(utilFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag object literal methods as dead exports", () => {
    // Object literal methods have qualifiedName "objectName.method"
    const functions = [
      makeFn({
        file: "src/config.ts",
        name: "getValue",
        qualifiedName: "configStore.getValue",
        isExported: true,
      }),
      makeFn({
        file: "src/config.ts",
        name: "setValue",
        qualifiedName: "configStore.setValue",
        isExported: true,
      }),
    ];

    const cg = makeCallGraph(functions, []);
    const inventory = makeInventory(["src/config.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory });

    const configFindings = findings.filter(
      (f) => f.text.includes("src/config.ts") && f.text.includes("unused")
    );
    expect(configFindings).toHaveLength(0);
  });

  it("groups dead exports by file", () => {
    const functions = [
      makeFn({ file: "src/legacy.ts", name: "oldA", isExported: true }),
      makeFn({ file: "src/legacy.ts", name: "oldB", isExported: true }),
      makeFn({ file: "src/legacy.ts", name: "oldC", isExported: true }),
      makeFn({ file: "src/main.ts", name: "main", isExported: true }),
    ];

    const cg = makeCallGraph(functions, []);
    const inventory = makeInventory(["src/legacy.ts", "src/main.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory });

    // Should produce a file-level finding rather than individual per-function findings
    const fileLevelFindings = findings.filter(
      (f) => f.text.includes("src/legacy.ts") && f.text.includes("3")
    );
    expect(fileLevelFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag exports that are re-exported by another file", () => {
    // Simulates: src/schema/v1.ts exports isPriority, isItemLevel
    // src/schema/index.ts re-exports them via `export { isPriority, isItemLevel } from "./v1.js"`
    // Even though no call edges target v1.ts directly, the re-export means they are consumed.
    const functions = [
      makeFn({ file: "src/schema/v1.ts", name: "isPriority", isExported: true }),
      makeFn({ file: "src/schema/v1.ts", name: "isItemLevel", isExported: true }),
      makeFn({ file: "src/schema/v1.ts", name: "isItemStatus", isExported: true }),
      // A genuinely unused export in the same file — should still be flagged
      makeFn({ file: "src/schema/v1.ts", name: "deprecatedHelper", isExported: true }),
      makeFn({ file: "src/consumer.ts", name: "validate", isExported: true }),
    ];

    const importEdges: ImportEdge[] = [
      // schema/index.ts re-exports isPriority and isItemLevel from v1.ts
      { from: "src/schema/index.ts", to: "src/schema/v1.ts", type: "reexport", symbols: ["isPriority", "isItemLevel", "isItemStatus"] },
      // consumer.ts imports isPriority from schema/index.ts
      { from: "src/consumer.ts", to: "src/schema/index.ts", type: "static", symbols: ["isPriority"] },
    ];

    // Call edge: consumer.ts calls isPriority (resolved to schema/index.ts, not v1.ts)
    const edges = [
      makeEdge({
        callerFile: "src/consumer.ts",
        caller: "validate",
        callee: "isPriority",
        calleeFile: "src/schema/index.ts",
      }),
    ];

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/schema/v1.ts", "src/schema/index.ts", "src/consumer.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory, importEdges });

    // Re-exported symbols should NOT be flagged as dead
    const v1Findings = findings.filter(
      (f) => f.text.includes("src/schema/v1.ts") && f.text.includes("unused")
    );
    // Only deprecatedHelper should appear, not the 3 re-exported guards
    expect(v1Findings.length).toBe(1);
    expect(v1Findings[0].text).toContain("deprecatedHelper");
    expect(v1Findings[0].text).not.toContain("isPriority");
    expect(v1Findings[0].text).not.toContain("isItemLevel");
    expect(v1Findings[0].text).not.toContain("isItemStatus");
  });

  it("does not flag exports re-exported through a chain of barrel files", () => {
    // Simulates: v1.ts → schema/index.ts → public.ts (multi-hop re-export chain)
    const functions = [
      makeFn({ file: "src/schema/v1.ts", name: "isPriority", isExported: true }),
    ];

    const importEdges: ImportEdge[] = [
      { from: "src/schema/index.ts", to: "src/schema/v1.ts", type: "reexport", symbols: ["isPriority"] },
      { from: "src/public.ts", to: "src/schema/index.ts", type: "reexport", symbols: ["isPriority"] },
    ];

    const cg = makeCallGraph(functions, []);
    const inventory = makeInventory(["src/schema/v1.ts", "src/schema/index.ts", "src/public.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory, importEdges });

    const v1Findings = findings.filter(
      (f) => f.text.includes("src/schema/v1.ts") && f.text.includes("unused")
    );
    expect(v1Findings).toHaveLength(0);
  });

  it("still flags exports not covered by any re-export", () => {
    const functions = [
      makeFn({ file: "src/utils.ts", name: "usedViaReexport", isExported: true }),
      makeFn({ file: "src/utils.ts", name: "trulyUnused", isExported: true }),
    ];

    const importEdges: ImportEdge[] = [
      { from: "src/index.ts", to: "src/utils.ts", type: "reexport", symbols: ["usedViaReexport"] },
    ];

    const cg = makeCallGraph(functions, []);
    const inventory = makeInventory(["src/utils.ts", "src/index.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory, importEdges });

    const utilFindings = findings.filter(
      (f) => f.text.includes("src/utils.ts") && f.text.includes("unused")
    );
    expect(utilFindings.length).toBe(1);
    expect(utilFindings[0].text).toContain("trulyUnused");
    expect(utilFindings[0].text).not.toContain("usedViaReexport");
  });
});

// ── Refactoring suggestions ─────────────────────────────────────────────

describe("refactoring suggestions", () => {
  it("suggests splitting hub functions called by many files", () => {
    const functions = [
      makeFn({ file: "src/shared.ts", name: "doEverything", isExported: true }),
    ];
    const edges: CallEdge[] = [];

    // Called from 8 different files
    for (let i = 0; i < 8; i++) {
      const callerFile = `src/consumer${i}.ts`;
      functions.push(makeFn({ file: callerFile, name: `use${i}` }));
      edges.push(makeEdge({
        callerFile,
        caller: `use${i}`,
        callee: "doEverything",
        calleeFile: "src/shared.ts",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const hubFindings = findings.filter(
      (f) => f.text.includes("doEverything") && f.text.includes("files")
    );
    expect(hubFindings.length).toBeGreaterThanOrEqual(1);
    expect(hubFindings[0].type).toBe("suggestion");
  });

  it("identifies fan-in hotspot files", () => {
    const functions: FunctionNode[] = [];
    const edges: CallEdge[] = [];

    // Multiple functions in the hotspot file, all called from various files
    for (let fn = 0; fn < 5; fn++) {
      functions.push(makeFn({
        file: "src/hotspot.ts",
        name: `api${fn}`,
        isExported: true,
      }));
    }

    for (let caller = 0; caller < 6; caller++) {
      const callerFile = `src/caller${caller}.ts`;
      functions.push(makeFn({ file: callerFile, name: `invoke${caller}` }));
      // Each caller calls 2 functions from the hotspot
      edges.push(makeEdge({
        callerFile,
        caller: `invoke${caller}`,
        callee: `api${caller % 5}`,
        calleeFile: "src/hotspot.ts",
      }));
      edges.push(makeEdge({
        callerFile,
        caller: `invoke${caller}`,
        callee: `api${(caller + 1) % 5}`,
        calleeFile: "src/hotspot.ts",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const hotspotFindings = findings.filter(
      (f) => f.text.includes("src/hotspot.ts")
    );
    expect(hotspotFindings.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Findings structure ──────────────────────────────────────────────────

describe("finding structure", () => {
  it("produces findings with correct pass number (0 = deterministic)", () => {
    const fn = makeFn({ file: "src/main.ts", name: "god" });
    const functions = [fn];
    const edges: CallEdge[] = [];
    for (let i = 0; i < 15; i++) {
      functions.push(makeFn({ file: "src/h.ts", name: `h${i}` }));
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "god",
        callee: `h${i}`,
        calleeFile: "src/h.ts",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.pass).toBe(0);
    }
  });

  it("uses 'global' scope for cross-module findings", () => {
    const functions = [
      makeFn({ file: "src/a.ts", name: "a1" }),
      makeFn({ file: "src/a.ts", name: "a2" }),
      makeFn({ file: "src/b.ts", name: "b1" }),
      makeFn({ file: "src/b.ts", name: "b2" }),
    ];
    const edges: CallEdge[] = [];
    // Dense bidirectional coupling
    for (const caller of ["a1", "a2"]) {
      for (const callee of ["b1", "b2"]) {
        edges.push(makeEdge({ callerFile: "src/a.ts", caller, callee, calleeFile: "src/b.ts" }));
      }
    }
    for (const caller of ["b1", "b2"]) {
      for (const callee of ["a1", "a2"]) {
        edges.push(makeEdge({ callerFile: "src/b.ts", caller, callee, calleeFile: "src/a.ts" }));
      }
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const crossModuleFindings = findings.filter(
      (f) => f.type === "relationship"
    );
    for (const f of crossModuleFindings) {
      expect(f.scope).toBe("global");
    }
  });

  it("includes related files in findings", () => {
    const fn = makeFn({ file: "src/main.ts", name: "orchestrate" });
    const functions = [fn];
    const edges: CallEdge[] = [];
    for (let i = 0; i < 15; i++) {
      functions.push(makeFn({ file: "src/helpers.ts", name: `h${i}` }));
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "orchestrate",
        callee: `h${i}`,
        calleeFile: "src/helpers.ts",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const godFinding = findings.find((f) => f.text.includes("orchestrate"));
    expect(godFinding).toBeDefined();
    expect(godFinding!.related).toBeDefined();
    expect(godFinding!.related!.length).toBeGreaterThan(0);
    expect(godFinding!.related).toContain("src/main.ts");
  });

  it("returns empty array for small call graphs", () => {
    const cg = makeCallGraph(
      [makeFn({ file: "src/a.ts", name: "a" })],
      []
    );
    const findings = generateCallGraphFindings(cg);
    expect(findings).toEqual([]);
  });
});
