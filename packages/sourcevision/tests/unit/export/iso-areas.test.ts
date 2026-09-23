import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { buildIsoModel, wrapTallColumns } from "../../../src/export/iso-model.js";
import type { IsoFileInput, IsoModelInput, IsoNode } from "../../../src/export/iso-model.js";
import { renderIsoMap } from "../../../src/export/iso-map.js";

function zone(id: string, n: number) {
  const files = Array.from({ length: n }, (_, i) => `src/${id}/f${i}.ts`);
  return { id, name: id.toUpperCase(), description: "", files, entryPoints: [], cohesion: 0.5, coupling: 0.2 };
}

function input(): IsoModelInput {
  const zones = [zone("a1", 6), zone("a2", 4), zone("b1", 5), zone("b2", 3)];
  return {
    zones,
    areas: [
      { id: "alpha", name: "Alpha", zones: ["a1", "a2"] },
      { id: "beta", name: "Beta", zones: ["b1", "b2"] },
    ],
    crossings: [
      { fromZone: "a1", toZone: "a2" },
      { fromZone: "a1", toZone: "b1" },
      { fromZone: "a2", toZone: "b2" },
      { fromZone: "b1", toZone: "b2" },
    ],
    files: new Map<string, IsoFileInput>(zones.flatMap((z) => z.files).map((f) => [f, { lineCount: 10, kind: "logic" as const }])),
    external: [],
    findings: [],
    meta: { project: "p", analyzedAt: "2026-01-01T00:00:00.000Z", origin: "sourcevision", totalFiles: 18, totalLines: 180 },
  };
}

describe("buildIsoModel with areas", () => {
  it("draws one node per area with member zones as tiles and edges aggregated between areas", () => {
    const m = buildIsoModel(input());
    expect(m.level).toBe("areas");
    expect(m.nodes.map((n) => n.id).sort()).toEqual(["alpha", "beta"]);
    expect(m.nodes.find((n) => n.id === "alpha")!.tiles!.map((t) => t.id)).toEqual(["a1", "a2"]);
    const between = m.edges.filter((e) => !e.infra && !e.seam);
    expect(between).toHaveLength(1);
    expect(between[0]).toMatchObject({ from: "alpha", to: "beta", weight: 2 });
    expect(m.meta.totalZones).toBe(4);
  });

  it("carries one zone scene per area, with only that area's zones and internal edges", () => {
    const m = buildIsoModel(input());
    const alpha = m.scenes!.alpha;
    expect(alpha.scene).toEqual({ id: "alpha", name: "Alpha" });
    expect(alpha.nodes.map((n) => n.id).sort()).toEqual(["a1", "a2"]);
    expect(alpha.edges.map((e) => [e.from, e.to])).toEqual([["a1", "a2"]]);
  });

  it("draws zones directly without areas", () => {
    const m = buildIsoModel({ ...input(), areas: undefined });
    expect(m.level).toBeUndefined();
    expect(m.nodes).toHaveLength(4);
  });
});

describe("rendered map with areas", () => {
  it("opens an area's scene from the URL hash and shows a breadcrumb back", () => {
    const html = renderIsoMap(buildIsoModel(input()));
    const top = new JSDOM(html, { runScripts: "dangerously", url: "file:///map.html" });
    expect(top.window.document.getElementById("crumbs")!.hidden).toBe(true);
    expect(top.window.document.querySelectorAll("polygon.tile").length).toBe(4);

    const scene = new JSDOM(html, { runScripts: "dangerously", url: "file:///map.html#alpha" });
    const crumbs = scene.window.document.getElementById("crumbs")!;
    expect(crumbs.hidden).toBe(false);
    expect(crumbs.textContent).toContain("All areas");
    expect(crumbs.textContent).toContain("Alpha");
    const labels = [...scene.window.document.querySelectorAll("#iso .tagtext")].map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(["A1", "A2"]));
    expect(labels).not.toContain("B1");
  });

  it("offers an Open button for an area in the details panel", () => {
    const dom = new JSDOM(renderIsoMap(buildIsoModel(input())), { runScripts: "dangerously", url: "file:///map.html" });
    const block = dom.window.document.querySelector('#iso g.node[role="button"]')!;
    block.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const open = dom.window.document.querySelector("[data-open]");
    expect(open).not.toBeNull();
    expect(open!.textContent).toMatch(/^Open /);
  });
});

describe("wrapTallColumns", () => {
  it("splits a column taller than max(3, ceil(sqrt(n))) and shifts later columns", () => {
    const node = (id: string, col: number, row: number) => ({ id, col, row } as unknown as IsoNode);
    const nodes = [...Array.from({ length: 12 }, (_, i) => node(`a${i}`, 0, i)), node("b", 1, 0), node("c", 2, 0)];
    wrapTallColumns(nodes);
    const maxRows = Math.max(3, Math.ceil(Math.sqrt(14)));
    const byCol = new Map<number, number>();
    for (const n of nodes) byCol.set(n.col, (byCol.get(n.col) ?? 0) + 1);
    expect(Math.max(...byCol.values())).toBeLessThanOrEqual(maxRows);
    expect(nodes.find((n) => n.id === "b")!.col).toBeGreaterThan(Math.max(...nodes.filter((n) => n.id.startsWith("a")).map((n) => n.col)));
  });
});
