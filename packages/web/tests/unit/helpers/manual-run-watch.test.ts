import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";

// Exercise the real polling assertions. Only the locator assertion uses a
// small browser boundary, because these cases test run selection, not DOM.
vi.mock("@playwright/test", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@playwright/test")>();
  return { ...actual, expect: Object.assign((locator: { count(): number }) => ({
    toHaveCount: async (count: number) => expect(locator.count()).toBe(count),
  }), { poll: actual.expect.poll }) };
});

import { listRuns, openLiveTask, snapshotRunIds } from "../../e2e-ui-manual/helpers/run-watch.js";

afterEach(() => { vi.unstubAllGlobals(); });
const respond = (runs: unknown) => new Response(JSON.stringify({ runs }), { status: 200 });
function page() {
  return {
    url: () => "http://fixture.local/live",
    goto: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(() => ({ count: () => 1 })),
  };
}

describe("manual started-run selection", () => {
  it("keeps waiting rather than opening a pre-existing completed run, even for the expected task", async () => {
    const browser = page();
    vi.stubGlobal("fetch", vi.fn(async () => respond([{ id: "old", taskId: "expected", status: "completed" }])));
    await expect(openLiveTask(browser as unknown as Page, "expected", new Set(["old"]), 30)).rejects.toThrow(/old/);
    expect(browser.goto).not.toHaveBeenCalled();
  });

  it("waits through old-only snapshots and opens the new run when it appears", async () => {
    const browser = page();
    const old = { id: "old", taskId: "prior-leg", status: "completed" };
    const fetcher = vi.fn().mockResolvedValueOnce(respond([old])).mockResolvedValueOnce(respond([
      old, { id: "new", taskId: "new-leg", status: "running" },
    ]));
    vi.stubGlobal("fetch", fetcher);
    await expect(openLiveTask(browser as unknown as Page, "new-leg", new Set(["old"]), 3_000)).resolves.toBe("new-leg");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(browser.goto).toHaveBeenCalledWith("http://fixture.local/live/task/new-leg", expect.anything());
  });

  it("prefers a new expected-task run over other new runs", async () => {
    const browser = page();
    vi.stubGlobal("fetch", vi.fn(async () => respond([
      { id: "other", taskId: "different-task", status: "running" },
      { id: "expected-run", taskId: "expected", status: "completed" },
    ])));
    await expect(openLiveTask(browser as unknown as Page, "expected", new Set(), 100)).resolves.toBe("expected");
  });

  it("uses a new selected task when priority chose another task, and encodes its URL", async () => {
    const browser = page();
    vi.stubGlobal("fetch", vi.fn(async () => respond([
      { id: "old", taskId: "expected", status: "completed" },
      { id: "new", taskId: "task / é", status: "failed" },
    ])));
    await expect(openLiveTask(browser as unknown as Page, "expected", new Set(["old"]), 100)).resolves.toBe("task / é");
    expect(browser.goto).toHaveBeenCalledWith("http://fixture.local/live/task/task%20%2F%20%C3%A9", expect.anything());
  });

  it("snapshots every workspace run with no repository scope or truncation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(new URL(url).search).toBe("");
      return respond(Array.from({ length: 60 }, (_, i) => ({ id: `run-${i}`, taskId: `task-${i}`, status: "completed" })));
    }));
    const ids = await snapshotRunIds("http://fixture.local");
    expect(ids.size).toBe(60);
    expect(ids.has("run-59")).toBe(true);
  });

  it.each([
    () => new Response("offline", { status: 500 }),
    () => respond("invalid"),
    () => respond([{ status: "running", taskId: "missing-id" }]),
  ])("refuses an unreadable snapshot instead of treating it as no known runs", async (response) => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    await expect(snapshotRunIds("http://fixture.local")).rejects.toThrow();
  });

  it("bounds a hung run-list request with an abort signal", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    })));
    await expect(listRuns("http://fixture.local", 20)).rejects.toThrow(/timeout|timed out/i);
  });
});
