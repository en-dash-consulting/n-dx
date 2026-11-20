// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PlanProcess, PROCESS_STEPS, processFocus } from "../../../src/viewer/views/plan-process.js";
import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
import { STAGES, tilesForLayout, type StageTile } from "../../../src/viewer/views/stages.js";
import { TileGrid } from "../../../src/viewer/views/stage-tiles.js";
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

  it("names the Describe a change tile at Capture, not the old capture bar", () => {
    const capture = PROCESS_STEPS.find((s) => s.id === "capture")!;
    expect(capture.does).toBe("Describe an idea in the Describe a change tile; it lands in the Inbox");
    expect(capture.does).not.toMatch(/capture bar/i);
  });
});

describe("processFocus", () => {
  it("asks for a capture when nothing is open", () => {
    expect(processFocus(EMPTY)).toEqual({ step: "capture", cue: "Nothing open: describe the next idea in the Describe a change tile" });
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

  it("ranks Apply first under applyOn complete and review, where a steward applies", () => {
    for (const applyOn of ["complete", "review"] as const) {
      expect(processFocus(summary({ applyOn, inbox: 2, stages: { "awaiting-apply": 2 } }))).toEqual({
        step: "apply",
        cue: "2 changes done: apply them to the product map",
      });
    }
  });

  it("under applyOn release, never asks to apply by hand and ranks placement ahead of it", () => {
    const s = summary({ applyOn: "release", inbox: 1, stages: { "awaiting-apply": 2 } });
    expect(processFocus(s).step).toBe("place");
    expect(processFocus(summary({ applyOn: "release", stages: { "awaiting-apply": 1, "in-progress": 1 } })).step).toBe("work");
    expect(processFocus(summary({ applyOn: "release", stages: { "awaiting-apply": 1, proposed: 1 } })).step).toBe("ready");
  });

  it("under applyOn release, says done changes wait for the release when nothing else is open", () => {
    expect(processFocus(summary({ applyOn: "release", stages: { "awaiting-apply": 2 } }))).toEqual({
      step: "apply",
      cue: "2 changes done: they apply to the product map at the next rex release",
    });
  });

  it("asks for work when a change can run", () => {
    expect(processFocus(summary({ stages: { proposed: 5, ready: 2 } }))).toEqual({
      step: "work",
      cue: "2 changes ready to run: start the next pick in Work",
    });
  });

  it("asks for a requirement, then rex ready, while placed changes lack one", () => {
    expect(processFocus(summary({ stages: { proposed: 3 }, requirements: { total: 1, uncovered: 2 } }))).toEqual({
      step: "ready",
      cue: "3 changes placed but not marked ready: add an automated requirement to the 2 without one, then run rex ready",
    });
  });

  it("asks only for rex ready when every placed change has a requirement", () => {
    expect(processFocus(summary({ stages: { proposed: 1 }, requirements: { total: 2, uncovered: 0 } }))).toEqual({
      step: "ready",
      cue: "1 change placed but not marked ready: run rex ready",
    });
  });

  it("never says a placed change cannot run", () => {
    for (const s of [summary({ stages: { proposed: 2 } }), summary({ stages: { proposed: 2 }, requirements: { total: 0, uncovered: 2 } })]) {
      expect(processFocus(s).cue).not.toMatch(/cannot run|not runnable/);
    }
    expect(PROCESS_STEPS.find((s) => s.id === "ready")!.does).not.toMatch(/cannot run|so it can run|not runnable/);
  });

  it("ranks work in progress ahead of placed changes not marked ready", () => {
    expect(processFocus(summary({ stages: { proposed: 4, "in-progress": 1 }, requirements: { total: 0, uncovered: 4 } }))).toEqual({
      step: "work",
      cue: "1 change in progress: follow it in Work",
    });
  });

  it("ranks rex's next pick ahead of placed changes not marked ready", () => {
    const next = { id: "task-1", title: "Show the total", type: "task", changeId: "c1", changeTitle: "Pay", reason: "priority", summary: "Highest priority" } as const;
    expect(processFocus(summary({ stages: { proposed: 4 }, requirements: { total: 0, uncovered: 4 }, next }))).toEqual({
      step: "work",
      cue: "rex's next pick is waiting: start \"Show the total\" in Work",
    });
  });

  it("with changes ready beside work in progress, points at the ready ones", () => {
    expect(processFocus(summary({ stages: { ready: 2, "in-progress": 3 } }))).toEqual({
      step: "work",
      cue: "2 changes ready to run: start the next pick in Work",
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

  it("links Work to Work with nothing selected when rex has no next pick", async () => {
    await mount(summary({ stages: { "in-progress": 1 }, next: null }));
    expect(step("work").classList.contains("pp-step--next")).toBe(true);
    click("work");
    expect(navigateTo).toHaveBeenCalledWith("work", undefined);
  });

  it("renders nothing while the summary loads", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    await act(async () => { render(h(ChangesSummaryProvider, null, h(PlanProcess, { navigateTo })), root); });
    expect(root.childNodes).toHaveLength(0);
  });

  it("renders nothing when the summary read fails, leaving the error to the lifecycle strip", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) })));
    await act(async () => { render(h(ChangesSummaryProvider, null, h(PlanProcess, { navigateTo })), root); });
    await act(async () => {});
    expect(root.childNodes).toHaveLength(0);
  });

  it("renders nothing on a v1 tree", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ layout: "v1" }) })));
    await act(async () => { render(h(ChangesSummaryProvider, null, h(PlanProcess, { navigateTo })), root); });
    await act(async () => {});
    expect(root.childNodes).toHaveLength(0);
  });

  it("links Capture to the Describe a change input on the page, focusing it", async () => {
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

  it("opens Add Items when the Describe a change input is not on the page", async () => {
    await mount(EMPTY);
    click("capture");
    expect(navigateTo).toHaveBeenCalledWith("analysis");
  });
});

describe("the process band while the summary is not there", () => {
  // The one rule, from the stylesheet itself: jsdom computes it, where the
  // whole sheet's modern syntax would not parse.
  const css = readFileSync(resolve(__dirname, "../../../src/viewer/styles/stage-tiles.css"), "utf8");
  const emptyRule = css.match(/\.stage-band:empty\s*\{[^}]*\}/)?.[0];
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = emptyRule ?? "";
    document.head.appendChild(style);
  });
  afterEach(() => style.remove());

  async function mountBand(fetchImpl: () => Promise<unknown>) {
    vi.stubGlobal("fetch", vi.fn(fetchImpl));
    const tile: StageTile = { view: "changes", panel: "process", title: "How planning works", band: true };
    await act(async () => {
      render(h(ChangesSummaryProvider, null, h(TileGrid, {
        stage: "plan",
        tiles: [tile],
        tabsOf: (t) => [{ view: t.view }],
        renderView: () => null,
        renderPanel: () => h(PlanProcess, { navigateTo }),
        renderSummary: () => null,
      })), root);
    });
    await act(async () => {});
    return root.querySelector<HTMLElement>(".stage-band[data-tile='process']")!;
  }

  it("hides the band, border and label included, while the summary loads", async () => {
    expect(emptyRule).toBeDefined();
    const band = await mountBand(() => new Promise(() => {}));
    expect(band.childNodes).toHaveLength(0);
    expect(band.matches(":empty")).toBe(true);
    expect(getComputedStyle(band).display).toBe("none");
  });

  it("hides the band after the summary read fails", async () => {
    const band = await mountBand(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    expect(band.childNodes).toHaveLength(0);
    expect(getComputedStyle(band).display).toBe("none");
  });

  it("shows the band once the summary is in", async () => {
    const band = await mountBand(async () => ({ ok: true, json: async () => ({ layout: "v2", summary: EMPTY }) }));
    expect(band.querySelector(".plan-process")).not.toBeNull();
    expect(getComputedStyle(band).display).not.toBe("none");
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
