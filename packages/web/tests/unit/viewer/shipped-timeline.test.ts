// @vitest-environment jsdom
/**
 * Tune's Shipped tile shows the PRD's timeline: what was completed when, the
 * open top-level items beside today, each item opening on the Tasks page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ShippedTimeline } from "../../../src/viewer/views/shipped-timeline.js";
import { STAGES } from "../../../src/viewer/views/stages.js";

const DAY = 24 * 60 * 60 * 1000;
const PRD = {
  schema: "rex/v1",
  title: "Timeline",
  items: [
    {
      id: "e1", title: "Shipped epic", level: "epic", status: "pending",
      children: [
        { id: "t-done", title: "Finished task", level: "task", status: "completed", completedAt: new Date(Date.now() - DAY).toISOString() },
        { id: "t-open", title: "Open task", level: "task", status: "pending" },
      ],
    },
  ],
};

let root: HTMLDivElement;

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  localStorage.clear();
  root = document.createElement("div");
  document.body.appendChild(root);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url === "/data/prd.json" ? PRD : {};
    return { ok: true, status: 200, json: async () => body } as Response;
  }));
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

describe("the Shipped tile", () => {
  it("is the timeline, full width, with \"Open\" still going to the Merge Graph", () => {
    const shipped = STAGES.tune.tiles!.find((t) => t.title === "Shipped")!;
    expect(shipped).toMatchObject({ view: "merge-graph", panel: "shipped-timeline", embedsView: true, cols: 12, rows: 2 });
  });

  it("lays out a completion and lists the open item, each opening on the Tasks page", async () => {
    const navigateTo = vi.fn();
    await act(async () => { render(h(ShippedTimeline, { navigateTo }), root); });
    await flush();
    const done = [...root.querySelectorAll<HTMLAnchorElement>("a.tlg-label")].find((a) => a.textContent === "Finished task");
    expect(done).toBeDefined();
    act(() => { done!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: "t-done" });
    // The epic is still open: it is listed to the right of today.
    expect(root.querySelector(".tlg-open-list")?.textContent).toContain("Shipped epic");
  });

  it("says so when the PRD cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }) as Response));
    await act(async () => { render(h(ShippedTimeline, { navigateTo: vi.fn() }), root); });
    await flush();
    expect(root.querySelector(".shipped-note")?.textContent ?? "").not.toBe("");
  });
});
