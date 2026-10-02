// @vitest-environment jsdom
/**
 * The Live tab: its three states, how they are announced, and the peek.
 *
 * The pure reading of `/api/live` (state, label, progress fraction) is tested
 * directly; the rendered tab is tested against a stubbed endpoint.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  analyzeFraction,
  attentionFlag,
  liveRunningCount,
  liveTabLabel,
  liveTabState,
  type LiveSummary,
} from "../../../src/viewer/hooks/use-live.js";
import { TopNav } from "../../../src/viewer/components/top-nav.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { ViewId } from "../../../src/viewer/types.js";

const WORKTREE = { key: "main", isAnchor: true };

function run(over: Record<string, unknown> = {}) {
  return {
    runId: "r1", taskId: "t1", taskTitle: "Fix the thing", branch: "feat/x", worktree: WORKTREE,
    startedAt: new Date(Date.now() - 65_000).toISOString(), stale: false, lastProgress: "Editing a.ts",
    ...over,
  };
}

function snapshot(over: Partial<LiveSummary> = {}): LiveSummary {
  return { runs: [], jobs: [], counts: { running: 0, stale: 0, jobs: 0 }, ...over };
}

describe("reading /api/live", () => {
  it("is idle with nothing running", () => {
    expect(liveTabState(snapshot())).toBe("idle");
    expect(liveTabState(null)).toBe("idle");
    expect(liveTabLabel(snapshot())).toBe("Live, nothing running");
    expect(liveTabLabel(null)).toBe("Live, nothing running");
  });

  it("counts runs and jobs together as running", () => {
    const live = snapshot({
      runs: [run(), run({ runId: "r2" })] as never,
      counts: { running: 2, stale: 0, jobs: 1 },
    });
    expect(liveTabState(live)).toBe("running");
    expect(liveTabLabel(live)).toBe("Live, 3 running");
  });

  it("needs attention when a run is stuck, and says so", () => {
    const live = snapshot({
      runs: [run({ stale: true }), run({ runId: "r2" }), run({ runId: "r3" })] as never,
      counts: { running: 3, stale: 1, jobs: 0 },
    });
    expect(liveTabState(live)).toBe("attention");
    expect(liveTabLabel(live)).toBe("Live, 3 running, 1 stuck");
  });

  it("does not count a run no process is executing as running, and flags it for attention", () => {
    const live = snapshot({
      runs: [run(), run({ runId: "r2", liveness: "orphaned" }), run({ runId: "r3", stale: true, liveness: "orphaned" })] as never,
      counts: { running: 3, stale: 1, jobs: 0 },
    });
    expect(liveTabLabel(live)).toBe("Live, 1 running, 2 stuck");
    expect(liveTabState(live)).toBe("attention");
    // Dead but not yet quiet: attention with no stale count behind it.
    const fresh = snapshot({ runs: [run({ liveness: "orphaned" })] as never, counts: { running: 1, stale: 0, jobs: 0 } });
    expect(liveTabState(fresh)).toBe("attention");
    expect(liveTabLabel(fresh)).toBe("Live, 0 running, 1 stuck");
  });

  it("does not count a run recorded on another host as running", () => {
    const live = snapshot({ runs: [run({ liveness: "foreign" })] as never, counts: { running: 1, stale: 0, jobs: 0 } });
    expect(liveRunningCount(live)).toBe(0);
    expect(liveTabState(live)).toBe("idle");
    expect(liveTabLabel(live)).toBe("Live, nothing running");
  });

  it("counts live runs and jobs, not foreign or orphaned records", () => {
    const live = snapshot({
      runs: [run(), run({ runId: "r2", liveness: "foreign" }), run({ runId: "r3", liveness: "orphaned" })] as never,
      jobs: [{ id: "j1", kind: "analyze" }] as never,
      counts: { running: 3, stale: 0, jobs: 1 },
    });
    expect(liveRunningCount(live)).toBe(2);
  });

  it("names the verdict instead of 'stuck' for the flag", () => {
    expect(attentionFlag({ stale: true, liveness: "orphaned" })).toBe("not running");
    expect(attentionFlag({ stale: false, liveness: "unknown" })).toBe("unverified");
    expect(attentionFlag({ stale: true, liveness: "live" })).toBe("stuck");
    expect(attentionFlag({ stale: false, liveness: "foreign" })).toBeNull();
  });

  it("fills the analysis bar by phase, then by batch within the phase", () => {
    expect(analyzeFraction(null)).toBeNull();
    expect(analyzeFraction({ phase: null, batch: null })).toBeNull();
    expect(analyzeFraction({ phase: { index: 1, name: "inventory", total: 6 }, batch: null })).toBe(0);
    expect(analyzeFraction({ phase: { index: 4, name: "zones", total: 6 }, batch: null })).toBe(0.5);
    expect(analyzeFraction({ phase: { index: 4, name: "zones", total: 6 }, batch: { label: "b", done: 1, total: 2 } }))
      .toBeCloseTo(3.5 / 6);
  });
});

describe("the rendered tab", () => {
  let root: HTMLDivElement;
  let body: unknown;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
    body = snapshot();
    vi.stubGlobal("WebSocket", class { onmessage = null; close() {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/live")) return { ok: true, status: 200, json: async () => body };
      if (u.includes("/api/project")) {
        return { ok: true, status: 200, json: async () => ({ name: "demo", description: null, version: null, git: null, nameSource: "directory" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  async function mount(view: ViewId = "home", navigate: (v: ViewId) => void = () => {}, navigateTo = vi.fn()) {
    act(() => {
      render(h(TopNav, {
        view, validViews: buildValidViews(null), onNavigate: navigate, navigateTo, onOpenSearch: () => {},
      }), root);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return { navigateTo };
  }

  const tab = () => root.querySelector<HTMLButtonElement>(".topnav-tab-live")!;

  it("renders after the three stage tabs and a divider", async () => {
    await mount();
    const nav = root.querySelector("nav")!;
    const kids = [...nav.children].map((c) => c.className);
    expect(kids.slice(0, 3).every((c) => c.includes("topnav-tab "))).toBe(true);
    expect(kids[3]).toContain("topnav-divider");
    expect(kids[4]).toContain("topnav-live");
  });

  it("is idle: hollow dot, no count, announced as nothing running", async () => {
    await mount();
    expect(tab().dataset.liveState).toBe("idle");
    expect(root.querySelector(".live-count")).toBeNull();
    expect(root.querySelector(".live-stuck-badge")).toBeNull();
    expect(tab().getAttribute("aria-label")).toBe("Live, nothing running");
  });

  it("is running: shows the number of runs and jobs", async () => {
    body = snapshot({ runs: [run(), run({ runId: "r2" })], counts: { running: 2, stale: 0, jobs: 1 } });
    await mount();
    expect(tab().dataset.liveState).toBe("running");
    expect(root.querySelector(".live-count")?.textContent).toBe("3");
    expect(tab().getAttribute("aria-label")).toBe("Live, 3 running");
  });

  it("needs attention: orange state with an N stuck badge", async () => {
    body = snapshot({ runs: [run({ stale: true }), run({ runId: "r2" }), run({ runId: "r3" })], counts: { running: 3, stale: 1, jobs: 0 } });
    await mount();
    expect(tab().dataset.liveState).toBe("attention");
    expect(root.querySelector(".live-stuck-badge")?.textContent).toBe("1 stuck");
    expect(tab().getAttribute("aria-label")).toBe("Live, 3 running, 1 stuck");
  });

  it("is active on every Live route, and only those", async () => {
    for (const view of ["live", "live-task", "live-analyze"] as ViewId[]) {
      await mount(view);
      expect(tab().classList.contains("active"), view).toBe(true);
      expect(tab().getAttribute("aria-current"), view).toBe(view === "live" ? "page" : "true");
    }
    await mount("work");
    expect(tab().classList.contains("active")).toBe(false);
    expect(root.querySelectorAll(".topnav-tab.active")).toHaveLength(1);
  });

  it("clicking the tab goes to Live", async () => {
    const navigate = vi.fn();
    await mount("home", navigate);
    act(() => { tab().click(); });
    expect(navigate).toHaveBeenCalledWith("live");
  });

  describe("the peek", () => {
    const withItems = () => {
      body = snapshot({
        runs: [run()],
        jobs: [{
          id: "analyze:main", kind: "analyze", worktree: WORKTREE, startedAt: new Date().toISOString(), detail: null,
          progress: { phase: { index: 4, name: "zones", total: 6 }, batch: null },
        }],
        counts: { running: 1, stale: 0, jobs: 1 },
      });
    };

    it("opens on hover and lists each live item with a link to its page", async () => {
      withItems();
      await mount();
      expect(root.querySelector(".live-peek")).toBeNull();
      act(() => { root.querySelector(".topnav-live")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
      // Preact's onMouseEnter is wired to mouseenter, which does not bubble.
      act(() => { root.querySelector(".topnav-live")!.dispatchEvent(new MouseEvent("mouseenter")); });

      const peek = root.querySelector(".live-peek")!;
      expect(peek).not.toBeNull();
      const rows = [...peek.querySelectorAll<HTMLAnchorElement>(".live-peek-row")];
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain("Fix the thing");
      expect(rows[0].textContent).toContain("feat/x");
      expect(rows[0].textContent).toContain("Editing a.ts");
      expect(rows[0].getAttribute("href")).toBe("/live/task/t1");
      expect(rows[1].getAttribute("href")).toBe("/live/analyze");
      expect(rows[1].querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("50");
      expect(peek.querySelector(".live-peek-open")?.textContent).toBe("Open Live");
    });

    it("opens on keyboard focus and closes on Escape, returning focus to the tab", async () => {
      withItems();
      await mount();
      act(() => { tab().focus(); });
      expect(root.querySelector(".live-peek")).not.toBeNull();

      const link = root.querySelector<HTMLAnchorElement>(".live-peek-row")!;
      act(() => { link.focus(); });
      expect(root.querySelector(".live-peek")).not.toBeNull();

      act(() => { link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      expect(root.querySelector(".live-peek")).toBeNull();
      expect(document.activeElement).toBe(tab());
    });

    it("Escape closes a peek opened by hover while focus is elsewhere", async () => {
      withItems();
      await mount();
      act(() => { root.querySelector(".topnav-live")!.dispatchEvent(new MouseEvent("mouseenter")); });
      expect(root.querySelector(".live-peek")).not.toBeNull();
      act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      expect(root.querySelector(".live-peek")).toBeNull();
    });

    it("a peek opened by focus stays open when the pointer leaves", async () => {
      withItems();
      await mount();
      const live = root.querySelector(".topnav-live")!;
      act(() => { tab().focus(); });
      act(() => { live.dispatchEvent(new MouseEvent("mouseenter")); });
      act(() => { live.dispatchEvent(new MouseEvent("mouseleave")); });
      expect(root.querySelector(".live-peek")).not.toBeNull();
      act(() => { tab().blur(); });
      expect(root.querySelector(".live-peek")).toBeNull();
    });

    it("a row navigates in place to that item's page", async () => {
      withItems();
      const { navigateTo } = await mount();
      act(() => { tab().focus(); });
      act(() => { root.querySelector<HTMLAnchorElement>(".live-peek-row")!.click(); });
      expect(navigateTo).toHaveBeenCalledWith("live-task", { taskId: "t1" });
      expect(root.querySelector(".live-peek")).toBeNull();
    });

    it("a run in another worktree links under that worktree's /w/ slot", async () => {
      body = snapshot({
        runs: [run({ worktree: { key: "feature", isAnchor: false } })],
        counts: { running: 1, stale: 0, jobs: 0 },
      });
      const { navigateTo } = await mount();
      act(() => { tab().focus(); });
      const row = root.querySelector<HTMLAnchorElement>(".live-peek-row")!;
      expect(row.getAttribute("href")).toBe("/w/feature/live/task/t1");
      // jsdom cannot follow the link; the point is that the SPA does not intercept it.
      let intercepted = true;
      row.addEventListener("click", (e) => { intercepted = e.defaultPrevented; e.preventDefault(); });
      act(() => { row.click(); });
      expect(intercepted).toBe(false);
      expect(navigateTo).not.toHaveBeenCalled();
    });

    it("says so when nothing is running", async () => {
      await mount();
      act(() => { tab().focus(); });
      expect(root.querySelector(".live-peek-empty")?.textContent).toBe("Nothing running.");
      expect(root.querySelector(".live-peek-open")).not.toBeNull();
    });
  });
});
