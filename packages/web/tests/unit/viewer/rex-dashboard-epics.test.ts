// @vitest-environment jsdom
/**
 * Epic Progress on the Rex dashboard (the Work page's lead section) is a
 * bounded, scrollable list by default — a PRD with dozens of epics otherwise
 * pushes everything below it out of reach — and expands to show every epic.
 * The choice is remembered.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RexDashboard } from "../../../src/viewer/views/rex-dashboard.js";

const STATS = { total: 4, completed: 1, inProgress: 1, pending: 2, deferred: 0, blocked: 0 };

function dashboard(epicCount: number) {
  return {
    title: "Demo",
    stats: STATS,
    percentComplete: 25,
    epics: Array.from({ length: epicCount }, (_, i) => ({
      id: `epic-${i}`,
      title: `Epic ${i}`,
      status: "pending",
      priority: "medium",
      stats: STATS,
      percentComplete: 25,
    })),
    nextTask: null,
    priorities: { critical: 0, high: 0, medium: epicCount, low: 0 },
  };
}

function stub(epicCount: number) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url === "/api/rex/dashboard" ? dashboard(epicCount) : {};
    return new Response(JSON.stringify(body), {
      status: url === "/api/rex/dashboard" ? 200 : 404,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

let root: HTMLDivElement;

async function mount(): Promise<void> {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(h(RexDashboard, { navigateTo: vi.fn() }), root); });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

const list = () => root.querySelector<HTMLElement>("#rex-dash-epic-list");
const toggle = () => root.querySelector<HTMLButtonElement>(".rex-dash-epics-toggle");

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
  vi.unstubAllGlobals();
});

describe("Epic Progress", () => {
  it("starts as a bounded scroll region holding every epic", async () => {
    stub(30);
    await mount();
    expect(list()?.classList.contains("rex-dash-epic-list--scroll")).toBe(true);
    // Scrollable, not truncated: every epic is in the list.
    expect(list()?.querySelectorAll(".rex-dash-epic")).toHaveLength(30);
    // A scroll region must be reachable by keyboard.
    expect(list()?.getAttribute("tabindex")).toBe("0");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle()?.getAttribute("aria-controls")).toBe("rex-dash-epic-list");
  });

  it("expands to full height and back, remembering the choice", async () => {
    stub(30);
    await mount();
    act(() => { toggle()!.click(); });
    expect(list()?.classList.contains("rex-dash-epic-list--expanded")).toBe(true);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem("ndx.rex-dash.epics-expanded")).toBe("true");

    render(null, root);
    root.remove();
    await mount();
    expect(list()?.classList.contains("rex-dash-epic-list--expanded")).toBe(true);

    act(() => { toggle()!.click(); });
    expect(list()?.classList.contains("rex-dash-epic-list--scroll")).toBe(true);
    expect(localStorage.getItem("ndx.rex-dash.epics-expanded")).toBe("false");
  });

  it("offers no toggle when there are no epics", async () => {
    stub(0);
    await mount();
    expect(toggle()).toBeNull();
    expect(root.textContent).toContain("No epics defined yet.");
  });
});
