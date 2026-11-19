// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";

import { PlanProcess, PROCESS_STEPS, processFocus } from "../../../src/viewer/views/plan-process.js";
import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
import { STAGES, tilesForLayout } from "../../../src/viewer/views/stages.js";
import type { ChangeSummary } from "../../../src/viewer/views/product-model.js";

const EMPTY: ChangeSummary = {
  inbox: 0,
  inboxInStage: 0,
  stages: { proposed: 0, ready: 0, "in-progress": 0, "awaiting-apply": 0 },
  open: [],
  requirements: { total: 0, uncovered: 0 },
  next: null,
};

const summary = (over: Partial<Omit<ChangeSummary, "stages">> & { stages?: Partial<ChangeSummary["stages"]> } = {}): ChangeSummary => ({
  ...EMPTY,
  ...over,
  stages: { ...EMPTY.stages, ...over.stages },
});

let root: HTMLElement;
const navigateTo = vi.fn();

function answer(body: ChangeSummary) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ layout: "v2", summary: body }) })));
}

async function mount(body: ChangeSummary) {
  answer(body);
  await act(async () => { render(h(ChangesSummaryProvider, null, h(PlanProcess, { navigateTo })), root); });
  await act(async () => {});
}

const step = (id: string) => root.querySelector<HTMLElement>(`.pp-step[data-step="${id}"]`)!;
const click = (id: string) => act(() => step(id).querySelector<HTMLButtonElement>(".pp-link")!.click());

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  navigateTo.mockReset();
  localStorage.clear();
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

describe("PROCESS_STEPS", () => {
  it("runs capture, place, ready, work, apply, in that order, each with one line of what to do", () => {
    expect(PROCESS_STEPS.map((s) => s.id)).toEqual(["capture", "place", "ready", "work", "apply"]);
    for (const s of PROCESS_STEPS) {
      expect(s.does.length).toBeGreaterThan(0);
      expect(s.does).not.toContain("\n");
    }
  });
});

describe("processFocus", () => {
  it("asks for a capture when nothing is open", () => {
    expect(processFocus(EMPTY)).toEqual({ step: "capture", cue: "Nothing open: describe the next idea in the capture bar" });
  });

  it("asks for placing while Inbox changes wait for a place", () => {
    expect(processFocus(summary({ inbox: 3, stages: { proposed: 2, ready: 1 } }))).toEqual({
      step: "place",
      cue: "3 changes in the Inbox waiting for a place on the map",
    });
  });

  it("does not ask for placing Inbox changes that have no capability to go on", () => {
    expect(processFocus(summary({ inbox: 2, inboxInStage: 2, stages: { proposed: 2 } })).step).toBe("ready");
  });

  it("puts applying finished work first, ahead of the Inbox", () => {
    expect(processFocus(summary({ inbox: 4, stages: { "awaiting-apply": 1, ready: 2 } }))).toEqual({
      step: "apply",
      cue: "1 change done: apply it to the product map",
    });
  });

  it("asks for work when a change can run", () => {
    expect(processFocus(summary({ stages: { proposed: 5, ready: 2 } }))).toEqual({
      step: "work",
      cue: "2 changes ready to run: start the next pick in Work",
    });
  });

  it("asks for making placed changes ready when none can run", () => {
    expect(processFocus(summary({ stages: { proposed: 1, "in-progress": 1 } }))).toEqual({
      step: "ready",
      cue: "1 change placed but not runnable: add an automated requirement",
    });
  });

  it("points at work in progress when that is all that is open", () => {
    expect(processFocus(summary({ stages: { "in-progress": 2 } }))).toEqual({
      step: "work",
      cue: "2 changes in progress: follow them in Work",
    });
  });
});

describe("PlanProcess", () => {
  it("draws the five steps in order, each with its description", async () => {
    await mount(EMPTY);
    const steps = [...root.querySelectorAll<HTMLElement>(".pp-step")];
    expect(steps.map((s) => s.dataset.step)).toEqual(["capture", "place", "ready", "work", "apply"]);
    expect(steps.map((s) => s.querySelector(".pp-label")?.textContent)).toEqual(["Capture", "Place", "Ready", "Work", "Apply"]);
    for (const [i, s] of steps.entries()) {
      const does = s.querySelector(".pp-does")!;
      expect(does.textContent).toBe(PROCESS_STEPS[i]!.does);
      expect(s.querySelector(".pp-link")!.getAttribute("aria-describedby")).toBe(does.id);
    }
  });

  it("marks only the step to do next, with its cue", async () => {
    await mount(summary({ inbox: 2 }));
    const marked = [...root.querySelectorAll<HTMLElement>(".pp-step--next")];
    expect(marked.map((s) => s.dataset.step)).toEqual(["place"]);
    expect(step("place").getAttribute("aria-current")).toBe("step");
    expect(step("capture").getAttribute("aria-current")).toBeNull();
    expect(step("place").querySelector(".pp-next-tag")?.textContent).toBe("Do this next");
    expect(root.querySelectorAll(".pp-next-tag")).toHaveLength(1);
    expect(root.querySelector(".pp-cue-text")?.textContent).toBe("2 changes in the Inbox waiting for a place on the map");
  });

  it("links Place to the Inbox", async () => {
    await mount(EMPTY);
    click("place");
    expect(navigateTo).toHaveBeenCalledWith("inbox");
  });

  it("links Ready and Apply to Open changes filtered to their stage", async () => {
    await mount(EMPTY);
    click("ready");
    expect(navigateTo).toHaveBeenLastCalledWith("changes");
    expect(localStorage.getItem("ndx.changes.filter")).toBe("stage:proposed");
    click("apply");
    expect(navigateTo).toHaveBeenLastCalledWith("changes");
    expect(localStorage.getItem("ndx.changes.filter")).toBe("stage:awaiting-apply");
  });

  it("links Work to Work with rex's next pick selected", async () => {
    await mount(summary({
      stages: { ready: 1 },
      next: { id: "task-9", title: "Wire it", type: "task", changeId: "c1", changeTitle: "Glance", reason: "priority", summary: "Highest priority" },
    }));
    click("work");
    expect(navigateTo).toHaveBeenCalledWith("work", { taskId: "task-9" });
  });

  it("links Capture to the capture bar on the page, focusing it", async () => {
    const bar = document.createElement("textarea");
    bar.className = "smart-add-textarea";
    document.body.appendChild(bar);
    try {
      await mount(EMPTY);
      click("capture");
      expect(document.activeElement).toBe(bar);
      expect(navigateTo).not.toHaveBeenCalled();
    } finally {
      bar.remove();
    }
  });

  it("opens Add Items when the capture bar is not on the page", async () => {
    await mount(EMPTY);
    click("capture");
    expect(navigateTo).toHaveBeenCalledWith("analysis");
  });
});

describe("Plan layout", () => {
  const bands = (layout: "v1" | "v2") => tilesForLayout(STAGES.plan, layout).filter((t) => t.band).map((t) => t.panel);

  it("shows the process above the lifecycle strip on v2, complementing it", () => {
    expect(bands("v2")).toEqual(["process", "flow"]);
  });

  it("drops the process on v1, which has no Inbox, placement or apply", () => {
    expect(bands("v1")).toEqual(["flow"]);
  });
});
