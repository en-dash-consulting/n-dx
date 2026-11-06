// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";

// Every subscriber to `rex:prd-changed` registers its refresh here, so a test
// can deliver one PRD change to all of them, as the websocket would.
const subscribers = vi.hoisted(() => ({ refreshes: [] as Array<() => void> }));
vi.mock("../../../src/viewer/hooks/use-prd-changed-refresh.js", async () => {
  const { useEffect } = await import("preact/hooks");
  return {
    usePrdChangedRefresh: (refresh: () => void) => {
      useEffect(() => {
        subscribers.refreshes.push(refresh);
        return () => { subscribers.refreshes.splice(subscribers.refreshes.indexOf(refresh), 1); };
      }, [refresh]);
    },
  };
});

import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
import { LifecycleStrip } from "../../../src/viewer/views/lifecycle-strip.js";
import { ChangesGlance } from "../../../src/viewer/views/changes-glance.js";

const SUMMARY = {
  inbox: 1,
  stages: { proposed: 1, ready: 0, "in-progress": 0, "awaiting-apply": 0 },
  open: [{ id: "c1", title: "Change c1", stage: "proposed", taskCount: 0, completedTaskCount: 0, criteriaGap: false, openBlockers: 0 }],
  next: null,
};

describe("Plan's changes summary read", () => {
  let root: HTMLElement;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const navigateTo = vi.fn();

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ layout: "v2", summary: SUMMARY }) }));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); });

  const summaryRequests = () => fetchSpy.mock.calls.filter(([url]) => url === "/api/rex/changes/summary").length;

  it("makes one request per load and one per PRD change, feeding both panels", async () => {
    await act(async () => {
      render(h(ChangesSummaryProvider, null,
        h(LifecycleStrip, { navigateTo }),
        h(ChangesGlance, { navigateTo }),
      ), root);
    });
    await act(async () => {});
    expect(summaryRequests()).toBe(1);
    expect(root.querySelector(".lifecycle-strip .ls-cell")).not.toBeNull();
    expect(root.querySelectorAll(".cg-row")).toHaveLength(1);

    await act(async () => { for (const refresh of [...subscribers.refreshes]) refresh(); });
    await act(async () => {});
    expect(summaryRequests()).toBe(2);
  });

  it("reads nothing on a static export, where the panels are hidden", async () => {
    window.__NDX_DEPLOYED__ = { basePath: "/", exportedAt: "2026-11-05T00:00:00Z" };
    try {
      await act(async () => { render(h(ChangesSummaryProvider, null, h(ChangesGlance, { navigateTo })), root); });
      await act(async () => {});
      expect(summaryRequests()).toBe(0);
      expect(subscribers.refreshes).toHaveLength(0);
    } finally {
      delete window.__NDX_DEPLOYED__;
    }
  });

  it("refuses a panel mounted without the provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(h(ChangesGlance, { navigateTo }), root)).toThrow(/ChangesSummaryProvider/);
    quiet.mockRestore();
  });
});
