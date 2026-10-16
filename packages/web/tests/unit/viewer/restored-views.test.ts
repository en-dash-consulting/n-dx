/**
 * Restored-view registration guard — `zones` and `analysis` must be reachable.
 *
 * Both views existed as complete components while absent from the view
 * registry and navigation (zones was removed from tabs in PR #189 before
 * the expandable-zones feature work landed in PRs #317/#321; analysis was
 * never registered after the web-package extraction). These tests pin the
 * full registration chain so a future registry refactor cannot silently
 * orphan them again.
 */
import { describe, it, expect } from "vitest";
import type { ViewId, LoadedData } from "../../../src/viewer/types.js";
import { emptyJobTray } from "../../helpers/job-tray.js";
import {
  renderActiveView,
  type ViewRenderContext,
} from "../../../src/viewer/views/view-registry.js";
import {
  SOURCEVISION_SCOPE_VIEWS,
  REX_SCOPE_VIEWS,
  buildValidViews,
} from "../../../src/shared/index.js";
import { STAGES, viewLabel } from "../../../src/viewer/views/index.js";

const emptyData: LoadedData = {
  manifest: null,
  inventory: null,
  imports: null,
  zones: null,
  components: null,
  callGraph: null,
};

function makeCtx(): ViewRenderContext {
  return {
    data: emptyData,
    setDetail: () => {},
    setPrdDetailContent: () => {},
    selectedFile: null,
    setSelectedFile: () => {},
    selectedZone: null,
    selectedRunId: null,
    selectedTaskId: null,
    askSeed: null,
    navigateTo: () => {},
    isFeatureDisabled: () => false,
    askEnabled: false,
    jobs: emptyJobTray(),
  };
}

describe("restored views: routing scope membership", () => {
  it("zones is a sourcevision-scope view", () => {
    expect(SOURCEVISION_SCOPE_VIEWS).toContain("zones");
  });

  it("analysis is a rex-scope view", () => {
    expect(REX_SCOPE_VIEWS).toContain("analysis");
  });

  it("both are valid views in the unscoped viewer", () => {
    const valid = buildValidViews(null);
    expect(valid.has("zones" as ViewId)).toBe(true);
    expect(valid.has("analysis" as ViewId)).toBe(true);
  });

  it("scoped viewers include them only in their own scope", () => {
    expect(buildValidViews("sourcevision").has("zones" as ViewId)).toBe(true);
    expect(buildValidViews("sourcevision").has("analysis" as ViewId)).toBe(false);
    expect(buildValidViews("rex").has("analysis" as ViewId)).toBe(true);
    expect(buildValidViews("rex").has("zones" as ViewId)).toBe(false);
  });
});

describe("restored views: registry renderers", () => {
  it("renderActiveView produces a renderer result for zones", () => {
    expect(renderActiveView("zones" as ViewId, makeCtx())).toBeTruthy();
  });

  it("renderActiveView produces a renderer result for analysis", () => {
    expect(renderActiveView("analysis" as ViewId, makeCtx())).toBeTruthy();
  });
});

describe("restored views: navigation entries", () => {
  // The Analysis stage is the only place SourceVision's views are arranged,
  // so it is where the "zones is reachable, and sits after the map" guard
  // belongs. On the dashboard zones is a tile of its own, after the map.
  it("zones is a tile of the Analysis dashboard, after the codebase map", () => {
    const keys = STAGES.analyze.tiles!.map((t) => t.panel ?? t.view);
    expect(keys).toContain("zones");
    expect(keys.indexOf("map")).toBeLessThan(keys.indexOf("zones"));
  });

  it("zones is named by the navigation model", () => {
    expect(viewLabel("zones")).toBe("Zones");
  });

  it("analysis is a section of the Plan stage", () => {
    expect(STAGES.plan.sections.map((s) => s.view)).toContain("analysis");
  });
});
