/**
 * Size caps on the artifacts every downstream consumer pays for.
 *
 * These files are not read by humans — they are piped into agent prompts and
 * MCP tool results, so their size is a per-run token cost. Three of them grew
 * unbounded with repository size: the llms.txt file table was measured at 75 KB
 * of a 108 KB file, and the zones MCP resource returned every zone's full file
 * list pretty-printed.
 *
 * Each cap has to state what it dropped. A silently truncated index is worse
 * than a large one, because a reader cannot tell whether a file is absent or
 * merely unlisted.
 */

import { describe, it, expect } from "vitest";
import { generateLlmsTxt, LLMS_TXT_MAX_INVENTORY_ROWS } from "../../../src/analyzers/llms-txt.js";
import { generateContext, CONTEXT_MAX_ROUTE_GROUPS, CONTEXT_MAX_ROUTES_PER_GROUP } from "../../../src/analyzers/context.js";
import type { Inventory, Zones, Components, Manifest, Imports } from "../../../src/schema/v1.js";

const MANIFEST = {
  schemaVersion: 1,
  toolVersion: "test",
  analyzedAt: new Date().toISOString(),
  targetPath: "/repo",
  modules: [],
  language: "typescript",
} as unknown as Manifest;

const IMPORTS = {
  edges: [],
  external: [],
  summary: {
    totalEdges: 0,
    totalExternal: 0,
    circularCount: 0,
    circulars: [],
    mostImported: [],
    avgImportsPerFile: 0,
  },
} as unknown as Imports;

function makeInventory(fileCount: number): Inventory {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: "/repo",
    files: Array.from({ length: fileCount }, (_, i) => ({
      path: `src/module-${i}/file-${i}.ts`,
      role: "source",
      language: "typescript",
      loc: 100,
      bytes: 2000,
    })),
    summary: {
      totalFiles: fileCount,
      totalLines: fileCount * 100,
      totalLoc: fileCount * 100,
      byLanguage: {},
      byRole: {},
      byExtension: {},
    },
  } as unknown as Inventory;
}

function makeZones(): Zones {
  return { zones: [], crossings: [], unzoned: [] } as unknown as Zones;
}

function makeComponents(groups: number, routesPerGroup: number): Components {
  return {
    summary: {
      totalRouteModules: 0,
      totalComponents: 0,
      totalUsageEdges: 0,
      totalServerRoutes: groups * routesPerGroup,
      routeConventions: {},
      mostUsedComponents: [],
      layoutDepth: 0,
    },
    routeTree: [],
    routeModules: [],
    usageEdges: [],
    components: [],
    serverRoutes: Array.from({ length: groups }, (_, g) => ({
      prefix: `/api/group-${g}`,
      handler: `handler${g}`,
      file: `src/routes/group-${g}.ts`,
      routes: Array.from({ length: routesPerGroup }, (_, r) => ({
        method: "GET",
        path: `/api/group-${g}/route-${r}`,
      })),
    })),
  } as unknown as Components;
}

describe("llms.txt file table cap", () => {
  it("lists every file when the inventory is under the cap", () => {
    const small = LLMS_TXT_MAX_INVENTORY_ROWS - 10;
    const out = generateLlmsTxt(MANIFEST, makeInventory(small), IMPORTS, makeZones(), null, null);

    expect(out).toContain("src/module-0/file-0.ts");
    expect(out).toContain(`src/module-${small - 1}/file-${small - 1}.ts`);
    expect(out).not.toMatch(/not listed|omitted/i);
  });

  it("caps a large inventory and states what it dropped", () => {
    const total = LLMS_TXT_MAX_INVENTORY_ROWS + 250;
    const out = generateLlmsTxt(MANIFEST, makeInventory(total), IMPORTS, makeZones(), null, null);

    // The marker has to carry both numbers: a reader must be able to tell
    // "absent from the repo" from "present but unlisted".
    expect(out).toMatch(new RegExp(String(total)));
    expect(out).toMatch(/250 .*not listed|not listed|omitted/i);
    expect(out).not.toContain(`src/module-${total - 1}/file-${total - 1}.ts`);
  });

  it("bounds the generated file even for a pathological repository", () => {
    const capped = generateLlmsTxt(MANIFEST, makeInventory(20_000), IMPORTS, makeZones(), null, null);
    const uncappedRowCost = 20_000 * 60;
    expect(capped.length).toBeLessThan(uncappedRowCost / 4);
  });

  it("keeps the table's leading rows rather than an arbitrary slice", () => {
    const out = generateLlmsTxt(MANIFEST, makeInventory(LLMS_TXT_MAX_INVENTORY_ROWS + 50), IMPORTS, makeZones(), null, null);
    expect(out).toContain("src/module-0/file-0.ts");
  });
});

describe("CONTEXT.md routes cap", () => {
  const inventory = makeInventory(5);
  const zones = makeZones();

  it("prints every route group when under the cap", () => {
    const components = makeComponents(CONTEXT_MAX_ROUTE_GROUPS - 1, 2);
    const out = generateContext(MANIFEST, inventory, IMPORTS, zones, components, null);

    expect(out).toContain("/api/group-0");
    expect(out).toContain(`/api/group-${CONTEXT_MAX_ROUTE_GROUPS - 2}`);
  });

  it("caps route groups and says how many were omitted", () => {
    const groups = CONTEXT_MAX_ROUTE_GROUPS + 7;
    const out = generateContext(MANIFEST, inventory, IMPORTS, zones, makeComponents(groups, 2), null);

    expect(out).not.toContain(`/api/group-${groups - 1}/`);
    expect(out).toMatch(/7 more|omitted|not listed/i);
  });

  it("caps routes within a single large group", () => {
    const perGroup = CONTEXT_MAX_ROUTES_PER_GROUP + 20;
    const out = generateContext(MANIFEST, inventory, IMPORTS, zones, makeComponents(1, perGroup), null);

    expect(out).not.toContain(`/api/group-0/route-${perGroup - 1}`);
    expect(out).toMatch(/20 more|omitted|not listed/i);
  });

  it("bounds the routes section for a pathological route table", () => {
    const out = generateContext(MANIFEST, inventory, IMPORTS, zones, makeComponents(500, 200), null);
    // 100k routes uncapped would be megabytes.
    expect(out.length).toBeLessThan(200_000);
  });
});
