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

function makeInventory(files: string[], testFiles: string[] = []): Inventory {
  const allFiles = [
    ...files.map((path) => ({
      path,
      language: "TypeScript" as const,
      role: "source" as const,
      category: "code" as const,
      size: 100,
      hash: "abc123",
    })),
    ...testFiles.map((path) => ({
      path,
      language: "TypeScript" as const,
      role: "test" as const,
      category: "code" as const,
      size: 100,
      hash: "abc123",
    })),
  ];
  return {
    files: allFiles,
    summary: {
      totalFiles: allFiles.length,
      totalSize: allFiles.length * 100,
      languages: { TypeScript: allFiles.length },
      roles: { source: files.length, ...(testFiles.length > 0 ? { test: testFiles.length } : {}) },
    },
  };
}

// ── God functions (excessive outgoing calls) ──────────────────────────────

describe("god functions", () => {
  it("identifies functions with excessive outgoing calls", () => {
    const godFn = makeFn({ file: "src/main.ts", name: "orchestrate" });
    const functions = [godFn];
    const edges: CallEdge[] = [];

    // 35 unique callees — above the threshold of 30
    for (let i = 0; i < 35; i++) {
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
    expect(godFindings[0].text).toMatch(/35/);
  });

  it("does not flag god functions in test files", () => {
    // Test files naturally call many functions — they exercise the API under test.
    const testFile = "tests/unit/reason.test.ts";
    const fn = makeFn({ file: testFile, name: "<module>" });
    const functions = [fn];
    const edges: CallEdge[] = [];

    // 65 unique callees — well above critical threshold
    for (let i = 0; i < 65; i++) {
      functions.push(makeFn({ file: "src/reason.ts", name: `helper${i}` }));
      edges.push(makeEdge({
        callerFile: testFile,
        caller: "<module>",
        callee: `helper${i}`,
        calleeFile: "src/reason.ts",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/reason.ts"], [testFile]);
    const findings = generateCallGraphFindings(cg, { inventory });

    const godFindings = findings.filter((f) => f.text.includes("God function"));
    expect(godFindings).toHaveLength(0);
  });

  it("still flags god functions in source files when inventory provided", () => {
    const godFn = makeFn({ file: "src/main.ts", name: "orchestrate" });
    const functions = [godFn];
    const edges: CallEdge[] = [];

    for (let i = 0; i < 35; i++) {
      functions.push(makeFn({ file: "src/helpers.ts", name: `helper${i}` }));
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "orchestrate",
        callee: `helper${i}`,
        calleeFile: "src/helpers.ts",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/main.ts", "src/helpers.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory });

    const godFindings = findings.filter((f) => f.text.includes("orchestrate"));
    expect(godFindings.length).toBeGreaterThanOrEqual(1);
    expect(godFindings[0].type).toBe("anti-pattern");
  });

  it("excludes built-in method calls from unique callee count", () => {
    // A function that calls 15 user-defined functions + 50 built-in methods
    // should NOT be flagged (15 < threshold of 30), even though total is 65.
    const fn = makeFn({ file: "src/view.ts", name: "CallGraphView" });
    const functions = [fn];
    const edges: CallEdge[] = [];

    // 15 user-defined calls (direct)
    for (let i = 0; i < 15; i++) {
      functions.push(makeFn({ file: "src/helpers.ts", name: `helper${i}` }));
      edges.push(makeEdge({
        callerFile: "src/view.ts",
        caller: "CallGraphView",
        callee: `helper${i}`,
        calleeFile: "src/helpers.ts",
        type: "direct",
      }));
    }

    // 50 built-in method calls
    const builtins = ["map", "filter", "forEach", "reduce", "find", "includes",
      "split", "join", "has", "set", "get", "delete", "push", "pop", "shift",
      "slice", "splice", "concat", "indexOf", "toString", "toFixed", "keys",
      "values", "entries", "sort", "reverse", "fill", "flat", "flatMap",
      "some", "every", "findIndex", "startsWith", "endsWith", "trim",
      "replace", "match", "search", "padStart", "padEnd", "charAt",
      "charCodeAt", "substring", "toLowerCase", "toUpperCase", "repeat",
      "normalize", "localeCompare", "trimStart", "trimEnd"];
    for (const name of builtins.slice(0, 50)) {
      edges.push(makeEdge({
        callerFile: "src/view.ts",
        caller: "CallGraphView",
        callee: name,
        calleeFile: null,
        type: "method",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const godFindings = findings.filter((f) => f.text.includes("God function") && f.text.includes("CallGraphView"));
    expect(godFindings).toHaveLength(0);
  });

  it("flags function with many user-defined calls even when built-ins are excluded", () => {
    // A function that calls 35 user-defined functions should be flagged
    // regardless of whether it also calls built-in methods.
    const fn = makeFn({ file: "src/main.ts", name: "doEverything" });
    const functions = [fn];
    const edges: CallEdge[] = [];

    // 35 user-defined calls (direct)
    for (let i = 0; i < 35; i++) {
      functions.push(makeFn({ file: "src/helpers.ts", name: `helper${i}` }));
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "doEverything",
        callee: `helper${i}`,
        calleeFile: "src/helpers.ts",
        type: "direct",
      }));
    }

    // Also add some built-in method calls (should be ignored)
    for (const name of ["map", "filter", "forEach", "reduce", "find"]) {
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "doEverything",
        callee: name,
        calleeFile: null,
        type: "method",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const godFindings = findings.filter((f) => f.text.includes("God function") && f.text.includes("doEverything"));
    expect(godFindings.length).toBeGreaterThanOrEqual(1);
    // Should report 35, not 40 (built-ins excluded)
    expect(godFindings[0].text).toMatch(/35/);
  });

  it("counts direct calls to functions named like built-ins", () => {
    // A user-defined function named "filter" called directly should still count.
    const fn = makeFn({ file: "src/main.ts", name: "process" });
    const functions = [fn];
    const edges: CallEdge[] = [];

    // 30 user-defined direct calls
    for (let i = 0; i < 30; i++) {
      functions.push(makeFn({ file: "src/helpers.ts", name: `helper${i}` }));
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "process",
        callee: `helper${i}`,
        calleeFile: "src/helpers.ts",
        type: "direct",
      }));
    }

    // Direct call to a user-defined function named "filter" — should count (pushes over threshold)
    functions.push(makeFn({ file: "src/helpers.ts", name: "filter" }));
    edges.push(makeEdge({
      callerFile: "src/main.ts",
      caller: "process",
      callee: "filter",
      calleeFile: "src/helpers.ts",
      type: "direct",
    }));

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const godFindings = findings.filter((f) => f.text.includes("God function") && f.text.includes("process"));
    expect(godFindings.length).toBeGreaterThanOrEqual(1);
    expect(godFindings[0].text).toMatch(/31/);
  });

  it("handles threshold boundary — exactly at threshold is not flagged", () => {
    const fn = makeFn({ file: "src/main.ts", name: "borderline" });
    const functions = [fn];
    const edges: CallEdge[] = [];

    // Exactly 30 user-defined calls — at the threshold (> 30 needed to flag)
    for (let i = 0; i < 30; i++) {
      functions.push(makeFn({ file: "src/helpers.ts", name: `helper${i}` }));
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "borderline",
        callee: `helper${i}`,
        calleeFile: "src/helpers.ts",
        type: "direct",
      }));
    }

    // Add built-in methods that would push over threshold if counted
    for (const name of ["map", "filter", "forEach", "reduce", "find"]) {
      edges.push(makeEdge({
        callerFile: "src/main.ts",
        caller: "borderline",
        callee: name,
        calleeFile: null,
        type: "method",
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const godFindings = findings.filter((f) => f.text.includes("God function") && f.text.includes("borderline"));
    expect(godFindings).toHaveLength(0);
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
    const functions: FunctionNode[] = [];
    const edges: CallEdge[] = [];

    // Create enough functions and calls to exceed the threshold of 30
    for (let i = 0; i < 10; i++) {
      functions.push(makeFn({ file: "src/a.ts", name: `a${i}` }));
      functions.push(makeFn({ file: "src/b.ts", name: `b${i}` }));
    }

    // a→b: 20 calls
    for (let i = 0; i < 10; i++) {
      for (const callee of [`b${i}`, `b${(i + 1) % 10}`]) {
        edges.push(makeEdge({
          callerFile: "src/a.ts",
          caller: `a${i}`,
          callee,
          calleeFile: "src/b.ts",
        }));
      }
    }
    // b→a: 15 calls (bidirectional)
    for (let i = 0; i < 5; i++) {
      for (const callee of [`a${i}`, `a${i + 5}`, `a${(i + 3) % 10}`]) {
        edges.push(makeEdge({
          callerFile: "src/b.ts",
          caller: `b${i}`,
          callee,
          calleeFile: "src/a.ts",
        }));
      }
    }

    // Total: 35 cross-file calls — above threshold of 30
    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const couplingFindings = findings.filter(
      (f) => f.text.includes("src/a.ts") && f.text.includes("src/b.ts")
    );
    expect(couplingFindings.length).toBeGreaterThanOrEqual(1);
    expect(couplingFindings[0].severity).toBe("warning");
    expect(couplingFindings[0].type).toBe("relationship");
  });

  it("does not flag test-to-source coupling as tight coupling", () => {
    // Test files are naturally tightly coupled to their subjects.
    const testFile = "tests/unit/chunked-review.test.ts";
    const sourceFile = "src/chunked-review-state.ts";
    const functions = [
      makeFn({ file: sourceFile, name: "getState" }),
      makeFn({ file: sourceFile, name: "setState" }),
      makeFn({ file: sourceFile, name: "resetState" }),
      makeFn({ file: testFile, name: "test1" }),
      makeFn({ file: testFile, name: "test2" }),
    ];

    const edges: CallEdge[] = [];
    // 50 calls from test to source — well above critical threshold
    for (let i = 0; i < 50; i++) {
      edges.push(makeEdge({
        callerFile: testFile,
        caller: i % 2 === 0 ? "test1" : "test2",
        callee: ["getState", "setState", "resetState"][i % 3],
        calleeFile: sourceFile,
      }));
    }

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory([sourceFile], [testFile]);
    const findings = generateCallGraphFindings(cg, { inventory });

    const couplingFindings = findings.filter(
      (f) => f.type === "relationship" && f.text.includes("Tightly coupled")
    );
    expect(couplingFindings).toHaveLength(0);
  });

  it("still flags tight coupling between source files when inventory provided", () => {
    const functions: FunctionNode[] = [];
    const edges: CallEdge[] = [];

    // Create enough functions and calls to exceed the threshold of 30
    for (let i = 0; i < 10; i++) {
      functions.push(makeFn({ file: "src/a.ts", name: `a${i}` }));
      functions.push(makeFn({ file: "src/b.ts", name: `b${i}` }));
    }

    // a→b: 20 calls
    for (let i = 0; i < 10; i++) {
      for (const callee of [`b${i}`, `b${(i + 1) % 10}`]) {
        edges.push(makeEdge({
          callerFile: "src/a.ts",
          caller: `a${i}`,
          callee,
          calleeFile: "src/b.ts",
        }));
      }
    }
    // b→a: 15 calls
    for (let i = 0; i < 5; i++) {
      for (const callee of [`a${i}`, `a${i + 5}`, `a${(i + 3) % 10}`]) {
        edges.push(makeEdge({
          callerFile: "src/b.ts",
          caller: `b${i}`,
          callee,
          calleeFile: "src/a.ts",
        }));
      }
    }

    // Total: 35 cross-file calls — above threshold of 30
    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/a.ts", "src/b.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory });

    const couplingFindings = findings.filter(
      (f) => f.text.includes("src/a.ts") && f.text.includes("src/b.ts")
    );
    expect(couplingFindings.length).toBeGreaterThanOrEqual(1);
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

  it("does not flag exports consumed via dynamic import edges", () => {
    // Simulates: CLI router does `const { cmdConfig } = await import("./config.js")`
    // The call graph has no CallExpression edge for cmdConfig, but the import graph does.
    const functions = [
      makeFn({ file: "src/config.ts", name: "cmdConfig", isExported: true }),
      makeFn({ file: "src/router.ts", name: "dispatch", isExported: true }),
    ];

    // No call edges — cmdConfig is accessed via dynamic import, not called directly
    const edges: CallEdge[] = [];

    const importEdges: ImportEdge[] = [
      { from: "src/router.ts", to: "src/config.ts", type: "dynamic", symbols: ["cmdConfig"] },
    ];

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/config.ts", "src/router.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory, importEdges });

    const configFindings = findings.filter(
      (f) => f.text.includes("cmdConfig") && f.text.includes("unused"),
    );
    expect(configFindings).toHaveLength(0);
  });

  it("does not flag exports consumed via static import without call edges", () => {
    // Simulates: JSX component or validator imported but no CallExpression in call graph
    // e.g., `import { HealthGauge } from "./health-gauge"` used as `<HealthGauge />`
    const functions = [
      makeFn({ file: "src/health-gauge.ts", name: "HealthGauge", isExported: true }),
      makeFn({ file: "src/health-gauge.ts", name: "formatHealth", isExported: true }),
      makeFn({ file: "src/dashboard.ts", name: "Dashboard", isExported: true }),
    ];

    // No call edges for HealthGauge — JSX doesn't produce CallExpression nodes
    const edges: CallEdge[] = [];

    const importEdges: ImportEdge[] = [
      { from: "src/dashboard.ts", to: "src/health-gauge.ts", type: "static", symbols: ["HealthGauge"] },
    ];

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/health-gauge.ts", "src/dashboard.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory, importEdges });

    // HealthGauge (imported) should NOT be flagged
    const gaugeFindings = findings.filter((f) => f.text.includes("HealthGauge"));
    expect(gaugeFindings).toHaveLength(0);

    // formatHealth (not imported, no call edge) should still be flagged
    const formatFindings = findings.filter((f) => f.text.includes("formatHealth"));
    expect(formatFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag exports consumed via require import edges", () => {
    // Simulates: CommonJS require usage `const { validate } = require("./validators")`
    const functions = [
      makeFn({ file: "src/validators.ts", name: "validate", isExported: true }),
      makeFn({ file: "src/validators.ts", name: "unusedValidator", isExported: true }),
      makeFn({ file: "src/handler.ts", name: "handle", isExported: true }),
    ];

    const edges: CallEdge[] = [];

    const importEdges: ImportEdge[] = [
      { from: "src/handler.ts", to: "src/validators.ts", type: "require", symbols: ["validate"] },
    ];

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/validators.ts", "src/handler.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory, importEdges });

    // validate (required) should NOT be flagged
    const validateFindings = findings.filter((f) => f.text.includes("validate") && f.text.includes("unused"));
    expect(validateFindings).toHaveLength(0);

    // unusedValidator should still be flagged
    const unusedFindings = findings.filter((f) => f.text.includes("unusedValidator"));
    expect(unusedFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag exports consumed by type imports (type imports are excluded)", () => {
    // Type imports are erased at compile time and handled separately —
    // they should NOT prevent dead export detection.
    const functions = [
      makeFn({ file: "src/types.ts", name: "createConfig", isExported: true }),
    ];

    const edges: CallEdge[] = [];

    const importEdges: ImportEdge[] = [
      // Only a type import edge — not a real runtime usage
      { from: "src/consumer.ts", to: "src/types.ts", type: "type", symbols: ["createConfig"] },
    ];

    const cg = makeCallGraph(functions, edges);
    const inventory = makeInventory(["src/types.ts", "src/consumer.ts"]);
    const findings = generateCallGraphFindings(cg, { inventory, importEdges });

    // createConfig should still be flagged — type imports don't count as usage
    const findings2 = findings.filter((f) => f.text.includes("createConfig"));
    expect(findings2.length).toBeGreaterThanOrEqual(1);
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
    // 35 callees — above the threshold of 30
    for (let i = 0; i < 35; i++) {
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
    const functions: FunctionNode[] = [];
    const edges: CallEdge[] = [];

    // Create enough functions and calls to exceed the coupling threshold of 30
    for (let i = 0; i < 10; i++) {
      functions.push(makeFn({ file: "src/a.ts", name: `a${i}` }));
      functions.push(makeFn({ file: "src/b.ts", name: `b${i}` }));
    }
    // Dense bidirectional coupling: 20 a→b + 15 b→a = 35 total
    for (let i = 0; i < 10; i++) {
      edges.push(makeEdge({ callerFile: "src/a.ts", caller: `a${i}`, callee: `b${i}`, calleeFile: "src/b.ts" }));
      edges.push(makeEdge({ callerFile: "src/a.ts", caller: `a${i}`, callee: `b${(i + 1) % 10}`, calleeFile: "src/b.ts" }));
    }
    for (let i = 0; i < 5; i++) {
      for (const callee of [`a${i}`, `a${i + 5}`, `a${(i + 3) % 10}`]) {
        edges.push(makeEdge({ callerFile: "src/b.ts", caller: `b${i}`, callee, calleeFile: "src/a.ts" }));
      }
    }

    const cg = makeCallGraph(functions, edges);
    const findings = generateCallGraphFindings(cg);

    const crossModuleFindings = findings.filter(
      (f) => f.type === "relationship"
    );
    expect(crossModuleFindings.length).toBeGreaterThan(0);
    for (const f of crossModuleFindings) {
      expect(f.scope).toBe("global");
    }
  });

  it("includes related files in findings", () => {
    const fn = makeFn({ file: "src/main.ts", name: "orchestrate" });
    const functions = [fn];
    const edges: CallEdge[] = [];
    // 35 callees — above the threshold of 30
    for (let i = 0; i < 35; i++) {
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
