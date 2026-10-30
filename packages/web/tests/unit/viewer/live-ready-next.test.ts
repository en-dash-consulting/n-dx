// @vitest-environment jsdom
/**
 * Live's Ready next: with `hench.readyNext` on it takes the Up next list's
 * place and shows each lane's command and reasons; with it off Live is as it
 * was and the plan is never requested.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { LiveView } from "../../../src/viewer/views/live.js";
import type { NavigateTo } from "../../../src/viewer/types.js";

const PLAN = {
  lanes: [{
    command: "ndx work --task=t1 --auto . && ndx work --task=t2 --auto .",
    changeId: "c1",
    tasks: [
      { id: "t1", title: "First task", reason: "lane 1, step 1 of 2: change c1, tier standard" },
      { id: "t2", title: "Second task", reason: "lane 1, step 2 of 2: change c1, tier light, after t1" },
    ],
  }],
  excluded: [{ id: "t3", title: "Migrate it", reason: "tagged migration: cold-only, run it on its own" }],
  activeRuns: 0,
  runLimit: 3,
  summary: "1 lane for 3 free run slots (0 active of 3).",
};

const SNAPSHOT = {
  generatedAt: new Date().toISOString(),
  runs: [], jobs: [],
  queue: { next: [{ id: "n1", title: "Next up", status: "pending", priority: "high", epicChain: [] }], starting: [] },
  machine: {
    slots: { scope: "repository", inUse: 0, max: 3, available: 3, queued: 0 },
    memory: { freeBytes: 8 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, pressure: "normal", floorBytes: 2 * 1024 ** 3, belowFloor: false },
    llm: { vendor: "claude", model: "sonnet" },
    worktrees: { total: 1, withLiveRun: 0 },
    spend: { todayUsd: 0, todayTokens: 0, inFlightUsd: 0, inFlightTokens: 0 },
  },
  recent: [],
  counts: { running: 0, stale: 0, jobs: 0 },
};

describe("Live Ready next", () => {
  let root: HTMLDivElement;
  let urls: string[];

  function stub(readyNext: boolean): void {
    vi.stubGlobal("WebSocket", class { onmessage = null; onopen = null; onclose = null; close() {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      const body = String(url).startsWith("/api/features")
        ? { toggles: [{ key: "hench.readyNext", enabled: readyNext }] }
        : String(url).includes("/api/live")
          ? SNAPSHOT
          : String(url).includes("/api/hench/plan-queue")
            ? PLAN
            : {};
      return { ok: true, status: 200, json: async () => body };
    }));
  }

  let navigateTo: ReturnType<typeof vi.fn<NavigateTo>>;

  async function mount(): Promise<void> {
    navigateTo = vi.fn<NavigateTo>();
    act(() => { render(h(LiveView, { navigateTo, analyzedAt: null, jobs: { refresh: vi.fn(async () => {}), operations: [] } as never }), root); });
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
    }
  }

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    urls = [];
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("shows Ready next with each lane's command and reasons in place of Up next when on", async () => {
    stub(true);
    await mount();
    const side = root.querySelector(".live-side")!;
    expect(side.textContent).toContain("Ready next");
    expect(side.textContent).not.toContain("Up next");
    expect(root.querySelector(".live-ready-command")!.textContent).toBe(PLAN.lanes[0].command);
    expect(side.textContent).toContain("lane 1, step 2 of 2: change c1, tier light, after t1");
    expect(side.textContent).toContain("tagged migration: cold-only");
    expect(side.textContent).toContain(PLAN.summary);
  });

  it("links each task title to its task, as Up next items do", async () => {
    stub(true);
    await mount();
    const links = [...root.querySelectorAll<HTMLAnchorElement>(".live-ready a.live-queue-item")];
    expect(links.map((a) => a.textContent)).toEqual(["First task", "Second task", "Migrate it"]);
    for (const [i, id] of ["t1", "t2", "t3"].entries()) {
      act(() => { links[i].click(); });
      expect(navigateTo).toHaveBeenLastCalledWith("prd", { taskId: id });
    }
  });

  it("leaves Live unchanged and never asks for the plan when off", async () => {
    stub(false);
    await mount();
    const side = root.querySelector(".live-side")!;
    expect(side.textContent).toContain("Up next");
    expect(side.textContent).toContain("Next up");
    expect(side.textContent).not.toContain("Ready next");
    expect(urls.some((u) => u.includes("/api/hench/plan-queue"))).toBe(false);
  });
});
