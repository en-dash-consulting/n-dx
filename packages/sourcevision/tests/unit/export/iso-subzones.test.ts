import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { buildIsoModel, layoutTiles } from "../../../src/export/iso-model.js";
import type { IsoFileInput, IsoModelInput } from "../../../src/export/iso-model.js";
import { renderIsoMap } from "../../../src/export/iso-map.js";
import { balancedChildren } from "../../../src/export/iso-sources.js";
import { makeZone } from "../analyzers/zones-helpers.js";

function input(children?: Array<{ id: string; name: string; files: number }>): IsoModelInput {
  const coreFiles = Array.from({ length: 30 }, (_, i) => `src/core/f${i}.ts`);
  return {
    zones: [
      { id: "core", name: "Core", description: "", files: coreFiles, entryPoints: [], cohesion: 0.7, coupling: 0.2, ...(children ? { children } : {}) },
      { id: "api", name: "Api", description: "", files: ["src/api/a.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ],
    crossings: [{ fromZone: "api", toZone: "core" }],
    files: new Map<string, IsoFileInput>([...coreFiles, "src/api/a.ts"].map((f) => [f, { lineCount: 10, kind: "logic" as const }])),
    external: [],
    findings: [],
    meta: { project: "p", analyzedAt: "2026-01-01T00:00:00.000Z", origin: "sourcevision", totalFiles: 31, totalLines: 310 },
  };
}

describe("layoutTiles", () => {
  it("fills the face exactly, with areas proportional to file count", () => {
    const tiles = layoutTiles([{ id: "a", name: "A", files: 10 }, { id: "b", name: "B", files: 20 }, { id: "c", name: "C", files: 10 }], 8, 6);
    const area = tiles.reduce((n, t) => n + t.w * t.d, 0);
    expect(area).toBeCloseTo(48, 1);
    const b = tiles.find((t) => t.id === "b")!;
    expect((b.w * b.d) / 48).toBeCloseTo(0.5, 1);
    for (const t of tiles) {
      expect(t.u + t.w).toBeLessThanOrEqual(8.001);
      expect(t.v + t.d).toBeLessThanOrEqual(6.001);
    }
  });

  it("draws nothing for fewer than two children", () => {
    expect(layoutTiles([{ id: "a", name: "A", files: 10 }], 8, 6)).toEqual([]);
  });
});

describe("balancedChildren", () => {
  it("passes balanced sub-zones and withholds a lopsided subdivision", () => {
    const files = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
    const balanced = makeZone("p", files, { subZones: [makeZone("p/a", files.slice(0, 5)), makeZone("p/b", files.slice(5))] });
    expect(balancedChildren(balanced)).toEqual([{ id: "p/a", name: "P/a", files: 5 }, { id: "p/b", name: "P/b", files: 5 }]);
    const lopsided = makeZone("p", files, { subZones: [makeZone("p/a", files.slice(0, 8)), makeZone("p/b", files.slice(8))] });
    expect(balancedChildren(lopsided)).toBeUndefined();
  });
});

describe("iso model and map with sub-zones", () => {
  it("lays out child tiles inside the parent box and renders them with titles", () => {
    const model = buildIsoModel(input([{ id: "core/a", name: "Alpha", files: 20 }, { id: "core/b", name: "Beta", files: 10 }]));
    const core = model.nodes.find((n) => n.id === "core")!;
    expect(core.tiles?.map((t) => t.name)).toEqual(["Alpha", "Beta"]);
    for (const t of core.tiles!) {
      expect(t.u + t.w).toBeLessThanOrEqual(core.w + 0.001);
      expect(t.v + t.d).toBeLessThanOrEqual(core.d + 0.001);
    }
    const dom = new JSDOM(renderIsoMap(model), { runScripts: "dangerously" });
    const titles = [...dom.window.document.querySelectorAll("polygon.tile title")].map((t) => t.textContent);
    expect(titles).toEqual(["Alpha · 20 files", "Beta · 10 files"]);
  });

  it("gives a zone without children no tiles", () => {
    const model = buildIsoModel(input());
    expect(model.nodes.find((n) => n.id === "core")!.tiles).toBeUndefined();
  });
});
