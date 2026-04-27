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
  it("defaults to explore with sortable file table", () => {
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    expect(root.querySelector("#ig-tab-explore")?.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector(".ig-table-row-click")).not.toBeNull();
    expect(root.textContent).toContain("src/a.ts");
  });

  it("explore row click switches to file graph and selects file", async () => {
    const onSelect = vi.fn();
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect }), root);
    const row = [...root.querySelectorAll(".ig-table-row-click")].find((r) => r.textContent?.includes("src/c.ts"));
    expect(row).toBeTruthy();
    (row as HTMLElement).click();
    await vi.waitFor(() => {
      expect((root.querySelector("#ig-tab-graph") as HTMLButtonElement).getAttribute("aria-selected")).toBe("true");
    });
    expect(onSelect).toHaveBeenCalled();
    expect(onSelect.mock.calls.some((c) => c[0]?.path === "src/c.ts")).toBe(true);
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
    expect(root.textContent).toContain("Import Graph");
    expect(root.textContent).toContain("2 edges");
    expect(root.textContent).toContain("1 package");
    const graphTab = root.querySelector("#ig-tab-graph") as HTMLButtonElement | null;
    expect(graphTab).not.toBeNull();
    graphTab!.click();
    await vi.waitFor(() => {
      expect(root.querySelector("svg")).not.toBeNull();
    });
    expect(root.textContent).toContain("src/b.ts");
  });

  it("calls onSelect when a hub list entry is clicked", async () => {
    const onSelect = vi.fn();
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect }), root);
    (root.querySelector("#ig-tab-graph") as HTMLButtonElement).click();
    await vi.waitFor(() => root.querySelector(".ig-list button"));
    const buttons = root.querySelectorAll(".ig-list button");
    const hubBtn = [...buttons].find((b) => b.textContent?.includes("src/b.ts"));
    expect(hubBtn).toBeTruthy();
    (hubBtn as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalled();
    const arg = onSelect.mock.calls[0][0];
    expect(arg.type).toBe("file");
    expect(arg.path).toBe("src/b.ts");
  });

  it("navigates to files view on double-click of a node", async () => {
    const navigateTo = vi.fn();
    const root = document.createElement("div");
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn(), navigateTo }), root);
    (root.querySelector("#ig-tab-graph") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-node-file")).not.toBeNull();
    });
    const node = root.querySelector(".ig-node-file");
    node!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(navigateTo).toHaveBeenCalledWith("files", { file: expect.any(String) });
  });
});
