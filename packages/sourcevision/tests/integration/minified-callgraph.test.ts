/**
 * Minified bundles are generated files and stay out of callgraph.json:
 * by name (`*.min.js`) or by a long first line, wherever they sit.
 * `--include-minified` maps them again; inventory always lists them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeCallGraph } from "../../src/analyzers/callgraph.js";
import { analyzeComponents } from "../../src/analyzers/components.js";
import { runCallGraphPhase, runImportsPhase, runInventoryPhase, type AnalyzeContext } from "../../src/cli/commands/analyze-phases.js";
import { cmdInit } from "../../src/cli/commands/init.js";
import { emptyAnalyzeTokenUsage } from "../../src/cli/sourcevision-core.js";
import { resolveSourcevisionPaths } from "../../src/paths.js";
import type { CallGraph } from "../../src/schema/v1.js";

/** One line of minified code, `count` functions each calling the next. */
const minifiedLine = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `function ${prefix}${i}(){return ${prefix}${i + 1}()}`).join(";") + "\n";

const SOURCE = "export function start() {\n  return helper();\n}\nfunction helper() {\n  return 1;\n}\n";

const MINIFIED: Record<string, string> = {
  // ~300 KB served bundle, matched by name (was role asset).
  "public/js/jquery.min.js": minifiedLine("jq", 10_000),
  // Outside public/ and vendor/, matched by name (was role source).
  "js/app.min.js": minifiedLine("app", 200),
  // No `.min` in the name: matched by its long first line.
  "theme/js/plugins.js": minifiedLine("pl", 200),
};

const PLAIN: Record<string, string> = {
  "package.json": "{}",
  "src/app.js": SOURCE,
  // An ordinary served script: role asset, never mapped, not minified.
  "public/js/site.js": "function site() {\n  return 1;\n}\n",
};

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sv-minified-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

const filesOf = (graph: CallGraph) => [...new Set(graph.functions.map((f) => f.file))].sort();

describe("minified bundles and the call graph", () => {
  let project: string | null = null;
  afterEach(() => {
    if (project) rmSync(project, { recursive: true, force: true });
    project = null;
    vi.restoreAllMocks();
  });

  it("inventories minified files as generated and leaves them out of the call graph", async () => {
    project = makeProject({ ...PLAIN, ...MINIFIED });
    const inventory = await analyzeInventory(project);
    const roles = Object.fromEntries(inventory.files.map((f) => [f.path, f.role]));
    expect(roles).toMatchObject({
      "public/js/jquery.min.js": "generated",
      "js/app.min.js": "generated",
      "theme/js/plugins.js": "generated",
      "public/js/site.js": "asset",
      "src/app.js": "source",
    });

    const imports = await analyzeImports(project, inventory);
    const leftOut: number[] = [];
    const graph = await analyzeCallGraph(project, inventory, imports, { onMinifiedLeftOut: (n) => leftOut.push(n) });
    expect(filesOf(graph)).toEqual(["src/app.js"]);
    expect(graph.summary.totalFunctions).toBe(2);
    expect(leftOut).toEqual([3]);

    const included = await analyzeCallGraph(project, inventory, imports, { includeMinified: true });
    expect(filesOf(included)).toEqual(["js/app.min.js", "public/js/jquery.min.js", "src/app.js", "theme/js/plugins.js"]);
  });

  it("leaves out a minified bundle vendored under a test directory, which keeps role test", async () => {
    project = makeProject({
      ...PLAIN,
      "tests/js/jquery.min.js": minifiedLine("tq", 200),
      "tests/js/qunit.js": minifiedLine("qu", 200),
      "tests/app.test.js": "function checks() {\n  return 1;\n}\n",
    });
    const inventory = await analyzeInventory(project);
    expect(inventory.files.find((f) => f.path === "tests/js/jquery.min.js")?.role).toBe("test");
    const imports = await analyzeImports(project, inventory);
    const leftOut: number[] = [];
    const graph = await analyzeCallGraph(project, inventory, imports, { onMinifiedLeftOut: (n) => leftOut.push(n) });
    expect(filesOf(graph)).toEqual(["src/app.js", "tests/app.test.js"]);
    expect(leftOut).toEqual([2]);
    const included = await analyzeCallGraph(project, inventory, imports, { includeMinified: true });
    expect(filesOf(included)).toEqual(["src/app.js", "tests/app.test.js", "tests/js/jquery.min.js", "tests/js/qunit.js"]);
  });

  it("the components phase does not parse generated or asset files", async () => {
    const widget = "export function Widget() {\n  return <div />;\n}\n";
    project = makeProject({
      ...PLAIN,
      "src/Widget.jsx": widget,
      "public/js/Banner.jsx": widget.replace("Widget", "Banner"),
      "src/generated/Panel.jsx": widget.replace("Widget", "Panel"),
    });
    const inventory = await analyzeInventory(project);
    const imports = await analyzeImports(project, inventory);
    const components = await analyzeComponents(project, inventory, imports);
    expect(components.components.map((c) => c.file).sort()).toEqual(["src/Widget.jsx"]);
  });

  it("drops minified functions a previous --include-minified run kept, on an incremental run", async () => {
    project = makeProject({ ...PLAIN, ...MINIFIED });
    const inventory = await analyzeInventory(project);
    const imports = await analyzeImports(project, inventory);
    const previousCallGraph = await analyzeCallGraph(project, inventory, imports, { includeMinified: true });
    const graph = await analyzeCallGraph(project, inventory, imports, {
      previousCallGraph,
      changedFiles: new Set(),
      fileSetChanged: false,
    });
    expect(filesOf(graph)).toEqual(["src/app.js"]);
  });

  it("changes nothing in a repository without minified files", async () => {
    project = makeProject(PLAIN);
    const inventory = await analyzeInventory(project);
    const imports = await analyzeImports(project, inventory);
    const leftOut: number[] = [];
    const graph = await analyzeCallGraph(project, inventory, imports, { onMinifiedLeftOut: (n) => leftOut.push(n) });
    const included = await analyzeCallGraph(project, inventory, imports, { includeMinified: true });
    expect(leftOut).toEqual([]);
    expect(JSON.stringify(included)).toBe(JSON.stringify(graph));
  });

  it("the call graph phase logs how many minified files it left out and maps them under includeMinified", async () => {
    project = makeProject({ ...PLAIN, ...MINIFIED });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    cmdInit(project);
    const ctx: AnalyzeContext = {
      absDir: project,
      svDir: resolveSourcevisionPaths(project).svDir,
      fullMode: true,
      fastMode: true,
      narrate: false,
      wait: false,
      tokenUsage: emptyAnalyzeTokenUsage(),
      inventoryResult: null,
    };
    await runInventoryPhase(ctx);
    await runImportsPhase(ctx);
    await runCallGraphPhase(ctx);
    const read = () => JSON.parse(readFileSync(join(ctx.svDir, "callgraph.json"), "utf-8")) as CallGraph;
    expect(filesOf(read())).toEqual(["src/app.js"]);
    const lines = log.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("3 minified files left out of the call graph (--include-minified maps them)"))).toBe(true);

    await runCallGraphPhase({ ...ctx, includeMinified: true });
    expect(filesOf(read())).toContain("js/app.min.js");
  });
});
