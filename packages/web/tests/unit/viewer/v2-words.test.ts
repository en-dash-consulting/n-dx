// @vitest-environment jsdom
/**
 * A v2 tree shows change, task and subtask; a v1 tree keeps epic and feature.
 * Covers the tree view's meta, the Up Next count line and the search type
 * filter, which all read the layout.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { viewBlurbFor, viewLabelFor } from "../../../src/viewer/views/view-meta.js";
import { RexDashboard } from "../../../src/viewer/views/rex-dashboard.js";
import { SearchOverlay } from "../../../src/viewer/components/search-overlay.js";

const STATS = { total: 4, completed: 1, inProgress: 1, pending: 2, deferred: 0, blocked: 0 };

function stub(layout: "v1" | "v2"): void {
  const dash = {
    title: "Demo",
    layout,
    stats: STATS,
    percentComplete: 25,
    epics: [{ id: "a", title: "A", status: "in_progress", priority: "medium", stats: STATS, percentComplete: 25 }],
    nextTask: null,
    priorities: { critical: 0, high: 0, medium: 1, low: 0 },
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url === "/api/rex/dashboard" ? dash : url === "/api/status" ? { rex: { layout } } : {};
    return new Response(JSON.stringify(body), {
      status: url === "/api/rex/dashboard" || url === "/api/status" ? 200 : 404,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

let root: HTMLDivElement;

async function mount(vnode: ReturnType<typeof h>): Promise<void> {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(vnode, root); });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("tree view meta", () => {
  it("calls the v2 tree the Change tree and names no epic or feature", () => {
    expect(viewLabelFor("prd", "v2")).toBe("Change tree");
    expect(`${viewLabelFor("prd", "v2")} ${viewBlurbFor("prd", "v2")}`).not.toMatch(/epic|feature/i);
    expect(`${viewLabelFor("rex-dashboard", "v2")} ${viewBlurbFor("rex-dashboard", "v2")}`).not.toMatch(/epic|feature/i);
  });

  it("keeps the v1 words on a v1 tree", () => {
    expect(viewLabelFor("prd", "v1")).toBe("Tasks");
    expect(viewBlurbFor("prd", "v1")).toMatch(/epics, features, tasks/);
  });
});

describe("Up Next", () => {
  it("counts changes in progress on v2", async () => {
    stub("v2");
    await mount(h(RexDashboard, { navigateTo: vi.fn() }));
    const meta = root.querySelector(".rex-dash-next .rex-dash-section-meta")?.textContent;
    expect(meta).toBe("1 change in progress");
  });

  it("counts epics in progress on v1", async () => {
    stub("v1");
    await mount(h(RexDashboard, { navigateTo: vi.fn() }));
    const meta = root.querySelector(".rex-dash-next .rex-dash-section-meta")?.textContent;
    expect(meta).toBe("1 epic in progress");
  });
});

describe("search type filter", () => {
  async function chips(layout: "v1" | "v2"): Promise<string[]> {
    stub(layout);
    await mount(h(SearchOverlay, { visible: true, onClose: vi.fn(), navigateTo: vi.fn() }));
    await act(async () => { root.querySelector<HTMLButtonElement>(".search-overlay-filter-btn")!.click(); });
    const first = root.querySelector(".search-filter-group")!;
    return [...first.querySelectorAll(".search-filter-chip")].map((c) => c.textContent ?? "");
  }

  it("offers Change, Task and Subtask on v2", async () => {
    expect(await chips("v2")).toEqual(["Change", "Task", "Subtask"]);
  });

  it("offers Epic, Feature, Task and Subtask on v1", async () => {
    expect(await chips("v1")).toEqual(["Epic", "Feature", "Task", "Subtask"]);
  });
});
