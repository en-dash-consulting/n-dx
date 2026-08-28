/**
 * Interaction regression tests for the rendered isometric map.
 *
 * These run the generated page's own script in jsdom and drive it with the
 * event sequence a real browser produces. An earlier version listened on both
 * `pointerup` and `click` while `select()` toggled, so a single physical click
 * fired twice and deselected immediately — the map looked completely inert.
 * Dispatching only `click` did not reproduce it, which is exactly why these
 * tests dispatch the real pair.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { JSDOM } from "jsdom";
import { buildIsoModel } from "../../../src/export/iso-model.js";
import { renderIsoMap } from "../../../src/export/iso-map.js";
import type { Imports, Inventory, Manifest, Zones } from "../../../src/schema/index.js";

function makeInput() {
  const manifest: Manifest = {
    schemaVersion: "1.0.0",
    toolVersion: "0.0.0-test",
    analyzedAt: "2026-01-01T00:00:00.000Z",
    targetPath: "/tmp/p",
    modules: {},
  };
  const zones: Zones = {
    zones: [
      {
        id: "api", name: "Api", description: "HTTP surface",
        files: ["src/api/a.ts", "src/api/b.ts"], entryPoints: ["src/api/a.ts"],
        cohesion: 0.8, coupling: 0.2,
      },
      {
        id: "core", name: "Core", description: "Business logic",
        files: ["src/core/c.ts", "src/core/d.ts", "src/core/e.ts"],
        entryPoints: ["src/core/c.ts"], cohesion: 0.7, coupling: 0.3,
      },
      {
        id: "db", name: "Db", description: "Persistence",
        files: ["src/db/f.ts"], entryPoints: ["src/db/f.ts"],
        cohesion: 0.9, coupling: 0.1,
      },
    ],
    crossings: [
      { from: "src/api/a.ts", to: "src/core/c.ts", fromZone: "api", toZone: "core" },
      { from: "src/core/c.ts", to: "src/db/f.ts", fromZone: "core", toZone: "db" },
    ],
    unzoned: [],
  };
  const inventory: Inventory = {
    files: [
      ["src/api/a.ts", 100], ["src/api/b.ts", 50], ["src/core/c.ts", 400],
      ["src/core/d.ts", 300], ["src/core/e.ts", 200], ["src/db/f.ts", 20],
    ].map(([path, lineCount]) => ({
      path: path as string, size: 100, language: "TypeScript",
      lineCount: lineCount as number, hash: "h", role: "source" as const, category: "core",
    })),
    summary: {
      totalFiles: 6, totalLines: 1070, byLanguage: { TypeScript: 6 },
      byRole: { source: 6 }, byCategory: { core: 6 },
    },
  };
  const imports: Imports = {
    edges: [], external: [],
    summary: {
      totalEdges: 0, totalExternal: 0, circularCount: 0, circulars: [],
      mostImported: [], avgImportsPerFile: 0,
    },
  };
  return { manifest, zones, inventory, imports, projectName: "interaction-fixture" };
}

/** The pair of events a browser fires for one physical click. */
function realClick(win: JSDOM["window"], element: Element): void {
  element.dispatchEvent(new win.Event("pointerup", { bubbles: true }));
  element.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
}

describe("iso map interaction", () => {
  let dom: JSDOM;
  let doc: Document;
  let win: JSDOM["window"];

  const panelHeading = () => doc.querySelector("#dossier h3")?.textContent ?? "";
  const blocks = () => [...doc.querySelectorAll("#iso .node[role=button]")];
  const edges = () => [...doc.querySelectorAll("#iso .edge")];

  beforeAll(() => {
    const html = renderIsoMap(buildIsoModel(makeInput()));
    dom = new JSDOM(html, { runScripts: "dangerously" });
    doc = dom.window.document;
    win = dom.window;
  });

  afterAll(() => dom.window.close());

  it("builds a block per zone and a clickable connector per edge", () => {
    expect(blocks()).toHaveLength(3);
    expect(edges()).toHaveLength(2);
  });

  it("shows the overview before anything is selected", () => {
    expect(panelHeading()).toBe("interaction-fixture");
  });

  it("selects a zone on a real click — the pointerup+click pair", () => {
    const target = blocks().find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Core"),
    )!;
    realClick(win, target);
    expect(panelHeading()).toBe("Core");
  });

  it("keeps the zone selected when the same block is clicked again", () => {
    const target = blocks().find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Core"),
    )!;
    realClick(win, target);
    realClick(win, target);
    expect(panelHeading()).toBe("Core");
  });

  it("moves the selection between blocks", () => {
    const core = blocks().find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Core"))!;
    const api = blocks().find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Api"))!;
    realClick(win, core);
    realClick(win, api);
    expect(panelHeading()).toBe("Api");
  });

  it("shows the zone's files and dependencies in the panel", () => {
    const core = blocks().find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Core"))!;
    realClick(win, core);
    const panel = doc.querySelector("#dossier")!.innerHTML;
    expect(panel).toContain("src/core/c.ts");
    expect(panel).toContain("Imported by");
    expect(panel).toContain("Imports");
    expect(panel).toContain("cohesion");
  });

  it("selects a dependency when its connector is clicked", () => {
    realClick(win, edges()[0]);
    expect(panelHeading()).toMatch(/→/);
    expect(doc.querySelector("#dossier")!.innerHTML).toContain("cross-zone import");
  });

  it("gives every connector a widened transparent hit target", () => {
    for (const edge of edges()) {
      const hit = edge.querySelector("polyline")!;
      expect(hit.getAttribute("stroke")).toBe("transparent");
      expect(Number(hit.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(10);
    }
  });

  it("navigates to a zone from a link in the panel", () => {
    realClick(win, blocks().find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Api"))!);
    const link = doc.querySelector("#dossier [data-goto]") as HTMLElement;
    link.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(panelHeading()).not.toBe("Api");
  });

  it("clears the selection on Escape", () => {
    realClick(win, blocks()[0]);
    expect(panelHeading()).not.toBe("interaction-fixture");
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panelHeading()).toBe("interaction-fixture");
  });

  it("toggles a legend filter without disturbing the selection", () => {
    const core = blocks().find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Core"))!;
    realClick(win, core);
    const legend = doc.querySelector('.lg[data-kind="support"]') as HTMLElement;
    legend.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(legend.getAttribute("aria-pressed")).toBe("true");
    expect(panelHeading()).toBe("Core");
  });

  it("raises no script errors while loading and interacting", () => {
    const errors: string[] = [];
    win.addEventListener("error", (e) => errors.push(String((e as ErrorEvent).message)));
    realClick(win, blocks()[0]);
    realClick(win, edges()[0]);
    expect(errors).toEqual([]);
  });
});
