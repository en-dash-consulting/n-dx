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
import {
  renderActiveView,
  type ViewRenderContext,
} from "../../../src/viewer/views/view-registry.js";
import {
  SOURCEVISION_SCOPE_VIEWS,
  REX_SCOPE_VIEWS,
  buildValidViews,
} from "../../../src/shared/index.js";
import { SOURCEVISION_TABS } from "../../../src/viewer/views/index.js";

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
  it("zones appears in the sourcevision tab strip after Map", () => {
    const ids = SOURCEVISION_TABS.map((t) => t.id);
    const graphIdx = ids.indexOf("graph");
    const zonesIdx = ids.indexOf("zones" as (typeof ids)[number]);
    expect(zonesIdx).toBeGreaterThan(graphIdx);
    expect(SOURCEVISION_TABS[zonesIdx].label).toBe("Zones");
    expect(SOURCEVISION_TABS[zonesIdx].minPass).toBe(0);
  });
});
