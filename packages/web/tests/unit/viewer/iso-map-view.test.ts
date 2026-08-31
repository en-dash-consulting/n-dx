// @vitest-environment jsdom
/**
 * Isometric Map view.
 *
 * Covers the three behaviours that are easy to break and invisible in a
 * typecheck: the deployed-mode gate, the loading → ready/error transitions,
 * and the fact that the control state actually reaches the request URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { IsoMapView } from "../../../src/viewer/views/iso-map.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { SOURCEVISION_TABS } from "../../../src/viewer/views/index.js";
import { renderActiveView, type ViewRenderContext } from "../../../src/viewer/views/view-registry.js";
import { buildValidViews } from "../../../src/shared/index.js";
import type { LoadedData, ViewId } from "../../../src/viewer/types.js";

const MAP_HTML = "<!doctype html><title>map</title><body><div id=\"stage\"></div></body>";

function htmlResponse(body = MAP_HTML): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Let the mounted effect's fetch promise chain settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

describe("IsoMapView", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;
  /** Responses served to the next /api/iso-map requests, oldest first. */
  let isoQueue: Array<() => Promise<Response>>;

  /** Queue one scripted response for the next map request. */
  function queueIsoResponse(fn: () => Promise<Response>) {
    isoQueue.push(fn);
  }

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    clearProjectMetadataCache();
    isoQueue = [];
    // The view also reads project metadata (for the CLI name). That request
    // must not consume a scripted map response, so the mock routes by URL
    // rather than by call order.
    fetchSpy = vi.fn((url: unknown) => {
      if (!String(url).startsWith("/api/iso-map")) {
        return Promise.resolve(new Response("{}", { status: 404 }));
      }
      const scripted = isoQueue.shift();
      return scripted ? scripted() : Promise.resolve(htmlResponse());
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    delete window.__NDX_DEPLOYED__;
    clearProjectMetadataCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount() {
    act(() => { render(h(IsoMapView, null), root); });
  }

  /** Only the map requests — project-metadata traffic is filtered out. */
  function urls(): string[] {
    return fetchSpy.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.startsWith("/api/iso-map"));
  }

  // ── Deployed-mode gate ─────────────────────────────────────────────

  describe("deployed (static export) mode", () => {
    beforeEach(() => {
      window.__NDX_DEPLOYED__ = { basePath: "./", exportedAt: "2026-01-01T00:00:00Z" };
    });

    it("explains that the map needs a running server", () => {
      mount();
      expect(root.querySelector(".iso-map-unavailable")).toBeTruthy();
      expect(root.textContent).toContain("Not available in the exported dashboard");
      expect(root.textContent).toContain("n-dx start .");
    });

    it("never requests the route and shows no controls or frame", () => {
      mount();
      expect(urls()).toEqual([]);
      expect(root.querySelector(".iso-map-controls")).toBeNull();
      expect(root.querySelector("iframe")).toBeNull();
    });
  });

  // ── Loading and success ────────────────────────────────────────────

  it("shows a loading placeholder before the document arrives", () => {
    mount();
    const placeholder = root.querySelector(".iso-map-placeholder");
    expect(placeholder).toBeTruthy();
    expect(placeholder?.getAttribute("role")).toBe("status");
    expect(root.querySelector("iframe")).toBeNull();
  });

  it("requests the default map on mount", async () => {
    mount();
    await settle();
    expect(urls()).toEqual(["/api/iso-map?source=auto&maxNodes=40&externals=1"]);
  });

  it("puts the fetched document in a titled, script-sandboxed iframe", async () => {
    mount();
    await settle();
    const frame = root.querySelector("iframe.iso-map-frame") as HTMLIFrameElement | null;
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("title")).toBe("Isometric architecture map");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("srcdoc")).toBe(MAP_HTML);
    expect(root.querySelector(".iso-map-placeholder")).toBeNull();
  });

  it("points the new-tab and download links at the applied URL", async () => {
    mount();
    await settle();
    const links = Array.from(root.querySelectorAll("a.cmd-btn")) as HTMLAnchorElement[];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/api/iso-map?source=auto&maxNodes=40&externals=1");
    }
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[1].getAttribute("download")).toBe("iso-map-auto-40.html");
  });

  // ── Controls → URL ─────────────────────────────────────────────────

  it("labels every control and wires it to its input", async () => {
    mount();
    await settle();
    for (const id of ["iso-map-source", "iso-map-max-nodes", "iso-map-externals"]) {
      const control = root.querySelector(`#${id}`);
      expect(control, `missing control ${id}`).toBeTruthy();
      const label = root.querySelector(`label[for="${id}"]`);
      expect(label, `missing label for ${id}`).toBeTruthy();
      expect(label?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("rebuilds the URL from the control state when regenerated", async () => {
    mount();
    await settle();

    const source = root.querySelector("#iso-map-source") as HTMLSelectElement;
    const maxNodes = root.querySelector("#iso-map-max-nodes") as HTMLInputElement;
    const externals = root.querySelector("#iso-map-externals") as HTMLInputElement;

    await act(async () => {
      source.value = "scan";
      source.dispatchEvent(new Event("change", { bubbles: true }));
      maxNodes.value = "12";
      maxNodes.dispatchEvent(new Event("input", { bubbles: true }));
      externals.checked = false;
      externals.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = root.querySelector("form.iso-map-controls") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(urls()[1]).toBe("/api/iso-map?source=scan&maxNodes=12&externals=0");
  });

  it("clamps an out-of-range node count instead of sending it", async () => {
    mount();
    await settle();

    const maxNodes = root.querySelector("#iso-map-max-nodes") as HTMLInputElement;
    await act(async () => {
      maxNodes.value = "9999";
      maxNodes.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = root.querySelector("form.iso-map-controls") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(urls()[1]).toBe("/api/iso-map?source=auto&maxNodes=500&externals=1");
    expect(maxNodes.value).toBe("500");
  });

  // ── Error states ───────────────────────────────────────────────────

  it("renders the route's 404 guidance as UI, not a raw error frame", async () => {
    queueIsoResponse(() => Promise.resolve(errorResponse(
      404,
      "No sourcevision analysis found. Run `ndx analyze .` first, or request ?source=scan to map the project directly.",
    )));
    mount();
    await settle();

    const alert = root.querySelector(".iso-map-error");
    expect(alert).toBeTruthy();
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(root.textContent).toContain("Nothing to map yet");
    expect(root.textContent).toContain("No sourcevision analysis found");
    expect(root.textContent).toContain("Direct scan");
    expect(root.querySelector("iframe")).toBeNull();
  });

  it("surfaces a 500 without the scan suggestion", async () => {
    queueIsoResponse(() =>
      Promise.resolve(errorResponse(500, "Failed to build the architecture map: boom")));
    mount();
    await settle();

    expect(root.textContent).toContain("Could not build the map");
    expect(root.textContent).toContain("boom");
    expect(root.textContent).not.toContain("Direct scan” and generate again");
  });

  it("falls back to a readable message when the error body is not JSON", async () => {
    queueIsoResponse(() =>
      Promise.resolve(new Response("<html>gateway timeout</html>", { status: 504 })));
    mount();
    await settle();
    expect(root.textContent).toContain("Request failed with status 504");
  });

  it("surfaces a network failure", async () => {
    queueIsoResponse(() => Promise.reject(new Error("Failed to fetch")));
    mount();
    await settle();
    expect(root.querySelector(".iso-map-error")).toBeTruthy();
    expect(root.textContent).toContain("Failed to fetch");
  });

  it("recovers when a retry succeeds after an error", async () => {
    queueIsoResponse(() => Promise.resolve(errorResponse(404, "Nothing to map")));
    mount();
    await settle();
    expect(root.querySelector(".iso-map-error")).toBeTruthy();

    const form = root.querySelector("form.iso-map-controls") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(root.querySelector(".iso-map-error")).toBeNull();
    expect(root.querySelector("iframe.iso-map-frame")).toBeTruthy();
  });
});

// ── Registration ─────────────────────────────────────────────────────

describe("iso-map view registration", () => {
  const emptyData: LoadedData = {
    manifest: null,
    inventory: null,
    imports: null,
    zones: null,
    components: null,
    callGraph: null,
  };

  function makeCtx(): ViewRenderContext {
    return {
      data: emptyData,
      setDetail: () => {},
      setPrdDetailContent: () => {},
      selectedFile: null,
      setSelectedFile: () => {},
      selectedZone: null,
      selectedRunId: null,
      selectedTaskId: null,
      navigateTo: () => {},
      isFeatureDisabled: () => false,
    };
  }

  it("is a routable view in the unscoped and sourcevision-scoped viewers", () => {
    expect(buildValidViews(null).has("iso-map" as ViewId)).toBe(true);
    expect(buildValidViews("sourcevision").has("iso-map" as ViewId)).toBe(true);
    expect(buildValidViews("rex").has("iso-map" as ViewId)).toBe(false);
  });

  it("has a registry renderer", () => {
    expect(renderActiveView("iso-map" as ViewId, makeCtx())).toBeTruthy();
  });

  it("appears in the SourceVision nav next to the 2D map", () => {
    const ids = SOURCEVISION_TABS.map((t) => t.id);
    expect(ids.indexOf("iso-map")).toBe(ids.indexOf("graph") + 1);
    const tab = SOURCEVISION_TABS.find((t) => t.id === "iso-map")!;
    expect(tab.label).toBe("Isometric Map");
    expect(tab.minPass).toBe(0);
    expect(tab.requiresServer).toBe(true);
  });
});
