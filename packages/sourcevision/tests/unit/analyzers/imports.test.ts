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

  it("detects default import", () => {
    const result = extractImports(
      'import React from "react";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("static");
    expect(result[0].specifier).toBe("react");
    expect(result[0].symbols).toEqual(["default"]);
  });

  it("detects default + named combined import", () => {
    const result = extractImports(
      'import React, { useState, useEffect } from "react";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("static");
    expect(result[0].symbols).toEqual(["default", "useState", "useEffect"]);
  });

  it("detects inline type import (import { type Foo, bar })", () => {
    const result = extractImports(
      'import { type Foo, bar } from "./x";',
      "test.ts"
    );
    // Should produce two imports: one type for Foo, one static for bar
    expect(result).toHaveLength(2);
    const typeImport = result.find((r) => r.type === "type");
    const staticImport = result.find((r) => r.type === "static");
    expect(typeImport).toBeDefined();
    expect(typeImport!.symbols).toEqual(["Foo"]);
    expect(staticImport).toBeDefined();
    expect(staticImport!.symbols).toEqual(["bar"]);
  });

  it("detects star re-export (export * from)", () => {
    const result = extractImports(
      'export * from "./utils";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("reexport");
    expect(result[0].specifier).toBe("./utils");
    expect(result[0].symbols).toEqual(["*"]);
  });

  it("detects namespace re-export (export * as ns from)", () => {
    const result = extractImports(
      'export * as utils from "./utils";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("reexport");
    expect(result[0].specifier).toBe("./utils");
    expect(result[0].symbols).toEqual(["*"]);
  });

  it("detects type re-export (export type { Foo } from)", () => {
    const result = extractImports(
      'export type { Foo } from "./types";',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("type");
    expect(result[0].specifier).toBe("./types");
    expect(result[0].symbols).toContain("Foo");
  });

  it("detects require() in nested expression", () => {
    const result = extractImports(
      'const pick = require("lodash").pick;',
      "test.js"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("require");
    expect(result[0].specifier).toBe("lodash");
  });

  it("detects dynamic import() in async function", () => {
    const source = `
      async function load() {
        const { default: mod } = await import("./module");
        return mod;
      }
    `;
    const result = extractImports(source, "test.ts");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("dynamic");
    expect(result[0].specifier).toBe("./module");
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

  it("handles all import types in a single file", () => {
    const source = `
      import { a } from "./a";
      import type { B } from "./b";
      import * as c from "./c";
      import "./side-effect";
      import def from "./default";
      const d = import("./dynamic");
      const e = require("./cjs");
      export { f } from "./reexport";
      export type { G } from "./type-reexport";
    `;
    const result = extractImports(source, "test.ts");
    // static(a) + type(B) + static(c namespace) + static(side-effect) + static(def) + dynamic + require + reexport + type-reexport
    expect(result).toHaveLength(9);
    expect(result.filter((r) => r.type === "static")).toHaveLength(4);
    expect(result.filter((r) => r.type === "type")).toHaveLength(2);
    expect(result.filter((r) => r.type === "dynamic")).toHaveLength(1);
    expect(result.filter((r) => r.type === "require")).toHaveLength(1);
    expect(result.filter((r) => r.type === "reexport")).toHaveLength(1);
  });

  it("extracts destructured symbols from dynamic import()", () => {
    const result = extractImports(
      'const { cmdConfig, runCmd } = await import("./config.js");',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("dynamic");
    expect(result[0].specifier).toBe("./config.js");
    expect(result[0].symbols).toEqual(["cmdConfig", "runCmd"]);
  });

  it("extracts destructured symbols from require()", () => {
    const result = extractImports(
      'const { foo, bar } = require("./utils");',
      "test.js"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("require");
    expect(result[0].specifier).toBe("./utils");
    expect(result[0].symbols).toEqual(["foo", "bar"]);
  });

  it("uses propertyName for renamed destructured bindings", () => {
    const result = extractImports(
      'const { default: mod } = await import("./module");',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("dynamic");
    expect(result[0].symbols).toEqual(["default"]);
  });

  it("keeps symbols ['*'] for non-destructured dynamic import", () => {
    const result = extractImports(
      'const m = await import("./module");',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("dynamic");
    expect(result[0].symbols).toEqual(["*"]);
  });

  it("extracts destructured symbols from import() without await", () => {
    const result = extractImports(
      'const { foo } = import("./x");',
      "test.ts"
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("dynamic");
    expect(result[0].symbols).toEqual(["foo"]);
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

  it("returns scoped package with no subpath", () => {
    expect(extractPackageName("@scope/pkg")).toBe("@scope/pkg");
  });

  it("strips deeply nested subpath from scoped package", () => {
    expect(extractPackageName("@angular/core/testing/init")).toBe("@angular/core");
  });

  it("strips deeply nested subpath from unscoped package", () => {
    expect(extractPackageName("lodash/fp/map")).toBe("lodash");
  });

  it("handles scoped package with hyphenated names", () => {
    expect(extractPackageName("@my-org/my-pkg/utils")).toBe("@my-org/my-pkg");
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

  it("excludes type-only imports from mostImported rankings", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-type-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });

    // types.ts is imported by a.ts (type-only) and b.ts (type-only)
    // utils.ts is imported by a.ts (static)
    await writeFile(
      join(tmpDir, "src", "a.ts"),
      `import type { Foo } from "./types.js";\nimport { util } from "./utils.js";\nexport const a: Foo = util;\n`
    );
    await writeFile(
      join(tmpDir, "src", "b.ts"),
      `import type { Bar } from "./types.js";\nexport const b: Bar = 1;\n`
    );
    await writeFile(
      join(tmpDir, "src", "types.ts"),
      `export type Foo = number;\nexport type Bar = number;\n`
    );
    await writeFile(
      join(tmpDir, "src", "utils.ts"),
      `export const util = 42;\n`
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);

    // Should have 3 edges total: a→types (type), b→types (type), a→utils (static)
    expect(imports.edges).toHaveLength(3);

    // mostImported should only count non-type edges.
    // utils.ts has 1 static import, types.ts has 0 non-type imports.
    expect(imports.summary.mostImported).toHaveLength(1);
    expect(imports.summary.mostImported[0].path).toBe("src/utils.ts");
    expect(imports.summary.mostImported[0].count).toBe(1);
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

// ── tsconfig path alias resolution ──────────────────────────────────────────

describe("tsconfig path alias resolution", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves ~ path aliases via tsconfig.json paths", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-alias-"));
    await mkdir(join(tmpDir, "app/components"), { recursive: true });
    await mkdir(join(tmpDir, "app/routes"), { recursive: true });

    // tsconfig with ~/* -> ./app/*
    await writeFile(
      join(tmpDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          paths: { "~/*": ["./app/*"] },
        },
      }),
    );

    await writeFile(
      join(tmpDir, "app/components/Button.tsx"),
      `export const Button = () => null;\n`,
    );
    await writeFile(
      join(tmpDir, "app/routes/index.tsx"),
      `import { Button } from "~/components/Button";\nexport default function() { return Button(); }\n`,
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);

    // The ~ import should resolve to an internal edge, not external
    expect(imports.edges).toHaveLength(1);
    expect(imports.edges[0].from).toBe("app/routes/index.tsx");
    expect(imports.edges[0].to).toBe("app/components/Button.tsx");
    expect(imports.external.every((e) => e.package !== "~")).toBe(true);
  });

  it("handles tsconfig.json with comments (JSONC format)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-jsonc-"));
    await mkdir(join(tmpDir, "app/utils"), { recursive: true });
    await mkdir(join(tmpDir, "app/routes"), { recursive: true });

    // tsconfig with comments — JSON.parse would fail on this
    await writeFile(
      join(tmpDir, "tsconfig.json"),
      `{
  "compilerOptions": {
    "paths": {
      "~/*": ["./app/*"]
    },
    // This is a comment that breaks JSON.parse
    "noEmit": true
  }
}`,
    );

    await writeFile(
      join(tmpDir, "app/utils/helper.ts"),
      `export function helper() { return 42; }\n`,
    );
    await writeFile(
      join(tmpDir, "app/routes/page.tsx"),
      `import { helper } from "~/utils/helper";\nexport default function() { return helper(); }\n`,
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);

    // Even with comments in tsconfig, the ~ alias should resolve
    expect(imports.edges).toHaveLength(1);
    expect(imports.edges[0].from).toBe("app/routes/page.tsx");
    expect(imports.edges[0].to).toBe("app/utils/helper.ts");
    expect(imports.external.every((e) => e.package !== "~")).toBe(true);
  });

  it("handles tsconfig.json with trailing commas", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-imp-trailing-"));
    await mkdir(join(tmpDir, "app/lib"), { recursive: true });
    await mkdir(join(tmpDir, "app/src"), { recursive: true });

    // tsconfig with trailing commas
    await writeFile(
      join(tmpDir, "tsconfig.json"),
      `{
  "compilerOptions": {
    "paths": {
      "~/*": ["./app/*"],
    },
  },
}`,
    );

    await writeFile(
      join(tmpDir, "app/lib/math.ts"),
      `export const add = (a: number, b: number) => a + b;\n`,
    );
    await writeFile(
      join(tmpDir, "app/src/main.ts"),
      `import { add } from "~/lib/math";\nconsole.log(add(1, 2));\n`,
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);

    expect(imports.edges).toHaveLength(1);
    expect(imports.edges[0].to).toBe("app/lib/math.ts");
  });
});
