// @vitest-environment jsdom
/**
 * The Analysis page while its analysis is still being read. The manifest and
 * zones load first; the inventory and import graph follow in the background.
 * Until they have been read, a missing graph or inventory may only be on its
 * way, so the page says it is loading instead of "Getting Started: complete
 * the analysis" or "No inventory loaded". Once loading finishes and finds
 * nothing, those empty states show as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ANALYSIS_LOADING, Overview } from "../../../src/viewer/views/overview.js";
import { GlancePanel } from "../../../src/viewer/views/glance.js";
import type { LoadedData } from "../../../src/viewer/types.js";
import type { JobTray } from "../../../src/viewer/hooks/index.js";

vi.mock("../../../src/viewer/performance/index.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isFeatureDisabled: () => false,
  onDegradationChange: () => () => {},
}));

const manifest = {
  schemaVersion: "1.0.0",
  toolVersion: "0.1.0",
  analyzedAt: "2026-10-21T00:00:00.000Z",
  targetPath: "/repo",
  modules: {},
};

/** What the page holds once the manifest and zones are read and the rest is not. */
const firstPaint = {
  manifest, inventory: null, imports: null, components: null, callGraph: null,
  zones: { zones: [{ id: "core", name: "core", description: "", files: ["a.ts"], entryPoints: [], cohesion: 1, coupling: 0 }], crossings: [], unzoned: [] },
} as unknown as LoadedData;

const jobs = {} as unknown as JobTray;

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});
afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

function show(tree: ReturnType<typeof h>): HTMLElement {
  act(() => { render(tree, root); });
  return root;
}

describe("Analysis lead while the analysis loads", () => {
  it("says it is loading, and shows no Getting Started", () => {
    const el = show(h(Overview, { data: firstPaint, jobs, variant: "lead", loading: true }));
    expect(el.querySelector("[role=status]")?.textContent).toBe(ANALYSIS_LOADING);
    expect(el.textContent).not.toContain("Getting Started");
    expect(el.querySelector(".getting-started")).toBeNull();
  });

  it("shows Getting Started once loading finishes with no import graph", () => {
    const el = show(h(Overview, { data: firstPaint, jobs, variant: "lead", loading: false }));
    expect(el.querySelector(".getting-started h3")?.textContent).toBe("Getting Started");
    expect(el.textContent).not.toContain(ANALYSIS_LOADING);
  });
});

describe("Codebase at a glance while the analysis loads", () => {
  it("says it is loading, with no 'No inventory loaded' and no zeroed cards", () => {
    const el = show(h(GlancePanel, { data: firstPaint, loading: true }));
    expect(el.querySelector("[role=status]")?.textContent).toBe(ANALYSIS_LOADING);
    expect(el.textContent).not.toContain("No inventory loaded");
    expect(el.querySelector(".overview-stat")).toBeNull();
  });

  it("shows its empty states once loading finishes with no inventory", () => {
    const el = show(h(GlancePanel, { data: firstPaint, loading: false }));
    expect(el.textContent).toContain("No inventory loaded.");
    expect(el.textContent).not.toContain(ANALYSIS_LOADING);
  });
});

describe("useAppData's analysisLoading", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("stays true after the first paint until the background modules have been read", async () => {
    let releaseInventory: (() => void) | null = null;
    const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const path = input.split("?")[0]!;
      if (path === "/data") return json(200, { files: ["manifest.json"] });
      if (path === "/data/manifest.json") return json(200, manifest);
      // The inventory answers only when the test says so.
      if (path === "/data/inventory.json") return new Promise((resolve) => { releaseInventory = () => resolve(json(404, {})); });
      if (path === "/data/status") return json(200, { mtimes: {} });
      return json(404, {});
    }));
    vi.resetModules();
    const { useAppData } = await import("../../../src/viewer/hooks/use-app-data.js");
    function Harness() {
      const { loading, analysisLoading } = useAppData();
      return h("span", { id: "state" }, `${loading ? "loading" : "ready"}|${analysisLoading ? "analysis-loading" : "analysis-ready"}`);
    }
    const state = () => root.querySelector("#state")?.textContent;
    await act(async () => { render(h(Harness, null), root); });
    expect(state()).toBe("loading|analysis-loading");

    // The manifest is in and the background read has started: the shell is ready, the analysis is not.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(state()).toBe("ready|analysis-loading");
    expect(releaseInventory).not.toBeNull();

    await act(async () => { releaseInventory!(); await vi.advanceTimersByTimeAsync(0); });
    expect(state()).toBe("ready|analysis-ready");
  });
});
