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

function stub(epicCount: number, dash: object = dashboard(epicCount)) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url === "/api/rex/dashboard" ? dash : {};
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
const toggle = () => root.querySelector<HTMLButtonElement>("button.rex-dash-epics-toggle[aria-controls]");
const head = () => root.querySelector<HTMLButtonElement>(".rex-dash-epics-head");
const titles = () => [...root.querySelectorAll(".rex-dash-epic .rex-task-link-title")].map((el) => el.textContent);

/** Closed by default: open it, as a reader would. */
function openSection(): void {
  if (head()?.getAttribute("aria-expanded") !== "true") act(() => { head()!.click(); });
}

function change(id: string, status: string, extra: object = {}) {
  return { id, title: id, status, stats: STATS, percentComplete: 25, ...extra };
}

async function setInput(selector: string, value: string, event: "input" | "change"): Promise<void> {
  const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  el.value = value;
  await act(async () => { el.dispatchEvent(new Event(event, { bubbles: true })); });
}

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
    openSection();
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
    openSection();
    act(() => { toggle()!.click(); });
    expect(list()?.classList.contains("rex-dash-epic-list--expanded")).toBe(true);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem("ndx.rex-dash.epics-expanded")).toBe("true");

    render(null, root);
    root.remove();
    await mount();
    openSection();
    expect(list()?.classList.contains("rex-dash-epic-list--expanded")).toBe(true);

    act(() => { toggle()!.click(); });
    expect(list()?.classList.contains("rex-dash-epic-list--scroll")).toBe(true);
    expect(localStorage.getItem("ndx.rex-dash.epics-expanded")).toBe("false");
  });

  it("offers no toggle when there are no epics", async () => {
    stub(0);
    await mount();
    openSection();
    expect(toggle()).toBeNull();
    expect(root.textContent).toContain("No epics defined yet.");
  });

  it("labels a v1 PRD's rows epics and counts each by its tasks", async () => {
    stub(1);
    await mount();
    openSection();
    expect(root.querySelector(".rex-dash-epics h3")?.textContent).toBe("Epic Progress");
    expect(root.querySelector(".rex-dash-epics .rex-dash-section-meta")?.textContent).toBe("1 epic");
    expect(list()?.getAttribute("aria-label")).toBe("Epic progress");
    expect(root.querySelector(".rex-dash-epic-count")?.textContent).toBe("1/4");
  });
});

describe("Change Progress (v2)", () => {
  const ONE = { total: 1, completed: 0, inProgress: 0, pending: 1, deferred: 0, blocked: 0 };
  const v2 = (epics: object[]) => ({ ...dashboard(0), layout: "v2", epics });

  it("labels the rows changes and shows a task-less change's status instead of a count", async () => {
    stub(0, v2([
      { id: "bare", title: "Bare", status: "pending", type: "change", selfCounted: true, stats: ONE, percentComplete: 0 },
      { id: "tasks", title: "With tasks", status: "in_progress", type: "change", stats: STATS, percentComplete: 25 },
    ]));
    await mount();
    openSection();
    expect(root.querySelector(".rex-dash-epics h3")?.textContent).toBe("Change Progress");
    expect(root.querySelector(".rex-dash-epics .rex-dash-section-meta")?.textContent).toBe("2 changes");
    expect(list()?.getAttribute("aria-label")).toBe("Change progress");
    const counts = [...root.querySelectorAll(".rex-dash-epic-count")].map((el) => el.textContent);
    expect(counts).toEqual(expect.arrayContaining(["pending", "1/4"]));
    expect(counts).not.toContain("0/1");
  });

  it("says no changes when there are none", async () => {
    stub(0, v2([]));
    await mount();
    openSection();
    expect(root.textContent).toContain("No changes defined yet.");
  });
});

describe("Change Progress dropdown and filters", () => {
  const withEpics = (epics: object[]) => ({ ...dashboard(0), layout: "v2", epics });
  const ROWS = [
    change("alpha-done", "completed", { tags: ["web"], assignees: ["Ada <a@x>"] }),
    change("bravo-pending", "pending", { tags: ["rex"], assignees: ["Bo <b@x>"] }),
    change("charlie-active", "in_progress", { tags: ["web", "rex"], assignees: ["Bo <b@x>", "Ada <a@x>"] }),
    change("delta-blocked", "blocked"),
  ];

  it("is closed by default and mounts no rows until opened, then remembers", async () => {
    stub(0, withEpics(ROWS));
    await mount();
    expect(head()?.getAttribute("aria-expanded")).toBe("false");
    expect(list()).toBeNull();
    expect(root.querySelector(".rex-dash-epic")).toBeNull();
    // The count reads while closed.
    expect(root.querySelector(".rex-dash-epics .rex-dash-section-meta")?.textContent).toBe("4 changes");

    openSection();
    expect(head()?.getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem("ndx.rex-dash.epics-open")).toBe("true");
    render(null, root);
    root.remove();
    await mount();
    expect(list()).not.toBeNull();
  });

  it("hides completed rows by default and lists in progress first", async () => {
    stub(0, withEpics(ROWS));
    await mount();
    openSection();
    expect(titles()).toEqual(["charlie-active", "bravo-pending", "delta-blocked"]);
    expect(root.querySelector(".rex-dash-epics .rex-dash-section-meta")?.textContent).toBe("3 of 4 changes");

    await setInput('select[aria-label="Status"]', "all", "change");
    expect(titles()).toContain("alpha-done");
    await setInput('select[aria-label="Status"]', "completed", "change");
    expect(titles()).toEqual(["alpha-done"]);
  });

  it("searches by name", async () => {
    stub(0, withEpics(ROWS));
    await mount();
    openSection();
    await setInput('input[type="search"]', "BRAVO", "input");
    expect(titles()).toEqual(["bravo-pending"]);
    await setInput('input[type="search"]', "nothing like it", "input");
    expect(titles()).toEqual([]);
    expect(root.textContent).toContain("No changes match these filters.");
  });

  it("filters by tag and by owner, with an Unassigned choice, and clears", async () => {
    stub(0, withEpics(ROWS));
    await mount();
    openSection();
    const options = (label: string) =>
      [...root.querySelectorAll(`select[aria-label="${label}"] option`)].map((o) => o.textContent);
    expect(options("Tag")).toEqual(["Any tag", "rex", "web"]);
    // Owners read by name, not the "Name <email>" identity.
    expect(options("Owner")).toEqual(["Anyone", "Ada", "Bo", "Unassigned"]);

    await setInput('select[aria-label="Tag"]', "web", "change");
    expect(titles()).toEqual(["charlie-active"]);
    await setInput('select[aria-label="Tag"]', "", "change");

    await setInput('select[aria-label="Owner"]', "Bo <b@x>", "change");
    expect(titles()).toEqual(["charlie-active", "bravo-pending"]);
    await setInput('select[aria-label="Owner"]', "\0unassigned", "change");
    expect(titles()).toEqual(["delta-blocked"]);

    const clear = [...root.querySelectorAll<HTMLButtonElement>("button.rex-dash-epics-toggle")].find((b) => b.textContent === "Clear")!;
    act(() => { clear.click(); });
    expect(titles()).toEqual(["charlie-active", "bravo-pending", "delta-blocked"]);
  });

  it("offers no tag or owner filter when no row has one", async () => {
    stub(0, withEpics([change("plain", "pending")]));
    await mount();
    openSection();
    expect(root.querySelector('select[aria-label="Tag"]')).toBeNull();
    expect(root.querySelector('select[aria-label="Owner"]')).toBeNull();
  });
});
