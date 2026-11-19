// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { HealthDetail } from "../../../src/viewer/views/overview.js";
import { GlancePanel } from "../../../src/viewer/views/glance.js";
import type { LoadedData } from "../../../src/viewer/types.js";

const zone = (id: string, files: number, cohesion: number, coupling: number) => ({
  id, name: id, description: `${id} zone`, files: Array.from({ length: files }, (_, i) => `${id}/f${i}.cs`), entryPoints: [], cohesion, coupling,
});

const data = {
  manifest: null, components: null,
  inventory: { files: [{ path: "App_Code/SecurePage.cs", language: "C#", lineCount: 40, size: 1, hash: "h", role: "source", category: "x", lastModified: 0 }], summary: { totalFiles: 30, totalLines: 900, byLanguage: { "C#": 30 }, byRole: {}, byCategory: {} } },
  imports: { edges: [], external: [], summary: {
    totalEdges: 0, totalExternal: 0, circularCount: 1, avgImportsPerFile: 0,
    circulars: [{ cycle: ["a.cs", "b.cs"] }],
    mostImported: [{ path: "App_Code/SecurePage.cs", count: 169 }],
  } },
  zones: { zones: [zone("core", 20, 0.3, 0.7), zone("admin", 10, 0.9, 0.1)], crossings: [], unzoned: [] },
} as unknown as LoadedData;

let root: HTMLElement | undefined;
afterEach(() => {
  if (root) { act(() => { render(null, root!); }); root.remove(); }
  vi.unstubAllGlobals();
});

function show(tree: ReturnType<typeof h>) {
  root = document.createElement("div");
  // In the document, so a stat card can take focus and a section be found by id.
  document.body.appendChild(root);
  act(() => { render(tree, root!); });
  return root;
}

describe("HealthDetail", () => {
  it("lists only the zones needing attention, and opens one's detail", () => {
    const setDetail = vi.fn();
    const el = show(h(HealthDetail, { data, setDetail }));
    const zones = [...el.querySelectorAll<HTMLButtonElement>(".health-table .health-link")];
    expect(zones.map((z) => z.textContent)).toEqual(["core"]);
    act(() => zones[0]!.click());
    expect(setDetail).toHaveBeenCalledWith(expect.objectContaining({ type: "zone", id: "core", cohesion: "0.30", coupling: "0.70", files: 20 }));
  });

  it("lists hub files and cycles, opening a file's detail", () => {
    const setDetail = vi.fn();
    const el = show(h(HealthDetail, { data, setDetail }));
    expect(el.querySelector("#health-hubs")?.parentElement?.textContent).toContain("169 importers");
    expect(el.querySelector(".health-cycles")?.textContent).toBe("a.cs → b.cs");
    act(() => el.querySelector<HTMLButtonElement>(".health-list .health-file")!.click());
    expect(setDetail).toHaveBeenCalledWith(expect.objectContaining({ type: "file", path: "App_Code/SecurePage.cs", lines: 40 }));
  });
});

describe("GlancePanel, opened", () => {
  it("leads each stat card to the section that explains it, without filtering anything", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const scrolled: string[] = [];
    const scroll = vi.fn(function (this: HTMLElement) { scrolled.push(this.id); });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scroll, configurable: true });
    try {
      const el = show(h(GlancePanel, { data, opened: true, setDetail: vi.fn() }));
      const card = (label: string) => [...el.querySelectorAll<HTMLButtonElement>(".overview-stat-open")]
        .find((c) => c.getAttribute("aria-label")!.startsWith(label))!;
      expect(card("Avg cohesion").getAttribute("aria-pressed")).toBeNull();
      act(() => card("Avg cohesion").click());
      act(() => card("Circular deps").click());
      act(() => card("Files").click());
      expect(scrolled).toEqual(["health-attention", "health-cycles", "summary-languages"]);
      // The detail the cards summarise, then every language.
      expect(el.querySelector(".health-table")).not.toBeNull();
      expect(el.querySelector(".languages-table")).not.toBeNull();
      expect(el.querySelector(".health-actions")).toBeNull();
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
