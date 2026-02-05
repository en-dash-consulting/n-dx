import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractImports, extractPackageName, analyzeImports } from "../../../src/analyzers/imports.js";
import { analyzeInventory } from "../../../src/analyzers/inventory.js";
import type { InventoryResult } from "../../../src/analyzers/inventory.js";

// ── extractImports ────────────────────────────────────────────────────────────

describe("extractImports", () => {
  it("detects static imports", () => {
    const result = extractImports(
      'import { foo } from "./bar";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("static");
    expect(result[0].specifier).toBe("./bar");
    expect(result[0].symbols).toContain("foo");
  });

  it("detects type imports", () => {
    const result = extractImports(
      'import type { Foo } from "./types";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("type");
    expect(result[0].symbols).toContain("Foo");
  });

  it("detects dynamic import()", () => {
    const result = extractImports(
      'const m = import("./lazy");',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("dynamic");
    expect(result[0].specifier).toBe("./lazy");
  });

  it("detects require()", () => {
    const result = extractImports(
      'const fs = require("fs");',
      "test.js"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("require");
    expect(result[0].specifier).toBe("fs");
  });

  it("detects export-from", () => {
    const result = extractImports(
      'export { bar } from "./bar";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("reexport");
    expect(result[0].symbols).toContain("bar");
  });

  it("detects namespace import", () => {
    const result = extractImports(
      'import * as utils from "./utils";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("static");
    expect(result[0].symbols).toContain("*");
  });

  it("detects side-effect import", () => {
    const result = extractImports(
      'import "./polyfill";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("static");
    expect(result[0].symbols).toEqual(["*"]);
  });

  it("handles multiple imports in one file", () => {
    const source = `
      import { a } from "./a";
      import type { B } from "./b";
      export { c } from "./c";
    `;
    const result = extractImports(source, "test.ts");
    expect(result).toHaveLength(3);
  });
});

// ── extractPackageName ────────────────────────────────────────────────────────

describe("extractPackageName", () => {
  it("returns plain package name", () => {
    expect(extractPackageName("lodash")).toBe("lodash");
  });

  it("strips subpath from scoped package", () => {
    expect(extractPackageName("@scope/pkg/sub")).toBe("@scope/pkg");
  });

  it("strips subpath from unscoped package", () => {
    expect(extractPackageName("react/jsx-runtime")).toBe("react");
  });
});

// ── analyzeImports integration ────────────────────────────────────────────────

describe("analyzeImports", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("analyzes imports across multiple TS files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import { b } from "./b.js";\nimport lodash from "lodash";\n`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { c } from "./c.js";\nexport const b = 1;\n`
    );
    await writeFile(
      join(tmpDir, "src", "c.ts"),
      `export const c = 2;\n`
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);

    // Two internal edges: a→b, b→c
    expect(imports.edges).toHaveLength(2);
    expect(imports.edges.some((e) => e.from === "src/a.ts" && e.to === "src/b.ts")).toBe(true);
    expect(imports.edges.some((e) => e.from === "src/b.ts" && e.to === "src/c.ts")).toBe(true);

    // One external: lodash
    expect(imports.external).toHaveLength(1);
    expect(imports.external[0].package).toBe("lodash");

    // Summary
    expect(imports.summary.totalEdges).toBe(2);
    expect(imports.summary.totalExternal).toBe(1);
  });
});

// ── incremental imports ──────────────────────────────────────────────────────

describe("analyzeImports (incremental)", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("preserves edges from unchanged files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-inc-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import { b } from "./b.js";\nexport const a = 1;\n`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { c } from "./c.js";\nexport const b = 2;\n`
    );
    await writeFile(
      join(tmpDir, "src", "c.ts"),
      `export const c = 3;\n`
    );

    const inv1 = await analyzeInventory(tmpDir) as InventoryResult;
    const imp1 = await analyzeImports(tmpDir, inv1);

    // Modify only c.ts
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(tmpDir, "src", "c.ts"), `export const c = 99;\n`);

    const inv2 = await analyzeInventory(tmpDir, { previousInventory: inv1 }) as InventoryResult;

    // Incremental imports — only c.ts changed, no adds/deletes
    const imp2 = await analyzeImports(tmpDir, inv2, {
      previousImports: imp1,
      changedFiles: inv2.changedFiles,
      fileSetChanged: false,
    });

    // a→b edge should be preserved, b→c edge should be preserved
    expect(imp2.edges).toHaveLength(2);
    expect(imp2.edges.some((e) => e.from === "src/a.ts" && e.to === "src/b.ts")).toBe(true);
    expect(imp2.edges.some((e) => e.from === "src/b.ts" && e.to === "src/c.ts")).toBe(true);
    expect(imp2.summary.totalEdges).toBe(2);
  });

  it("falls back to full analysis when fileSetChanged", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-inc-full-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import { b } from "./b.js";\n`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `export const b = 1;\n`
    );

    const inv1 = await analyzeInventory(tmpDir) as InventoryResult;
    const imp1 = await analyzeImports(tmpDir, inv1);

    // Add a new file
    await writeFile(join(tmpDir, "src", "c.ts"), `export const c = 2;\n`);

    const inv2 = await analyzeInventory(tmpDir, { previousInventory: inv1 }) as InventoryResult;

    // fileSetChanged = true since file was added
    const imp2 = await analyzeImports(tmpDir, inv2, {
      previousImports: imp1,
      changedFiles: inv2.changedFiles,
      fileSetChanged: true,
    });

    // Full re-analysis should still find the a→b edge
    expect(imp2.edges.some((e) => e.from === "src/a.ts" && e.to === "src/b.ts")).toBe(true);
  });

  it("produces identical output as full run", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-inc-eq-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import { b } from "./b.js";\nimport lodash from "lodash";\n`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { c } from "./c.js";\nexport const b = 2;\n`
    );
    await writeFile(
      join(tmpDir, "src", "c.ts"),
      `export const c = 3;\n`
    );

    const inv1 = await analyzeInventory(tmpDir) as InventoryResult;
    const imp1 = await analyzeImports(tmpDir, inv1);

    // Modify b.ts
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { c } from "./c.js";\nexport const b = 99;\n`
    );

    const inv2 = await analyzeInventory(tmpDir, { previousInventory: inv1 }) as InventoryResult;

    const incremental = await analyzeImports(tmpDir, inv2, {
      previousImports: imp1,
      changedFiles: inv2.changedFiles,
      fileSetChanged: false,
    });

    const full = await analyzeImports(tmpDir, inv2);

    expect(incremental.edges).toEqual(full.edges);
    expect(incremental.external).toEqual(full.external);
    expect(incremental.summary).toEqual(full.summary);
  });

  it("rebuilds edges when changed file modifies its imports", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-inc-mod-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import { b } from "./b.js";\nexport const a = 1;\n`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { c } from "./c.js";\nexport const b = 2;\n`
    );
    await writeFile(
      join(tmpDir, "src", "c.ts"),
      `export const c = 3;\n`
    );
    await writeFile(
      join(tmpDir, "src", "d.ts"),
      `export const d = 4;\n`
    );

    const inv1 = await analyzeInventory(tmpDir) as InventoryResult;
    const imp1 = await analyzeImports(tmpDir, inv1);

    // b.ts now imports d instead of c
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { d } from "./d.js";\nexport const b = 2;\n`
    );

    const inv2 = await analyzeInventory(tmpDir, { previousInventory: inv1 }) as InventoryResult;

    const incremental = await analyzeImports(tmpDir, inv2, {
      previousImports: imp1,
      changedFiles: inv2.changedFiles,
      fileSetChanged: false,
    });

    const full = await analyzeImports(tmpDir, inv2);

    // b→c edge should be gone, b→d edge should appear
    expect(incremental.edges.some((e) => e.from === "src/b.ts" && e.to === "src/c.ts")).toBe(false);
    expect(incremental.edges.some((e) => e.from === "src/b.ts" && e.to === "src/d.ts")).toBe(true);
    // a→b should be preserved
    expect(incremental.edges.some((e) => e.from === "src/a.ts" && e.to === "src/b.ts")).toBe(true);
    expect(incremental.edges).toEqual(full.edges);
    expect(incremental.summary).toEqual(full.summary);
  });

  it("drops stale external symbols when changed file removes an import", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-inc-ext-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    // a.ts imports { x } from lodash, b.ts imports { y } from lodash
    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import { x } from "lodash";\nexport const a = x;\n`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { y } from "lodash";\nexport const b = y;\n`
    );

    const inv1 = await analyzeInventory(tmpDir) as InventoryResult;
    const imp1 = await analyzeImports(tmpDir, inv1);

    expect(imp1.external).toHaveLength(1);
    expect(imp1.external[0].symbols).toEqual(expect.arrayContaining(["x", "y"]));

    // b.ts now imports z instead of y
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import { z } from "lodash";\nexport const b = z;\n`
    );

    const inv2 = await analyzeInventory(tmpDir, { previousInventory: inv1 }) as InventoryResult;

    const incremental = await analyzeImports(tmpDir, inv2, {
      previousImports: imp1,
      changedFiles: inv2.changedFiles,
      fileSetChanged: false,
    });

    const full = await analyzeImports(tmpDir, inv2);

    // y should no longer appear; x and z should
    expect(incremental.external).toEqual(full.external);
    expect(incremental.external[0].symbols).toContain("x");
    expect(incremental.external[0].symbols).toContain("z");
    expect(incremental.external[0].symbols).not.toContain("y");
  });

  it("removes external package when only importer changes away from it", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-inc-rm-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import lodash from "lodash";\nexport const a = lodash;\n`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `export const b = 1;\n`
    );

    const inv1 = await analyzeInventory(tmpDir) as InventoryResult;
    const imp1 = await analyzeImports(tmpDir, inv1);
    expect(imp1.external).toHaveLength(1);

    // a.ts removes lodash import
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `export const a = 42;\n`
    );

    const inv2 = await analyzeInventory(tmpDir, { previousInventory: inv1 }) as InventoryResult;

    const incremental = await analyzeImports(tmpDir, inv2, {
      previousImports: imp1,
      changedFiles: inv2.changedFiles,
      fileSetChanged: false,
    });

    const full = await analyzeImports(tmpDir, inv2);

    expect(incremental.external).toHaveLength(0);
    expect(incremental.external).toEqual(full.external);
  });
});
