// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import type { LoadedData } from "../../../src/viewer/types.js";
import { Graph } from "../../../src/viewer/views/graph.js";

function makeLoadedData(overrides: Partial<LoadedData> = {}): LoadedData {
  return {
    manifest: null,
    inventory: null,
    imports: {
      edges: [
        { from: "src/a.ts", to: "src/b.ts", type: "static" as const, symbols: ["x"] },
        { from: "src/b.ts", to: "src/c.ts", type: "static" as const, symbols: [] },
      ],
      external: [{ package: "lodash", importedBy: ["src/a.ts"], symbols: ["merge"] }],
      summary: {
        totalEdges: 2,
        totalExternal: 1,
        circularCount: 0,
        circulars: [],
        mostImported: [{ path: "src/b.ts", count: 2 }],
        avgImportsPerFile: 1,
      },
    },
    zones: {
      zones: [
        {
          id: "zA",
          name: "Zone A",
          description: "",
          files: ["src/a.ts", "src/b.ts"],
          entryPoints: [],
          cohesion: 0.9,
          coupling: 0.1,
        },
        {
          id: "zB",
          name: "Zone B",
          description: "",
          files: ["src/c.ts"],
          entryPoints: [],
          cohesion: 0.8,
          coupling: 0.2,
        },
      ],
      crossings: [],
      unzoned: [],
    },
    components: null,
    callGraph: null,
    ...overrides,
  };
}

describe("Graph (Import Graph view)", () => {
  it("renders a clear scope selector and graph panel", () => {
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    expect(root.querySelector(".ig-scope-card")).not.toBeNull();
    expect(root.querySelector(".ig-zone-map")).not.toBeNull();
    expect(root.querySelector(".ig-zone-row")).toBeNull();
    expect(root.querySelector(".ig-controls")).toBeNull();
    expect(root.querySelector(".ig-type-toggles")).toBeNull();
    expect(root.querySelector("#ig-graph-panel")).not.toBeNull();
    expect(root.textContent).toContain("Codebase map");
    expect(root.querySelector(".ig-boundary-strip")?.textContent).toContain("Zone A -> Zone B");
    expect(root.textContent).toContain("Zone A");
  });

  it("zone network click refocuses the local graph without opening detail panel", async () => {
    const onSelect = vi.fn();
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect }), root);
    const zoneBtn = [...root.querySelectorAll(".ig-zone-map-node")].find((b) => b.textContent?.includes("Zone B"));
    expect(zoneBtn).toBeTruthy();
    (zoneBtn as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-zone-network-node")).not.toBeNull();
    });
    (root.querySelector(".ig-zone-network-node") as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("Driven by file: c.ts");
      expect(root.querySelector("#ig-graph-panel")?.className).toContain("ig-street-view-dialog");
      expect(root.querySelector(".ig-street-detail")?.textContent).toContain("src/c.ts");
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes file street view when clicking the zone map background", async () => {
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    const zoneBtn = [...root.querySelectorAll(".ig-zone-map-node")].find((b) => b.textContent?.includes("Zone B"));
    expect(zoneBtn).toBeTruthy();
    (zoneBtn as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-zone-network-node")).not.toBeNull();
    });
    (root.querySelector(".ig-zone-network-node") as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector("#ig-graph-panel")?.className).toContain("ig-street-view-dialog");
    });
    (root.querySelector(".ig-zone-network-bg") as SVGRectElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector("#ig-graph-panel")?.className).toContain("ig-street-view-closed");
    });
  });

  it("shows loading when imports are missing", () => {
    const root = document.createElement("div");
    const data = makeLoadedData({ imports: null });
    render(h(Graph, { data, onSelect: vi.fn() }), root);
    expect(root.textContent).toContain("No import data");
  });

  it("renders summary stats and focused graph when imports exist", async () => {
    const root = document.createElement("div");
    const data = makeLoadedData();
    render(h(Graph, { data, onSelect: vi.fn() }), root);
    expect(root.textContent).toContain("Map");
    expect(root.textContent).toContain("2 imports");
    expect(root.textContent).toContain("1packages");
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-node-file")).not.toBeNull();
    });
    expect(root.querySelector("#ig-graph-panel")?.textContent).toContain("src");
  });

  it("zone selection updates visible candidates without opening detail panel", async () => {
    const onSelect = vi.fn();
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect }), root);
    const zoneBtn = [...root.querySelectorAll(".ig-zone-map-node")].find((b) => b.textContent?.includes("Zone B"));
    expect(zoneBtn).toBeTruthy();
    (zoneBtn as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("Driven by zone: Zone B");
    });
    expect(root.querySelector(".ig-codebase-mini")?.textContent).toContain("Zone B");
    expect(root.querySelector(".ig-zone-overview")?.textContent).toContain("Zone B");
    expect(root.querySelector(".ig-zone-overview-kicker")?.textContent).toContain("Zone map");
    expect(root.textContent).toContain("Map of Zone:");
    expect(root.textContent).not.toContain("Filtered to Zone B");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("expands the codebase map only on upward wheel intent at the top", async () => {
    const root = document.createElement("div");
    root.className = "main";
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    const zoneBtn = [...root.querySelectorAll(".ig-zone-map-node")].find((b) => b.textContent?.includes("Zone A"));
    expect(zoneBtn).toBeTruthy();
    (zoneBtn as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-codebase-morph")?.className).toContain("ig-codebase-morph-mini");
    });
    root.scrollTop = 200;
    root.dispatchEvent(new Event("scroll"));
    root.scrollTop = 100;
    root.dispatchEvent(new Event("scroll"));
    expect(root.querySelector(".ig-codebase-morph")?.className).toContain("ig-codebase-morph-mini");
    root.scrollTop = 0;
    root.querySelector(".ig-page")?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -20 }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-codebase-morph")?.className).toContain("ig-codebase-morph-full");
      expect(root.querySelector(".ig-zone-overview")?.textContent).toContain("Zone A");
    });
    root.querySelector(".ig-page")?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 20 }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-codebase-morph")?.className).toContain("ig-codebase-morph-mini");
    });
  });

  it("recenters the file street view when the focused graph changes", async () => {
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    const svg = root.querySelector(".ig-graph-column .ig-svg-wrap svg") as SVGSVGElement;
    expect(svg).toBeTruthy();
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-chip")?.textContent).toBeTruthy();
    });
    svg.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-graph-column .ig-svg-wrap svg > g[transform]")?.getAttribute("transform")).toContain("translate(0 -40)");
    }, { timeout: 3000 });
    const zoneBtn = [...root.querySelectorAll(".ig-zone-map-node")].find((b) => b.textContent?.includes("Zone B"));
    expect(zoneBtn).toBeTruthy();
    (zoneBtn as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-graph-column .ig-svg-wrap svg > g[transform]")?.getAttribute("transform")).toBe("translate(0 0) scale(1)");
    }, { timeout: 3000 });
  });

  it("supports back and forward through clicked dependency preview nodes", async () => {
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-node-file[title='src/a.ts']")).not.toBeNull();
    });
    (root.querySelector(".ig-node-file[title='src/a.ts']") as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("src/a.ts");
    });
    const buttons = [...root.querySelectorAll(".ig-preview-history-btn")] as HTMLButtonElement[];
    buttons[0].click();
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("src/b.ts");
    }, { timeout: 3000 });
    buttons[1].click();
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("src/a.ts");
    }, { timeout: 3000 });
  });

  it("shows external zones that touch cross-boundary imports", async () => {
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    const zoneBtn = [...root.querySelectorAll(".ig-zone-map-node")].find((b) => b.textContent?.includes("Zone A"));
    expect(zoneBtn).toBeTruthy();
    (zoneBtn as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-zone-external-node rect")).not.toBeNull();
      expect(root.querySelector(".ig-zone-network-file-box")).not.toBeNull();
      expect(root.querySelector(".ig-zone-network-boundary-pin")).not.toBeNull();
    });
    (root.querySelector(".ig-zone-network-node") as SVGGElement).dispatchEvent(new Event("pointerenter", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-zone-network-edge-external path")).not.toBeNull();
      expect(root.querySelector(".ig-zone-overview")?.textContent).toContain("Zone B");
      expect(root.querySelector(".ig-graph-scope")?.textContent).toContain("cross-boundary");
      expect(root.querySelector(".ig-edge-labels")?.textContent).toContain("Zone A -> Zone B");
    });
  });

  it("navigates to files view on double-click of a node", async () => {
    const navigateTo = vi.fn();
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn(), navigateTo }), root);
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-node-file")).not.toBeNull();
    });
    const node = root.querySelector(".ig-node-file");
    node!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(navigateTo).toHaveBeenCalledWith("files", { file: expect.any(String) });
  });
});
