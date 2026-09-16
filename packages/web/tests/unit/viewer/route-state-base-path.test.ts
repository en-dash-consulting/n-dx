import { describe, it, expect } from "vitest";
import type { ViewId } from "../../../src/viewer/types.js";
import { parsePathnameRoute, resolveLocationRoute } from "../../../src/viewer/route-state.js";

const VIEWS = new Set<ViewId>(["overview", "prd", "hench-runs", "token-usage"]);

describe("route-state under a hub base path", () => {
  it("parses views and deep links identically with and without the prefix", () => {
    expect(parsePathnameRoute("/p/alpha/overview", VIEWS, "/p/alpha")).toEqual(parsePathnameRoute("/overview", VIEWS));
    expect(parsePathnameRoute("/p/alpha/prd/task-1", VIEWS, "/p/alpha")).toEqual({ view: "prd", subId: "task-1" });
    expect(parsePathnameRoute("/p/alpha/hench-runs/run-9", VIEWS, "/p/alpha")).toEqual({ view: "hench-runs", subId: "run-9" });
  });

  it("treats the bare base path as the root (no view)", () => {
    expect(parsePathnameRoute("/p/alpha", VIEWS, "/p/alpha")).toBeNull();
    expect(parsePathnameRoute("/p/alpha/", VIEWS, "/p/alpha")).toBeNull();
  });

  it("does not misread a project id as a view when the base path is not supplied", () => {
    // Without the base path the first segment is "p", which is not a view.
    expect(parsePathnameRoute("/p/alpha/overview", VIEWS)).toBeNull();
  });

  it("resolveLocationRoute threads the base path through and still prefers a legacy hash", () => {
    expect(resolveLocationRoute("/p/alpha/prd/t", "", VIEWS, "/p/alpha")).toEqual({ view: "prd", subId: "t" });
    expect(resolveLocationRoute("/p/alpha/prd/t", "#token-usage", VIEWS, "/p/alpha")).toEqual({ view: "token-usage", subId: null });
  });
});
