import { describe, it, expect } from "vitest";
import { analyzeZones, computeHubDamping, HUB_MIN_FAN_IN } from "../../../src/analyzers/zones.js";
import type { ImportEdge } from "../../../src/schema/index.js";
import { makeEdge, makeFileEntry, makeImports, makeInventory } from "./zones-helpers.js";

/**
 * A WebForms-shaped site (#743 retest): feature folders whose pages reference
 * each other sparsely, while every page leans on the same base page, data
 * service and model, plus a shared library that leans on them too.
 * Deterministic pseudo-random so the graph is irregular but stable.
 */
function hubSite(moduleCount: number, pagesPerModule: number) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const hubs = ["App_Code/SecurePage.cs", "App_Code/DataService.cs", "App_Code/KeyValue.cs"];
  const libs = Array.from({ length: 12 }, (_, i) => `App_Code/Lib${i}.cs`);
  const modules = Array.from({ length: moduleCount }, (_, i) => `Module${i}`);
  const files = [...hubs, ...libs];
  const edges: ImportEdge[] = [];
  const edge = (from: string, to: string, weight: number) =>
    edges.push({ from, to, type: "static", symbols: ["T"], weight });
  for (const m of modules) {
    const pages = Array.from({ length: pagesPerModule }, (_, i) => `${m}/Page${i}.aspx.cs`);
    files.push(...pages);
    for (const p of pages) {
      for (let k = 0; k < 2; k++) {
        const q = pages[Math.floor(rnd() * pages.length)];
        if (q !== p) edge(p, q, 1 + Math.floor(rnd() * 3));
      }
      for (const h of hubs) if (rnd() < 0.6) edge(p, h, 10);
      for (let k = 0; k < 3; k++) edge(p, libs[Math.floor(rnd() * libs.length)], 1 + Math.floor(rnd() * 5));
    }
  }
  for (const l of libs) for (const h of hubs) edge(l, h, 5);
  return {
    modules,
    inventory: makeInventory(files.map((p) => makeFileEntry(p, { language: "C#" }))),
    imports: makeImports(edges),
  };
}

describe("computeHubDamping", () => {
  it("damps only files imported by more than the threshold, in proportion", () => {
    const importers = (to: string, n: number) => Array.from({ length: n }, (_, i) => makeEdge(`src/f${i}.ts`, to));
    const damping = computeHubDamping(
      [...importers("src/hub.ts", HUB_MIN_FAN_IN * 4), ...importers("src/util.ts", HUB_MIN_FAN_IN)],
      100,
    );
    expect(damping.get("src/hub.ts")).toBe(0.25);
    expect(damping.has("src/util.ts")).toBe(false);
  });

  it("raises the threshold with project size", () => {
    const edges = Array.from({ length: 50 }, (_, i) => makeEdge(`src/f${i}.ts`, "src/hub.ts"));
    expect(computeHubDamping(edges, 100).has("src/hub.ts")).toBe(true);
    expect(computeHubDamping(edges, 2000).has("src/hub.ts")).toBe(false);
  });
});

describe("hub damping in zone detection", () => {
  it("groups feature folders that all lean on the same hubs by folder", async () => {
    const { modules, inventory, imports } = hubSite(12, 25);
    const { zones } = await analyzeZones(inventory, imports, { enrich: false });

    // Purity: share of module files that sit in their zone's dominant module.
    let pure = 0;
    let moduleFiles = 0;
    for (const z of zones.zones) {
      const counts = new Map<string, number>();
      for (const f of z.files) {
        if (!f.startsWith("Module")) continue;
        const m = f.slice(0, f.indexOf("/"));
        counts.set(m, (counts.get(m) ?? 0) + 1);
        moduleFiles++;
      }
      pure += Math.max(0, ...counts.values());
    }
    expect(pure / moduleFiles).toBeGreaterThan(0.85);
    expect(zones.partitionReview?.health.largestShare).toBeLessThan(0.5);
  });
});
