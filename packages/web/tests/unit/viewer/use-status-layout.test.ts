// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";

const { openWebSocket } = vi.hoisted(() => ({ openWebSocket: vi.fn(() => { throw new Error("no socket in tests"); }) }));
vi.mock("../../../src/viewer/session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/viewer/session.js")>()),
  openWebSocket,
}));

import { useStatusLayout } from "../../../src/viewer/hooks/use-project-status.js";

function Probe() {
  return h("span", { class: "probe" }, useStatusLayout());
}

const V2_STATUS = {
  sv: { freshness: "fresh", analyzedAt: null, minutesAgo: null, modulesComplete: 0, modulesTotal: 0 },
  rex: { exists: true, percentComplete: 0, stats: null, hasInProgress: false, hasPending: false, nextTaskTitle: null, layout: "v2" },
  hench: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
  initialized: true,
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("useStatusLayout", () => {
  it("reads the layout from one status fetch and opens no WebSocket however many readers mount", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => V2_STATUS }));
    vi.stubGlobal("fetch", fetch);
    const root = document.createElement("div");
    act(() => { render(h("div", null, h(Probe, null), h(Probe, null), h(Probe, null), h(Probe, null)), root); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    expect([...root.querySelectorAll(".probe")].map((e) => e.textContent)).toEqual(["v2", "v2", "v2", "v2"]);
    expect(openWebSocket).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => { render(null, root); });
  });
});
