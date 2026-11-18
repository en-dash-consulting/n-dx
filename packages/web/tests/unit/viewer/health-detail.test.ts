// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { HealthDetail } from "../../../src/viewer/views/overview.js";
import type { LoadedData } from "../../../src/viewer/types.js";

const zone = (id: string, files: number, cohesion: number, coupling: number) => ({
  id, name: id, description: `${id} zone`, files: Array.from({ length: files }, (_, i) => `${id}/f${i}.cs`), entryPoints: [], cohesion, coupling,
});

const data = {
  manifest: null, components: null,
  inventory: { files: [{ path: "App_Code/SecurePage.cs", language: "C#", lineCount: 40, size: 1, hash: "h", role: "source", category: "x", lastModified: 0 }], summary: { totalFiles: 30, totalLines: 900, byLanguage: {}, byRole: {}, byCategory: {} } },
  imports: { edges: [], external: [], summary: {
    totalEdges: 0, totalExternal: 0, circularCount: 1, avgImportsPerFile: 0,
    circulars: [{ cycle: ["a.cs", "b.cs"] }],
    mostImported: [{ path: "App_Code/SecurePage.cs", count: 169 }],
  } },
  zones: { zones: [zone("core", 20, 0.3, 0.7), zone("admin", 10, 0.9, 0.1)], crossings: [], unzoned: [] },
} as unknown as LoadedData;

let root: HTMLElement | undefined;
afterEach(() => { if (root) { act(() => { render(null, root!); }); root.remove(); } });

function show(openTile = vi.fn(), setDetail = vi.fn()) {
  root = document.createElement("div");
  // In the document, so a stat card can take focus.
  document.body.appendChild(root);
  act(() => { render(h(HealthDetail, { data, openTile, setDetail }), root!); });
  return { el: root, openTile, setDetail };
}

describe("HealthDetail", () => {
  it("switches the modal to the Files and Zones tiles from their stat cards", () => {
    const { el, openTile } = show();
    const cards = [...el.querySelectorAll<HTMLButtonElement>(".overview-stat-open")];
    act(() => cards.find((c) => c.getAttribute("aria-label")!.startsWith("Files"))!.click());
    expect(openTile).toHaveBeenLastCalledWith("files");
    act(() => cards.find((c) => c.getAttribute("aria-label")!.startsWith("Zones"))!.click());
    expect(openTile).toHaveBeenLastCalledWith("zones");
  });

  it("makes Avg cohesion a filter toggle and lights the zones it flags while hovered", () => {
    const { el, openTile } = show();
    const cohesion = [...el.querySelectorAll<HTMLButtonElement>(".overview-stat-open")]
      .find((c) => c.getAttribute("aria-label")!.startsWith("Avg cohesion"))!;
    expect(cohesion.getAttribute("aria-pressed")).toBe("false");
    act(() => cohesion.click());
    expect(openTile).not.toHaveBeenCalled();
    expect(cohesion.getAttribute("aria-pressed")).toBe("true");
    act(() => { cohesion.focus(); });
    expect(el.querySelector(".health-table tbody tr")?.className).toBe("health-row--lit");
  });

  it("lists only the zones needing attention, and opens one's detail", () => {
    const { el, setDetail } = show();
    const zones = [...el.querySelectorAll<HTMLButtonElement>(".health-table .health-link")];
    expect(zones.map((z) => z.textContent)).toEqual(["core"]);
    act(() => zones[0]!.click());
    expect(setDetail).toHaveBeenCalledWith(expect.objectContaining({ type: "zone", id: "core", cohesion: "0.30", coupling: "0.70", files: 20 }));
  });

  it("lists hub files and cycles, opening a file's detail", () => {
    const { el, setDetail } = show();
    expect(el.querySelector("#health-hubs")?.parentElement?.textContent).toContain("169 importers");
    expect(el.querySelector(".health-cycles")?.textContent).toBe("a.cs → b.cs");
    act(() => el.querySelector<HTMLButtonElement>(".health-list .health-file")!.click());
    expect(setDetail).toHaveBeenCalledWith(expect.objectContaining({ type: "file", path: "App_Code/SecurePage.cs", lines: 40 }));
  });
});
