import { describe, expect, it } from "vitest";
import {
  SOURCEVISION_SCOPE_VIEWS,
  CROSS_CUTTING_VIEWS,
  buildValidViews,
  isKnownViewPath,
  resolveViewAlias,
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

describe("redirect aliases (0.8.0 navigation merge)", () => {
  it("overview redirects to analyze in every scope that has it", () => {
    expect(resolveViewAlias("overview", buildValidViews(null))).toBe("analyze");
    expect(resolveViewAlias("overview", buildValidViews("sourcevision"))).toBe("analyze");
  });

  it("rex-dashboard redirects to work in the full dashboard", () => {
    expect(resolveViewAlias("rex-dashboard", buildValidViews(null))).toBe("work");
  });

  it("rex-dashboard stays its own page in a rex-scoped viewer, which has no Work stage", () => {
    const rexViews = buildValidViews("rex");
    expect(rexViews.has("work")).toBe(false);
    expect(rexViews.has("rex-dashboard")).toBe(true);
    expect(resolveViewAlias("rex-dashboard", rexViews)).toBeNull();
  });

  it("the four merged settings pages redirect to project in every scope, rex included", () => {
    for (const old of ["project-settings", "feature-toggles", "notion-config", "integrations"]) {
      for (const scope of [null, "sourcevision", "rex", "hench"]) {
        expect(resolveViewAlias(old, buildValidViews(scope)), `${old} in ${scope ?? "all"}`).toBe("project");
      }
    }
  });

  it("project is valid in every scope, and the merged ids are no longer views", () => {
    for (const scope of [null, "sourcevision", "rex", "hench"]) {
      expect(buildValidViews(scope).has("project")).toBe(true);
    }
    for (const old of ["project-settings", "feature-toggles", "notion-config", "integrations"]) {
      expect(isKnownViewPath(old)).toBe(false);
    }
  });

  it("live full-page views (#425) are not aliased", () => {
    const validViews = buildValidViews(null);
    for (const view of ["graph", "iso-map", "zones", "architecture", "routes"]) {
      expect(resolveViewAlias(view, validViews)).toBeNull();
    }
  });

  it("an unrecognised segment resolves to no alias", () => {
    expect(resolveViewAlias("not-a-view", buildValidViews(null))).toBeNull();
  });
});
