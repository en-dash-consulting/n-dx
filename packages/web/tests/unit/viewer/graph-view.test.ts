// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
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
  // Track every rendered root so we can unmount the Preact tree after each
  // test. Without this, useEffect flush timers stay scheduled past the file's
  // jsdom teardown; a late flush falls back to a setTimeout that calls
  // cancelAnimationFrame (gone after teardown), surfacing as an unhandled
  // ReferenceError. See sidebar.test.ts for the same cleanup pattern.
  const roots: HTMLElement[] = [];
  function newRoot(): HTMLElement {
    const root = document.createElement("div");
    roots.push(root);
    return root;
  }

  /**
   * Click a dependency-preview history button once it is actually enabled.
   *
   * `canGoBack`/`canGoForward` come from focus-history state pushed by a
   * chained effect, so the button can still be `disabled` at the moment the
   * focus detail first shows the new file. Clicking a disabled button is a
   * silent no-op that never re-renders — the test then waits out its full
   * timeout. Re-querying (rather than caching the node list) also survives
   * Preact replacing the element. Both make the click deterministic instead
   * of dependent on how fast effects flush on a loaded machine.
   */
  async function clickHistoryButton(root: HTMLElement, label: "Back" | "Forward"): Promise<void> {
    let button: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      button = ([...root.querySelectorAll(".ig-preview-history-btn")] as HTMLButtonElement[])
        .find((b) => b.textContent?.trim() === label);
      expect(button, `${label} button should be present`).toBeTruthy();
      expect(button!.disabled, `${label} button should be enabled`).toBe(false);
    }, { timeout: 3000 });
    button!.click();
  }

  afterEach(() => {
    for (const root of roots) {
      render(null, root);
      root.parentNode?.removeChild(root);
    }
    roots.length = 0;
  });

  it("renders a clear scope selector and graph panel", () => {
    const root = newRoot();
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    expect(root.querySelector(".ig-scope-card")).not.toBeNull();
    expect(root.querySelector(".ig-zone-map")).not.toBeNull();
    expect(root.querySelector(".ig-zone-row")).toBeNull();
    expect(root.querySelector(".ig-controls")).toBeNull();
    expect(root.querySelector(".ig-type-toggles")).toBeNull();
    expect(root.querySelector("#ig-graph-panel")).not.toBeNull();
    expect(root.textContent).toContain("Codebase map");
    // The visual "->" arrow is aria-hidden with an sr-only "imports into"
    // alternative, so match the route parts rather than the raw glyph.
    const boundaryRoute = root.querySelector(".ig-boundary-route")?.textContent ?? "";
    expect(boundaryRoute).toContain("Zone A");
    expect(boundaryRoute).toContain("Zone B");
    expect(boundaryRoute).toContain("imports into");
    expect(root.textContent).toContain("Zone A");
  });

  it("zone network click refocuses the local graph without opening detail panel", async () => {
    const onSelect = vi.fn();
    const root = newRoot();
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
    const root = newRoot();
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
    const root = newRoot();
    const data = makeLoadedData({ imports: null });
    render(h(Graph, { data, onSelect: vi.fn() }), root);
    expect(root.textContent).toContain("No import data");
  });

  it("renders summary stats and focused graph when imports exist", async () => {
    const root = newRoot();
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
    const root = newRoot();
    render(h(Graph, { data: makeLoadedData(), onSelect }), root);
    const zoneBtn = [...root.querySelectorAll(".ig-zone-map-node")].find((b) => b.textContent?.includes("Zone B"));
    expect(zoneBtn).toBeTruthy();
    (zoneBtn as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("Driven by zone: Zone B");
    });
    expect(root.querySelector(".ig-codebase-mini")?.textContent).toContain("Zone B");
    // The per-zone "Map of Zone" header is now the page-level atlas hero —
    // the redundant in-panel header was removed and the active zone name
    // lives in the hero h2 above. The .ig-zone-overview-kicker selector is
    // gone with the header; if you need it back, restore the per-zone head.
    expect(root.querySelector(".ig-atlas-hero")?.textContent).toContain("Zone B");
    expect(root.textContent).toContain("Map of Zone:");
    expect(root.textContent).not.toContain("Filtered to Zone B");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("expands the codebase map only on upward wheel intent at the top", async () => {
    const root = newRoot();
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
    // Re-dispatch inside the wait: the wheel listener is attached by an effect,
    // so an event sent before it lands is simply lost. Repeating an
    // already-satisfied intent is a no-op, so retrying converges.
    await vi.waitFor(() => {
      root.querySelector(".ig-page")?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -20 }));
      expect(root.querySelector(".ig-codebase-morph")?.className).toContain("ig-codebase-morph-full");
      // Zone name lives in the atlas hero now, not the in-panel header.
      expect(root.querySelector(".ig-atlas-hero")?.textContent).toContain("Zone A");
    });
    await vi.waitFor(() => {
      root.querySelector(".ig-page")?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 20 }));
      expect(root.querySelector(".ig-codebase-morph")?.className).toContain("ig-codebase-morph-mini");
    });
  });

  it("recenters the file street view when the focused graph changes", async () => {
    const root = newRoot();
    // act() so the mount's deferred effect chain settles BEFORE the pan.
    //
    // Graph picks a default focus file in an effect, and a second effect resets
    // the dependency viewport whenever focusFile changes. Preact runs useEffect
    // after paint, so there is a window where the DOM already shows the
    // auto-selected file while that reset has not run yet. Panning inside that
    // window applied correctly and was then wiped — traced as
    // reset(null) -> pan(0 -> -40) -> reset("src/b.ts"). Waiting on a DOM signal
    // cannot close the window, because the DOM is what updates first.
    act(() => {
      render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    });
    const svg = root.querySelector(".ig-graph-column .ig-svg-wrap svg") as SVGSVGElement;
    expect(svg).toBeTruthy();
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-chip")?.textContent).toBeTruthy();
    });
    // One gesture, exact assertion — no retry loop. The act() around the render
    // above already flushed the view-reset effect, so the window this test used to
    // race against is closed rather than tolerated. Retrying the wheel would still
    // pass, but it can only assert "some positive multiple of 40", which no longer
    // distinguishes one correct pan from three.
    //
    // The pan is deltaY 40 against a viewBox of "0 0 778 460": panViewport adds
    // -deltaY, and clampMapView's y bounds are [h*0.2 - k*h, h*0.8] = [-368, 368]
    // at k=1, so -40 passes through unclamped and the transform is exactly -40.
    act(() => {
      svg.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 }));
    });
    await vi.waitFor(() => {
      const transform = root.querySelector(".ig-graph-column .ig-svg-wrap svg > g[transform]")?.getAttribute("transform") ?? "";
      expect(transform, `expected an exact -40 vertical pan, got "${transform}"`)
        .toMatch(/^translate\(0 -40\)/);
    }, { timeout: 3000 });
    const zoneBtn = [...root.querySelectorAll(".ig-zone-map-node")].find((b) => b.textContent?.includes("Zone B"));
    expect(zoneBtn).toBeTruthy();
    (zoneBtn as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-graph-column .ig-svg-wrap svg > g[transform]")?.getAttribute("transform")).toBe("translate(0 0) scale(1)");
    }, { timeout: 3000 });
  });

  it("supports back and forward through clicked dependency preview nodes", async () => {
    const root = newRoot();
    // Same deferred-effect hazard as the recenter test above, with a different
    // symptom: focus history is seeded in an effect, so until it flushes the Back
    // button is still rendered `disabled` and clicking it silently does nothing —
    // leaving a.ts selected and failing on the missing src/b.ts.
    act(() => {
      render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn() }), root);
    });
    // Then wait for the initial auto-focus (src/b.ts — the most-imported file) to
    // land before navigating. Going Back requires a previous entry: clicking a.ts
    // before anything is focused correctly leaves Back disabled, so asserting
    // "Back returns to b.ts" without establishing that focus first is a race, not
    // a product bug. act() flushes the effects; this pins the state they produced.
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("src/b.ts");
    });
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-node-file[title='src/a.ts']")).not.toBeNull();
    });
    act(() => {
      (root.querySelector(".ig-node-file[title='src/a.ts']") as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("src/a.ts");
    });
    // clickHistoryButton rather than indexing the button list: it selects by label,
    // waits for the button to be enabled before clicking, and re-queries so it
    // survives Preact replacing the node. All three matter here — a disabled
    // button's click is a silent no-op, and index 0/1 is the fragile part of the
    // assertion, not the part being tested.
    await clickHistoryButton(root, "Back");
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("src/b.ts");
    }, { timeout: 3000 });
    await clickHistoryButton(root, "Forward");
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-focus-detail")?.textContent).toContain("src/a.ts");
    }, { timeout: 3000 });
  });

  it("shows external zones that touch cross-boundary imports", async () => {
    const root = newRoot();
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
      // Zone B appears here as an external-zone label inside the zone SVG —
      // this assertion is about the OTHER zone surfacing on hover, not the
      // active zone (which is Zone A and lives in the atlas hero h2).
      expect(root.querySelector(".ig-zone-overview")?.textContent).toContain("Zone B");
      expect(root.querySelector(".ig-graph-scope")?.textContent).toContain("cross-boundary");
      // Edge labels now use a Unicode arrow.
      expect(root.querySelector(".ig-edge-labels")?.textContent).toContain("Zone A → Zone B");
    });
  });

  it("navigates to files view on double-click of a node", async () => {
    const navigateTo = vi.fn();
    const root = newRoot();
    render(h(Graph, { data: makeLoadedData(), onSelect: vi.fn(), navigateTo }), root);
    await vi.waitFor(() => {
      expect(root.querySelector(".ig-node-file")).not.toBeNull();
    });
    const node = root.querySelector(".ig-node-file");
    node!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(navigateTo).toHaveBeenCalledWith("files", { file: expect.any(String) });
  });
});
