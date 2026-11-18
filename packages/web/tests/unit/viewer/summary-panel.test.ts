// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { SummaryPanel } from "../../../src/viewer/views/summary-panel.js";
import type { LoadedData } from "../../../src/viewer/types.js";

const zone = (id: string, files: number, cohesion = 0.8, coupling = 0.2) => ({
  id, name: id, description: "", files: Array.from({ length: files }, (_, i) => `${id}/f${i}.ts`),
  entryPoints: [], cohesion, coupling,
});

function data(over: Partial<{ pass: number; findings: unknown[]; zones: unknown[] }> = {}): LoadedData {
  return {
    manifest: null,
    inventory: {
      files: [],
      summary: { totalFiles: 1766, totalLines: 412_000, byLanguage: { TypeScript: 1500, JavaScript: 200, JSON: 66 }, byRole: { source: 1500, test: 200, config: 66 }, byCategory: {} },
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
function show(d: LoadedData, opened = false): HTMLElement {
  root = document.createElement("div");
  render(h(SummaryPanel, { data: d, opened }), root);
  return root;
}

afterEach(() => {
  if (root) render(null, root);
  vi.unstubAllGlobals();
});

describe("SummaryPanel", () => {
  it("leads with the totals: files, lines, zones and languages", () => {
    expect(show(data()).querySelector(".tile-sum-headline")?.textContent).toBe("1,766 files · 412k lines · 3 zones · 3 languages");
  });

  it("draws the languages as a pie, each slice with its share", () => {
    const el = show(data());
    expect(el.querySelectorAll(".lang-pie-chart circle[stroke-dasharray]")).toHaveLength(3);
    expect([...el.querySelectorAll(".lang-pie-legend li")].map((li) => li.textContent)).toEqual(["TypeScript85%", "JavaScript11%", "JSON4%"]);
  });

  it("summarises Zones by count, attention, cycles and the largest zones' share, marking a zone with issues", () => {
    const el = show(data());
    expect([...el.querySelectorAll(".tile-sum-chip")].map((c) => c.textContent)).toEqual(["3 zones", "1 need attention", "3 import cycles"]);
    const zones = el.querySelector('[aria-label="Largest zones"]')!;
    expect([...zones.querySelectorAll(".tile-sum-bar-label")].map((l) => l.textContent)).toEqual(["!core", "admin", "reports"]);
    expect(zones.querySelector(".tile-sum-bar-value")?.textContent).toBe("60%");
  });

  it("summarises files by role", () => {
    const roles = show(data()).querySelector('[aria-label="Files by role"] ul, ul[aria-label="Files by role"]')!;
    const bars = [...roles.querySelectorAll(".tile-sum-bar")].map((b) => [b.querySelector(".tile-sum-bar-label")?.textContent, b.querySelector(".tile-sum-bar-value")?.textContent]);
    expect(bars).toEqual([["source", "1,500"], ["test", "200"], ["config", "66"]]);
  });

  it("says so in one line when there are no zones", () => {
    expect(show(data({ zones: [] })).querySelector(".tile-sum-empty")?.textContent).toBe("No zones loaded.");
  });

  it("opened, shows every language in a table beside the pie, and every role", () => {
    const el = show(data(), true);
    expect([...el.querySelectorAll(".languages-table tbody tr")].map((r) => r.querySelector("td")?.textContent)).toEqual(["TypeScript", "JavaScript", "JSON"]);
    expect(el.querySelector(".lang-pie-chart")).not.toBeNull();
  });

  it("starts no request of its own", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    show(data());
    show(data(), true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
