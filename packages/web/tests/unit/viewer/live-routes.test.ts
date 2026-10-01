import { describe, it, expect } from "vitest";
import { parsePathnameRoute, viewPathname, isTaskRouteView } from "../../../src/viewer/route-state.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { STAGE_ORDER, STAGES, isLiveView, isStageId, stageForView, LIVE_VIEWS } from "../../../src/viewer/views/stages.js";

const valid = buildValidViews(null);

describe("Live routes", () => {
  it("parses the three Live paths, with or without a workspace or hub prefix", () => {
    expect(parsePathnameRoute("/live", valid)).toEqual({ view: "live", subId: null });
    expect(parsePathnameRoute("/live/analyze", valid)).toEqual({ view: "live-analyze", subId: null });
    expect(parsePathnameRoute("/live/task/abc-123", valid)).toEqual({ view: "live-task", subId: "abc-123" });
    expect(parsePathnameRoute("/p/app/w/feature/live/task/abc-123", valid, "/p/app/w/feature"))
      .toEqual({ view: "live-task", subId: "abc-123" });
  });

  it("does not parse a task page without a task id", () => {
    expect(parsePathnameRoute("/live/task", valid)).toBeNull();
    expect(parsePathnameRoute("/live/nonsense", valid)).toBeNull();
  });

  it("round-trips every Live view through viewPathname", () => {
    expect(viewPathname("live", null)).toBe("/live");
    expect(viewPathname("live-analyze", null)).toBe("/live/analyze");
    expect(viewPathname("live-task", "abc-123")).toBe("/live/task/abc-123");
    expect(parsePathnameRoute(viewPathname("live-task", "t1"), valid)).toEqual({ view: "live-task", subId: "t1" });
  });

  it("leaves other views' paths alone", () => {
    expect(viewPathname("prd", "t1")).toBe("/prd/t1");
    expect(viewPathname("home", null)).toBe("/home");
  });

  it("treats a live-task sub-id as a task id", () => {
    expect(isTaskRouteView("live-task")).toBe(true);
    expect(isTaskRouteView("prd")).toBe(true);
    expect(isTaskRouteView("hench-runs")).toBe(false);
  });
});

describe("Live is outside the stage loop", () => {
  it("is in no stage, and the loop is still Analysis → Plan → Work", () => {
    expect(STAGE_ORDER).toEqual(["analyze", "plan", "work"]);
    for (const view of LIVE_VIEWS) {
      expect(isLiveView(view)).toBe(true);
      expect(isStageId(view)).toBe(false);
      expect(stageForView(view, valid)).toBeNull();
    }
    const listed = STAGE_ORDER.flatMap((s) => STAGES[s].sections.flatMap((x) => [x.view, ...(x.tabs ?? []).map((t) => t.view)]));
    for (const view of LIVE_VIEWS) expect(listed).not.toContain(view);
  });
});
