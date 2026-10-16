// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { analyzeTileSummary } from "../../../src/viewer/views/tile-summaries.js";
import { ENRICHMENT_THRESHOLDS } from "../../../src/viewer/views/enrichment-thresholds.js";
import type { LoadedData } from "../../../src/viewer/types.js";
import type { StageTile } from "../../../src/viewer/views/stages.js";

const zone = (id: string, files: number, cohesion = 0.8, coupling = 0.2) => ({
  id, name: id, description: "", files: Array.from({ length: files }, (_, i) => `${id}/f${i}.ts`),
  entryPoints: [], cohesion, coupling,
});

function data(over: Partial<{ pass: number; findings: unknown[]; zones: unknown[] }> = {}): LoadedData {
  return {
    manifest: null,
    inventory: {
      files: [],
      summary: { totalFiles: 1766, totalLines: 412_000, byLanguage: {}, byRole: { source: 1500, test: 200, config: 66 }, byCategory: {} },
    },
    imports: { edges: [], external: [], summary: { totalEdges: 0, totalExternal: 0, circularCount: 3, circulars: [], mostImported: [], avgImportsPerFile: 0 } },
    zones: {
      zones: over.zones ?? [zone("core", 60, 0.3, 0.7), zone("admin", 30), zone("reports", 10)],
      crossings: [],
      unzoned: [],
      enrichmentPass: over.pass ?? 4,
      findings: over.findings ?? [
        { type: "anti-pattern", pass: 3, scope: "core", text: "Handlers skip auth", severity: "critical" },
        { type: "anti-pattern", pass: 3, scope: "core", text: "God page", severity: "warning" },
        { type: "anti-pattern", pass: 3, scope: "core", text: "Minor", severity: "info" },
        { type: "anti-pattern", pass: 3, scope: "core", text: "Another warning", severity: "warning" },
        { type: "suggestion", pass: 4, scope: "global", text: "Extract a base handler", severity: "info" },
        { type: "pattern", pass: 2, scope: "global", text: "Page base class everywhere", severity: "info" },
      ],
    },
    components: null,
  } as unknown as LoadedData;
}

let root: HTMLElement | undefined;
function show(tile: StageTile, d: LoadedData): HTMLElement {
  root = document.createElement("div");
  render(h("div", null, analyzeTileSummary(tile, d)), root);
  return root;
}

afterEach(() => {
  if (root) render(null, root);
  vi.unstubAllGlobals();
});

describe("analyzeTileSummary", () => {
  it("summarises Problems as severity counts and the three worst findings", () => {
    const el = show({ view: "problems" }, data());
    expect([...el.querySelectorAll(".tile-sum-chip")].map((c) => c.textContent)).toEqual(["1 critical", "2 warning", "1 info"]);
    expect([...el.querySelectorAll(".tile-sum-item")].map((i) => i.textContent)).toEqual(["Handlers skip auth", "God page", "Another warning"]);
  });

  it("counts only the findings its view counts", () => {
    const el = show({ view: "suggestions" }, data());
    expect([...el.querySelectorAll(".tile-sum-item")].map((i) => i.textContent)).toEqual(["Extract a base handler"]);
  });

  it("names the enrichment pass a gated view still needs", () => {
    const el = show({ view: "problems" }, data({ pass: ENRICHMENT_THRESHOLDS.problems - 1 }));
    expect(el.textContent).toContain(`Needs enrichment pass ${ENRICHMENT_THRESHOLDS.problems}`);
  });

  it("says so in one line when there is nothing to show", () => {
    expect(show({ view: "problems" }, data({ findings: [] })).textContent).toBe("No problems found.");
    expect(show({ view: "zones" }, data({ zones: [] })).textContent).toBe("No zones loaded.");
  });

  it("summarises Zones by count, attention, cycles and the largest zones' share", () => {
    const el = show({ view: "zones" }, data());
    expect([...el.querySelectorAll(".tile-sum-chip")].map((c) => c.textContent)).toEqual(["3 zones", "1 need attention", "3 import cycles"]);
    expect([...el.querySelectorAll(".tile-sum-bar-label")].map((l) => l.textContent)).toEqual(["core", "admin", "reports"]);
    expect(el.querySelector(".tile-sum-bar-value")?.textContent).toBe("60%");
  });

  it("summarises Files by totals and roles", () => {
    const el = show({ view: "files" }, data());
    expect(el.querySelector(".tile-sum-headline")?.textContent).toBe("1,766 files · 412k lines");
    expect([...el.querySelectorAll(".tile-sum-chip")].map((c) => c.textContent)).toEqual(["1,500 source", "200 test", "66 config"]);
  });

  it("leaves panels and views without a summary to the tile", () => {
    expect(analyzeTileSummary({ view: "suggestions", panel: "next-steps" }, data())).toBeNull();
    expect(analyzeTileSummary({ view: "ask" }, data())).toBeNull();
  });

  it("starts no request of its own", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const view of ["problems", "suggestions", "zones", "files", "architecture"] as const) show({ view }, data());
    expect(fetch).not.toHaveBeenCalled();
  });
});
