// @vitest-environment jsdom
/**
 * useAppData against a server that is not ready yet.
 *
 * Mounts the real hook and the real loader over a scripted `fetch`, the way
 * a tab opened during `ndx start` sees the hub: 503 "no running server" for
 * the first requests, then 200. The page must show the server notice (never
 * the file-drop box) and then load data on its own, with no reload.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

vi.mock("../../../src/viewer/performance/index.js", () => ({
  isFeatureDisabled: () => false,
  onDegradationChange: () => () => {},
}));

const manifestFixture = {
  schemaVersion: "1.0.0",
  toolVersion: "0.1.0",
  analyzedAt: "2026-10-21T00:00:00.000Z",
  targetPath: "/repo",
  modules: {},
};

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** `/data` answers from `dataScript` in order (last entry repeats); data files and everything else are served or 404. */
function installFetch(dataScript: Array<() => Response>) {
  let dataCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const path = url.split("?")[0]!;
    if (path === "/data") {
      const next = dataScript[Math.min(dataCalls, dataScript.length - 1)]!;
      dataCalls++;
      return next();
    }
    if (path === "/data/manifest.json") return json(200, manifestFixture);
    if (path === "/data/zones.json") return json(404, {});
    if (path === "/data/status") return json(200, { mtimes: {} });
    return json(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, dataCalls: () => dataCalls };
}

async function mount() {
  vi.resetModules();
  const { useAppData } = await import("../../../src/viewer/hooks/use-app-data.js");
  const { ServerUnavailableNotice } = await import("../../../src/viewer/components/server-unavailable.js");
  function Harness() {
    const { mode, serverError, showDrop, loading, data } = useAppData();
    return h("div", null,
      h("span", { id: "state" }, `${mode}|${showDrop ? "drop" : "nodrop"}|${loading ? "loading" : "ready"}|${data.manifest ? "manifest" : "nomanifest"}`),
      mode === "unavailable" && serverError ? h(ServerUnavailableNotice, { error: serverError }) : null,
      mode === "static" && showDrop ? h("div", { class: "drop-box" }, h("h2", null, "Drop .sourcevision files")) : null,
    );
  }
  return renderToDiv(h(Harness, null));
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  }
}

const state = (root: HTMLElement) => root.querySelector("#state")?.textContent ?? "";

describe("useAppData with a server that is not ready", () => {
  let root: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    if (root) cleanupRenderedDiv(root);
    root = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the waiting notice during the hub's 503s, then loads data when the server answers", async () => {
    const { dataCalls } = installFetch([
      () => json(503, { error: 'Project "n-dx" has no running server', status: "starting" }),
      () => json(503, { error: 'Project "n-dx" has no running server', status: "starting" }),
      () => json(200, { files: ["manifest.json"] }),
    ]);
    root = await mount();

    // While the probe is retrying nothing is decided: still loading, no overlay of either kind.
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(state(root)).toBe("static|nodrop|loading|nomanifest");
    expect(root.textContent).not.toContain("Drop .sourcevision files");

    // Two 503s then a 200: the probe's own retries (500 ms + 1 s) get there.
    await waitFor(() => state(root!).startsWith("server|"), 5000);
    await waitFor(() => state(root!).endsWith("|manifest"), 2000);
    expect(state(root)).toBe("server|nodrop|ready|manifest");
    expect(dataCalls()).toBe(3);
    expect(root.textContent).not.toContain("Drop .sourcevision files");
    expect(root.querySelector(".server-unavailable")).toBeNull();
  }, 10000);

  it("a 401 shows the sign-in notice, not the drop box, and does not offer file drop", async () => {
    installFetch([
      () => json(401, { error: "Authentication required", hint: "Open the URL printed by `ndx start`." }),
    ]);
    root = await mount();
    await waitFor(() => state(root!).startsWith("unavailable|"), 3000);

    expect(state(root)).toBe("unavailable|nodrop|ready|nomanifest");
    const notice = root.querySelector(".server-unavailable");
    expect(notice).not.toBeNull();
    expect(notice!.querySelector("h2")!.textContent).toBe("Sign in to the dashboard again");
    expect(notice!.textContent).toContain("start");
    expect(root.textContent).not.toContain("Drop .sourcevision files");
  });

  it("a 404 is a static host: the drop box is offered as before", async () => {
    installFetch([() => json(404, {})]);
    root = await mount();
    await waitFor(() => state(root!).includes("|drop|"), 3000);
    expect(state(root)).toBe("static|drop|ready|nomanifest");
    expect(root.textContent).toContain("Drop .sourcevision files");
  });
});
