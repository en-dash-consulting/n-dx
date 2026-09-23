import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { buildIsoModel } from "../../../src/export/iso-model.js";
import type { IsoFileInput, IsoModelInput } from "../../../src/export/iso-model.js";
import { renderIsoMap } from "../../../src/export/iso-map.js";

function zone(id: string, n: number) {
  const files = Array.from({ length: n }, (_, i) => `src/${id}/f${i}.ts`);
  return { id, name: id.toUpperCase(), description: "", files, entryPoints: [], cohesion: 0.5, coupling: 0.2 };
}

/** Area "alpha" deliberately shares an id with a zone of area "beta". */
function input(): IsoModelInput {
  const zones = [zone("a1", 6), zone("a2", 4), zone("alpha", 5), zone("b2", 3)];
  return {
    zones,
    areas: [
      { id: "alpha", name: "Alpha", zones: ["a1", "a2"] },
      { id: "beta", name: "Beta", zones: ["alpha", "b2"] },
    ],
    crossings: [
      { fromZone: "a1", toZone: "a2" },
      { fromZone: "a1", toZone: "alpha" },
      { fromZone: "alpha", toZone: "b2" },
    ],
    files: new Map<string, IsoFileInput>(zones.flatMap((z) => z.files).map((f) => [f, { lineCount: 10, kind: "logic" as const }])),
    external: [],
    findings: [],
    meta: { project: "p", analyzedAt: "2026-01-01T00:00:00.000Z", origin: "sourcevision", totalFiles: 18, totalLines: 180 },
  };
}

function mount() {
  return new JSDOM(renderIsoMap(buildIsoModel(input())), { runScripts: "dangerously", url: "file:///map.html" });
}
const labels = (dom: JSDOM) => [...dom.window.document.querySelectorAll("#iso .tagtext")].map((t) => t.textContent).filter((t) => t && t.length > 1);
function block(dom: JSDOM, name: string) {
  return [...dom.window.document.querySelectorAll('#iso g.node[role="button"]')].find((g) => (g.getAttribute("aria-label") ?? "").startsWith(`${name},`))!;
}
const dbl = (dom: JSDOM, el: Element) => el.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));

describe("in-place expansion", () => {
  it("expands an area where it stands, keeping the other areas, and collapses it again", () => {
    const dom = mount();
    expect(labels(dom).sort()).toEqual(["ALPHA", "BETA"]);
    dbl(dom, block(dom, "Alpha"));
    expect(labels(dom)).toEqual(expect.arrayContaining(["ALPHA", "BETA", "A1", "A2"]));
    expect(dom.window.document.querySelectorAll("#iso g.frame").length).toBe(1);
    // The expanded area's panel offers Collapse and Open on its own.
    const acts = [...dom.window.document.querySelectorAll("[data-expand],[data-open]")].map((b) => b.textContent);
    expect(acts[0]).toBe("Collapse");
    dbl(dom, block(dom, "Alpha"));
    expect(labels(dom).sort()).toEqual(["ALPHA", "BETA"]);
    expect(dom.window.document.querySelectorAll("#iso g.frame").length).toBe(0);
  });

  it("expands several areas at once without id collisions between areas and zones", () => {
    const dom = mount();
    dbl(dom, block(dom, "Alpha"));
    dbl(dom, block(dom, "Beta"));
    expect(dom.window.document.querySelectorAll("#iso g.frame").length).toBe(2);
    // Zone "alpha" (in Beta) and area "Alpha" both drawn.
    expect(labels(dom).filter((l) => l === "ALPHA").length).toBe(2);
    expect(labels(dom)).toEqual(expect.arrayContaining(["A1", "A2", "B2"]));
  });

  it("keeps inter-area connectors attached after expansion", () => {
    const dom = mount();
    const before = dom.window.document.querySelectorAll("#iso .edge").length;
    dbl(dom, block(dom, "Alpha"));
    // Alpha→Beta stays; Alpha's internal a1→a2 is added.
    expect(dom.window.document.querySelectorAll("#iso .edge").length).toBe(before + 1);
  });
});
