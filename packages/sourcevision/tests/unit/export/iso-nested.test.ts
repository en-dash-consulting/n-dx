import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { buildIsoModel } from "../../../src/export/iso-model.js";
import type { IsoFileInput, IsoModelInput, IsoZoneInput } from "../../../src/export/iso-model.js";
import { renderIsoMap } from "../../../src/export/iso-map.js";

const files = (dir: string, n: number) => Array.from({ length: n }, (_, i) => `${dir}/f${i}.ts`);
function zone(id: string, name: string, fs: string[], extra: Partial<IsoZoneInput> = {}): IsoZoneInput {
  return { id, name, description: "", files: fs, entryPoints: [], cohesion: 0.5, coupling: 0.2, ...extra };
}

/** Area UI holds zone "comp" with sub-zones icons/park; park has engine/world. Area Data holds "db". */
function input(): IsoModelInput {
  const engine = files("comp/park/engine", 4), world = files("comp/park/world", 4), icons = files("comp/icons", 5);
  const park = zone("comp/park", "Park", [...engine, ...world], {
    children: [{ id: "comp/park/engine", name: "Engine", files: 4 }, { id: "comp/park/world", name: "World", files: 4 }],
    subZones: [zone("comp/park/engine", "Engine", engine), zone("comp/park/world", "World", world)],
    subCrossings: [{ from: world[0], to: engine[0], fromZone: "comp/park/world", toZone: "comp/park/engine" }],
  });
  const comp = zone("comp", "Comp", [...icons, ...park.files], {
    children: [{ id: "comp/icons", name: "Icons", files: 5 }, { id: "comp/park", name: "Park", files: 8 }],
    subZones: [zone("comp/icons", "Icons", icons), park],
    subCrossings: [{ from: engine[1], to: icons[0], fromZone: "comp/park", toZone: "comp/icons" }],
  });
  const db = zone("db", "Db", files("db", 4));
  const other = zone("misc", "Misc", files("misc", 3));
  const all = [comp, db, other];
  return {
    zones: all,
    areas: [{ id: "ui", name: "UI", zones: ["comp", "misc"] }, { id: "data", name: "Data", zones: ["db"] }],
    crossings: [{ fromZone: "comp", toZone: "db" }],
    fileCrossings: [{ from: engine[2], to: db.files[0] }],
    files: new Map<string, IsoFileInput>(all.flatMap((z) => z.files).map((f) => [f, { lineCount: 10, kind: "logic" as const }])),
    external: [],
    findings: [],
    meta: { project: "p", analyzedAt: "2026-01-01T00:00:00.000Z", origin: "sourcevision", totalFiles: 20, totalLines: 200 },
  };
}

const mount = () => new JSDOM(renderIsoMap(buildIsoModel(input())), { runScripts: "dangerously", url: "file:///map.html" });
const labels = (dom: JSDOM) => [...dom.window.document.querySelectorAll("#iso .tagtext")].map((t) => t.textContent).filter((t) => t && t.length > 1);
const block = (dom: JSDOM, name: string) =>
  [...dom.window.document.querySelectorAll('#iso g.node[role="button"]')].find((g) => (g.getAttribute("aria-label") ?? "").startsWith(`${name},`))!;
const dbl = (dom: JSDOM, name: string) => block(dom, name).dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
const arcs = (dom: JSDOM) => [...dom.window.document.querySelectorAll("#iso .edge")].filter((g) => g.querySelector("path.wire")).map((g) => g.getAttribute("aria-label"));

describe("hierarchy in the model", () => {
  it("has scenes for every node with drawn sub-zones, parents, and leaf edges", () => {
    const m = buildIsoModel(input());
    expect(Object.keys(m.zoneScenes!).sort()).toEqual(["comp", "comp/park"]);
    expect(m.parents).toMatchObject({ comp: "area:ui", "comp/park": "comp", "comp/park/engine": "comp/park" });
    expect(m.leafEdges).toEqual(expect.arrayContaining([
      { from: "comp/park/engine", to: "db", weight: 1 },
      { from: "comp/park/world", to: "comp/park/engine", weight: 1 },
    ]));
  });
});

describe("nested expansion in the map", () => {
  it("expands an area, then a zone in it, then a sub-zone, each in place", () => {
    const dom = mount();
    dbl(dom, "UI");
    expect(labels(dom)).toEqual(expect.arrayContaining(["COMP", "MISC", "DATA"]));
    dbl(dom, "Comp");
    expect(labels(dom)).toEqual(expect.arrayContaining(["ICONS", "PARK"]));
    dbl(dom, "Park");
    expect(labels(dom)).toEqual(expect.arrayContaining(["ENGINE", "WORLD", "ICONS", "DATA"]));
    expect(dom.window.document.querySelectorAll("#iso g.frame").length).toBe(3);
  });

  it("draws the arc from the deepest visible node at each end", () => {
    const dom = mount();
    dbl(dom, "UI");
    dbl(dom, "Comp");
    dbl(dom, "Park");
    // engine → db, lifted: engine is visible, db lifts to its collapsed area.
    expect(arcs(dom)).toContain("Dependency: Engine imports Data, 1 references");
    // engine → icons: icons is visible alongside the expanded Park.
    expect(arcs(dom)).toContain("Dependency: Engine imports Icons, 1 references");
  });

  it("collapsing an outer node hides everything expanded inside it", () => {
    const dom = mount();
    dbl(dom, "UI");
    dbl(dom, "Comp");
    dbl(dom, "Park");
    dbl(dom, "UI");
    expect(dom.window.document.querySelectorAll("#iso g.frame").length).toBe(0);
    expect(labels(dom).sort()).toEqual(["DATA", "UI"]);
    dbl(dom, "UI");
    // Re-expanding the area does not bring back the inner expansions.
    expect(dom.window.document.querySelectorAll("#iso g.frame").length).toBe(1);
  });
});
