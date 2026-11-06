// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";

const status = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../../src/viewer/hooks/use-project-status.js", async (orig) => ({
  ...(await orig<object>()),
  useProjectStatus: () => status.value,
}));

import { LifecycleStrip, v1Cells, v2Cells } from "../../../src/viewer/views/lifecycle-strip.js";
import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
import { ChangesView } from "../../../src/viewer/views/changes.js";
import type { ChangeRow, ChangeSummary } from "../../../src/viewer/views/product-model.js";

const SUMMARY: ChangeSummary = {
  inbox: 3,
  stages: { proposed: 4, ready: 0, "in-progress": 2, "awaiting-apply": 1 },
  open: [],
  next: {
    id: "task-9", title: "Wire the strip", type: "task", changeId: "c1", changeTitle: "Glance",
    reason: "in_progress", summary: "Already in progress",
  },
};

let root: HTMLElement;
const navigateTo = vi.fn();

function answer(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
}

async function mount() {
  await act(async () => { render(h(ChangesSummaryProvider, null, h(LifecycleStrip, { navigateTo })), root); });
  await act(async () => {});
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  navigateTo.mockReset();
  localStorage.clear();
  status.value = null;
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

describe("v2Cells", () => {
  it("lists Inbox then the four open stages in lifecycle order", () => {
    expect(v2Cells(SUMMARY).map((c) => [c.label, c.count])).toEqual([
      ["Inbox", 3], ["Proposed", 4], ["Ready", 0], ["In progress", 2], ["Awaiting apply", 1],
    ]);
  });
});

describe("v1Cells", () => {
  it("reads Pending and In progress", () => {
    expect(v1Cells(5, 1).map((c) => [c.label, c.count])).toEqual([["Pending", 5], ["In progress", 1]]);
  });
});

describe("LifecycleStrip on v2", () => {
  it("shows the five counts and the next pick with rex's reason", async () => {
    answer({ layout: "v2", summary: SUMMARY });
    await mount();
    const counts = [...root.querySelectorAll(".ls-cell")].map((c) => c.querySelector(".ls-count")!.textContent);
    expect(counts).toEqual(["3Inbox", "4Proposed", "0Ready", "2In progress", "1Awaiting apply"]);
    expect(root.querySelector(".ls-next-link")?.textContent).toBe("Wire the strip");
    expect(root.querySelector(".ls-next-why")?.textContent).toBe("Already in progress");
  });

  it("opens the Inbox page from the Inbox count", async () => {
    answer({ layout: "v2", summary: SUMMARY });
    await mount();
    act(() => root.querySelector<HTMLButtonElement>('[data-stage="inbox"] .ls-count')!.click());
    expect(navigateTo).toHaveBeenCalledWith("inbox");
  });

  it("opens Open changes filtered to the stage from a stage count", async () => {
    answer({ layout: "v2", summary: SUMMARY });
    await mount();
    act(() => root.querySelector<HTMLButtonElement>('[data-stage="awaiting-apply"] .ls-count')!.click());
    expect(navigateTo).toHaveBeenCalledWith("changes");
    expect(localStorage.getItem("ndx.changes.filter")).toBe("stage:awaiting-apply");
  });

  it("opens Work with the next pick selected", async () => {
    answer({ layout: "v2", summary: SUMMARY });
    await mount();
    act(() => root.querySelector<HTMLButtonElement>(".ls-next-link")!.click());
    expect(navigateTo).toHaveBeenCalledWith("work", { taskId: "task-9" });
  });

  it("explains how an item becomes ready when Ready is zero, and only then", async () => {
    answer({ layout: "v2", summary: SUMMARY });
    await mount();
    expect(root.querySelector('[data-stage="ready"] .ls-hint')?.textContent).toBe("needs an automated requirement · rex ready");
    expect(root.querySelectorAll(".ls-hint")).toHaveLength(1);

    render(null, root);
    answer({ layout: "v2", summary: { ...SUMMARY, stages: { ...SUMMARY.stages, ready: 2 } } });
    await mount();
    expect(root.querySelector(".ls-hint")).toBeNull();
  });

  it("offers no Start or Run control", async () => {
    answer({ layout: "v2", summary: SUMMARY });
    await mount();
    const names = [...root.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(names.some((n) => /start|run/i.test(n))).toBe(false);
  });

  it("says so when nothing can be picked", async () => {
    answer({ layout: "v2", summary: { ...SUMMARY, next: null } });
    await mount();
    expect(root.querySelector(".ls-next-none")?.textContent).toContain("Nothing to pick up");
  });
});

describe("LifecycleStrip on v1", () => {
  it("reads Pending, In progress and Next from project status", async () => {
    answer({ layout: "v1" });
    status.value = { rex: { exists: true, stats: { pending: 7, inProgress: 2 }, nextTaskTitle: "Fix the thing" } };
    await mount();
    expect([...root.querySelectorAll(".ls-count")].map((c) => c.textContent)).toEqual(["7Pending", "2In progress"]);
    expect(root.querySelector(".ls-next-link")?.textContent).toBe("Fix the thing");
    act(() => root.querySelector<HTMLButtonElement>(".ls-next-link")!.click());
    expect(navigateTo).toHaveBeenCalledWith("work", undefined);
  });
});

describe("Changes stage filter", () => {
  const row = (id: string, stage: ChangeRow["stage"], extra: Partial<ChangeRow> = {}): ChangeRow => ({
    id, title: id, stage, amends: [], touches: [], taskCount: 0, completedTaskCount: 0,
    criteriaGap: false, openBlockers: 0, ...extra,
  });

  it("shows only placed changes in the stage the strip opened it on", () => {
    localStorage.setItem("ndx.changes.filter", "stage:ready");
    act(() => {
      render(h(ChangesView, {
        changes: [row("a", "ready"), row("b", "proposed"), row("held", "ready", { awaitsPlacement: true })],
      }), root);
    });
    expect([...root.querySelectorAll(".ch-change")].map((c) => c.getAttribute("data-change-id"))).toEqual(["a"]);
    expect(root.querySelector('.ch-filter[aria-pressed="true"]')?.textContent).toBe("Ready1");
  });
});
