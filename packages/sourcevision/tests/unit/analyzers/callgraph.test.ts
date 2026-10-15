import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractFunctions,
  extractCalls,
  analyzeCallGraph,
} from "../../../src/analyzers/callgraph.js";
import { analyzeInventory } from "../../../src/analyzers/inventory.js";
import { analyzeImports } from "../../../src/analyzers/imports.js";
import type { InventoryResult } from "../../../src/analyzers/inventory.js";

// ── extractFunctions ─────────────────────────────────────────────────────────

describe("extractFunctions", () => {
  it("detects named function declarations", () => {
    const result = extractFunctions(
      `function greet(name: string) { return "hi " + name; }`,
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("greet");
    expect(result[0].qualifiedName).toBe("greet");
    expect(result[0].line).toBe(1);
    expect(result[0].isExported).toBe(false);
  });

  it("detects exported function declarations", () => {
    const result = extractFunctions(
      `export function greet() { return "hi"; }`,
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("greet");
    expect(result[0].isExported).toBe(true);
  });

  it("detects arrow functions assigned to variables", () => {
    const result = extractFunctions(
      `const greet = (name: string) => "hi " + name;`,
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("greet");
    expect(result[0].qualifiedName).toBe("greet");
  });

  it("detects exported arrow functions", () => {
    const result = extractFunctions(
      `export const greet = () => "hi";`,
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("greet");
    expect(result[0].isExported).toBe(true);
  });

  it("detects class methods", () => {
    const result = extractFunctions(
      `class Greeter {
        greet() { return "hi"; }
        static factory() { return new Greeter(); }
      }`,
      "test.ts"
    );
    // class methods
    const methods = result.filter((f) => f.qualifiedName.startsWith("Greeter."));
    expect(methods).toHaveLength(2);
    expect(methods.map((m) => m.qualifiedName).sort()).toEqual([
      "Greeter.factory",
      "Greeter.greet",
    ]);
  });

  it("detects object literal methods", () => {
    const result = extractFunctions(
      `const utils = {
        helper() { return 1; },
        compute: function() { return 2; },
      };`,
      "test.ts"
    );
    const methods = result.filter((f) => f.qualifiedName.startsWith("utils."));
    expect(methods).toHaveLength(2);
    expect(methods.map((m) => m.qualifiedName).sort()).toEqual([
      "utils.compute",
      "utils.helper",
    ]);
  });

  it("detects function expressions assigned to variables", () => {
    const result = extractFunctions(
      `const greet = function hello() { return "hi"; };`,
      "test.ts"
    );
    // Named function expression — uses the variable name
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("greet");
  });

  it("handles multiple functions in one file", () => {
    const result = extractFunctions(
      `function a() {}
       function b() {}
       const c = () => {};`,
      "test.ts"
    );
    expect(result).toHaveLength(3);
    expect(result.map((f) => f.name).sort()).toEqual(["a", "b", "c"]);
  });

  it("includes file path on all nodes", () => {
    const result = extractFunctions(
      `function test() {}`,
      "src/utils.ts"
    );
    expect(result[0].file).toBe("src/utils.ts");
  });
});

// ── extractCalls ─────────────────────────────────────────────────────────────

describe("extractCalls", () => {
  it("detects direct function calls", () => {
    const source = `
      function caller() {
        greet("world");
      }
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls).toHaveLength(1);
    expect(calls[0].caller).toBe("caller");
    expect(calls[0].callee).toBe("greet");
    expect(calls[0].type).toBe("direct");
  });

  it("detects method invocations on objects", () => {
    const source = `
      function caller() {
        obj.method();
      }
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls).toHaveLength(1);
    expect(calls[0].callee).toBe("obj.method");
    expect(calls[0].type).toBe("method");
  });

  it("handles property access chains", () => {
    const source = `
      function caller() {
        a.b.c();
      }
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls).toHaveLength(1);
    expect(calls[0].callee).toBe("a.b.c");
    expect(calls[0].type).toBe("property-chain");
  });

  it("detects calls from destructured imports", () => {
    const source = `
      import { readFile } from "node:fs/promises";
      function loader() {
        readFile("path");
      }
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls).toHaveLength(1);
    expect(calls[0].callee).toBe("readFile");
    expect(calls[0].type).toBe("direct");
  });

  it("detects multiple calls in one function", () => {
    const source = `
      function orchestrate() {
        prepare();
        execute();
        cleanup();
      }
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.callee).sort()).toEqual(["cleanup", "execute", "prepare"]);
    expect(calls.every((c) => c.caller === "orchestrate")).toBe(true);
  });

  it("detects calls inside arrow functions", () => {
    const source = `
      const process = () => {
        transform();
      };
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls).toHaveLength(1);
    expect(calls[0].caller).toBe("process");
    expect(calls[0].callee).toBe("transform");
  });

  it("detects calls inside class methods", () => {
    const source = `
      class Service {
        run() {
          this.prepare();
          execute();
        }
        prepare() {}
      }
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    // this.prepare() and execute()
    const runCalls = calls.filter((c) => c.caller === "Service.run");
    expect(runCalls).toHaveLength(2);
    expect(runCalls.map((c) => c.callee).sort()).toEqual(["execute", "this.prepare"]);
  });

  it("detects computed property calls as computed type", () => {
    const source = `
      function caller() {
        obj[method]();
      }
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("computed");
  });

  it("includes source location for calls", () => {
    const source = `function caller() {
  greet();
}`;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls[0].line).toBe(2);
    expect(calls[0].column).toBeGreaterThanOrEqual(0);
  });

  it("returns raw calls without callerFile (set by analyzeCallGraph)", () => {
    // extractCalls returns RawCall without callerFile — callerFile is set during
    // analyzeCallGraph when building CallEdge objects.
    const source = `function a() { b(); }`;
    const fns = extractFunctions(source, "src/lib.ts");
    const calls = extractCalls(source, "src/lib.ts", fns);
    expect(calls).toHaveLength(1);
    expect(calls[0].caller).toBe("a");
    expect(calls[0].callee).toBe("b");
  });

  it("handles calls at module level (top-level calls)", () => {
    const source = `
      import { setup } from "./setup";
      setup();
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls).toHaveLength(1);
    expect(calls[0].caller).toBe("<module>");
    expect(calls[0].callee).toBe("setup");
  });

  it("handles nested function calls (call as argument)", () => {
    const source = `
      function caller() {
        outer(inner());
      }
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.callee).sort()).toEqual(["inner", "outer"]);
  });

  it("handles chained calls like a().b()", () => {
    const source = `
      function caller() {
        createBuilder().build();
      }
    `;
    const fns = extractFunctions(source, "test.ts");
    const calls = extractCalls(source, "test.ts", fns);
    // createBuilder() is direct, createBuilder().build() is method on return value
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.some((c) => c.callee === "createBuilder")).toBe(true);
  });
});

// ── analyzeCallGraph integration ────────────────────────────────────────────

describe("analyzeCallGraph", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("analyzes call graph across multiple files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-cg-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "main.ts"),
      `import { process } from "./processor.js";
export function main() {
  process("data");
}
`
    );
    await writeFile(
      join(tmpDir, "src", "processor.ts"),
      `import { validate } from "./validator.js";
export function process(data: string) {
  validate(data);
  return data.toUpperCase();
}
`
    );
    await writeFile(
      join(tmpDir, "src", "validator.ts"),
      `export function validate(data: string) {
  if (!data) throw new Error("invalid");
}
`
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);
    const callGraph = await analyzeCallGraph(tmpDir, inventory, imports);

    // Should find functions in all three files
    expect(callGraph.functions.length).toBeGreaterThanOrEqual(3);
    expect(callGraph.functions.some((f) => f.name === "main")).toBe(true);
    expect(callGraph.functions.some((f) => f.name === "process")).toBe(true);
    expect(callGraph.functions.some((f) => f.name === "validate")).toBe(true);

    // Should find call edges
    expect(callGraph.edges.length).toBeGreaterThanOrEqual(2);

    // main→process call
    const mainToProcess = callGraph.edges.find(
      (e) => e.caller === "main" && e.callee === "process"
    );
    expect(mainToProcess).toBeDefined();
    expect(mainToProcess!.callerFile).toBe("src/main.ts");

    // process→validate call
    const processToValidate = callGraph.edges.find(
      (e) => e.caller === "process" && e.callee === "validate"
    );
    expect(processToValidate).toBeDefined();

    // Summary should be populated
    expect(callGraph.summary.totalFunctions).toBeGreaterThanOrEqual(3);
    expect(callGraph.summary.totalCalls).toBeGreaterThanOrEqual(2);
    expect(callGraph.summary.filesWithCalls).toBeGreaterThanOrEqual(2);
  });

  it("resolves cross-file calls via import map", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-cg-resolve-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import { helper } from "./b.js";
export function run() {
  helper();
}
`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `export function helper() { return 42; }
`
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);
    const callGraph = await analyzeCallGraph(tmpDir, inventory, imports);

    // The call to helper() should be resolved with calleeFile
    const edge = callGraph.edges.find(
      (e) => e.caller === "run" && e.callee === "helper"
    );
    expect(edge).toBeDefined();
    expect(edge!.calleeFile).toBe("src/b.ts");
  });

  it("handles cyclic call relationships without infinite loops", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-cg-cycle-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import { b } from "./b.js";
export function a() { b(); }
`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { a } from "./a.js";
export function b() { a(); }
`
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);
    const callGraph = await analyzeCallGraph(tmpDir, inventory, imports);

    // Should complete without infinite loop
    expect(callGraph.edges.length).toBeGreaterThanOrEqual(2);
    expect(callGraph.summary.cycleCount).toBeGreaterThanOrEqual(1);
  });

  it("computes mostCalled and mostCalling rankings", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-cg-rank-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "shared.ts"),
      `export function shared() { return 1; }
`
    );
    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import { shared } from "./shared.js";
export function a() { shared(); }
`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { shared } from "./shared.js";
export function b() { shared(); }
`
    );
    await writeFile(
      join(tmpDir, "src", "c.ts"),
      `import { shared } from "./shared.js";
export function c() { shared(); }
`
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);
    const callGraph = await analyzeCallGraph(tmpDir, inventory, imports);

    // shared() should be mostCalled (called by a, b, c)
    expect(callGraph.summary.mostCalled.length).toBeGreaterThanOrEqual(1);
    expect(callGraph.summary.mostCalled[0].qualifiedName).toBe("shared");
    expect(callGraph.summary.mostCalled[0].callerCount).toBe(3);
  });

  it("supports incremental analysis", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-cg-inc-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `export function a() { }
`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { a } from "./a.js";
export function b() { a(); }
`
    );

    const inv1 = await analyzeInventory(tmpDir) as InventoryResult;
    const imp1 = await analyzeImports(tmpDir, inv1);
    const cg1 = await analyzeCallGraph(tmpDir, inv1, imp1);

    // Modify a.ts — add a new function
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `export function a() { }
export function a2() { }
`
    );

    const inv2 = await analyzeInventory(tmpDir, { previousInventory: inv1 }) as InventoryResult;
    const imp2 = await analyzeImports(tmpDir, inv2, {
      previousImports: imp1,
      changedFiles: inv2.changedFiles,
      fileSetChanged: false,
    });

    const incremental = await analyzeCallGraph(tmpDir, inv2, imp2, {
      previousCallGraph: cg1,
      changedFiles: inv2.changedFiles,
      fileSetChanged: false,
    });

    const full = await analyzeCallGraph(tmpDir, inv2, imp2);

    // Incremental should match full
    expect(incremental.functions).toEqual(full.functions);
    expect(incremental.edges).toEqual(full.edges);
    expect(incremental.summary).toEqual(full.summary);
  });
});

describe("analyzeCallGraph incremental carry-over (#744)", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("drops functions and edges from files no longer in the inventory", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-cg-pruned-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await mkdir(join(tmpDir, "legacy"), { recursive: true });
    await writeFile(join(tmpDir, "legacy", "lib.ts"), `export function helper() { inner(); }\nfunction inner() { }\n`);
    await writeFile(join(tmpDir, "src", "app.ts"), `import { helper } from "../legacy/lib.js";\nexport function run() { helper(); }\n`);

    const inv1 = await analyzeInventory(tmpDir) as InventoryResult;
    const imp1 = await analyzeImports(tmpDir, inv1);
    const cg1 = await analyzeCallGraph(tmpDir, inv1, imp1);
    expect(cg1.functions.some((f) => f.file === "legacy/lib.ts")).toBe(true);

    // The inventory was pruned in an earlier run (.sourcevisionignore), so this
    // run sees no adds or deletes against the previous inventory.
    const inv2 = { ...inv1, files: inv1.files.filter((f) => !f.path.startsWith("legacy/")) };
    const imp2 = await analyzeImports(tmpDir, inv2);

    const incremental = await analyzeCallGraph(tmpDir, inv2, imp2, {
      previousCallGraph: cg1,
      changedFiles: new Set(),
      fileSetChanged: false,
    });
    const full = await analyzeCallGraph(tmpDir, inv2, imp2);

    expect(incremental.functions.some((f) => f.file === "legacy/lib.ts")).toBe(false);
    expect(incremental.edges.some((e) => e.callerFile === "legacy/lib.ts" || e.calleeFile === "legacy/lib.ts")).toBe(false);
    expect(incremental.functions).toEqual(full.functions);
    expect(incremental.edges).toEqual(full.edges);
    expect(incremental.summary).toEqual(full.summary);
  });
});
