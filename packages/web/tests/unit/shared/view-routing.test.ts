import { describe, expect, it } from "vitest";
import {
  SOURCEVISION_SCOPE_VIEWS,
  CROSS_CUTTING_VIEWS,
  buildValidViews,
  isKnownViewPath,
} from "../../../src/shared/view-routing.js";

describe("view routing contract", () => {
  it("builds sourcevision-scoped views from the shared contract", () => {
    const views = buildValidViews("sourcevision");

    for (const view of SOURCEVISION_SCOPE_VIEWS) {
      expect(views.has(view)).toBe(true);
    }

    for (const view of CROSS_CUTTING_VIEWS) {
      expect(views.has(view)).toBe(true);
    }

    expect(views.has("prd")).toBe(false);
  });

  it("treats known SPA paths as shared routing state", () => {
    expect(isKnownViewPath("overview")).toBe(true);
    expect(isKnownViewPath("hench-runs")).toBe(true);
    expect(isKnownViewPath("unknown-view")).toBe(false);
  });
});
