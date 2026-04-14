import { describe, it, expect } from "vitest";
import {
  SOURCEVISION_TABS,
  SOURCEVISION_TAB_IDS,
  type SourceVisionTab,
  type SourceVisionTabId,
  ENRICHMENT_THRESHOLDS,
} from "../../../src/viewer/views/index.js";

describe("SOURCEVISION_TABS", () => {
  it("defines exactly 9 tabs", () => {
    expect(SOURCEVISION_TABS).toHaveLength(9);
  });

  it("every tab has required fields", () => {
    for (const tab of SOURCEVISION_TABS) {
      expect(tab.id).toBeTruthy();
      expect(typeof tab.icon).toBe("string");
      expect(tab.label).toBeTruthy();
      expect(typeof tab.minPass).toBe("number");
      expect(tab.minPass).toBeGreaterThanOrEqual(0);
    }
  });

  it("tab IDs are unique", () => {
    const ids = SOURCEVISION_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains all expected tab IDs", () => {
    const ids = SOURCEVISION_TABS.map((t) => t.id);
    expect(ids).toContain("overview");
    expect(ids).toContain("graph");
    expect(ids).toContain("zones");
    expect(ids).toContain("files");
    expect(ids).toContain("routes");
    expect(ids).toContain("architecture");
    expect(ids).toContain("problems");
    expect(ids).toContain("suggestions");
    expect(ids).toContain("pr-markdown");
  });

  it("enrichment-gated tabs reference correct thresholds", () => {
    const arch = SOURCEVISION_TABS.find((t) => t.id === "architecture")!;
    const problems = SOURCEVISION_TABS.find((t) => t.id === "problems")!;
    const suggestions = SOURCEVISION_TABS.find((t) => t.id === "suggestions")!;

    expect(arch.minPass).toBe(ENRICHMENT_THRESHOLDS.architecture);
    expect(problems.minPass).toBe(ENRICHMENT_THRESHOLDS.problems);
    expect(suggestions.minPass).toBe(ENRICHMENT_THRESHOLDS.suggestions);
  });

  it("ungated tabs have minPass of 0", () => {
    const ungated = SOURCEVISION_TABS.filter(
      (t) => !["architecture", "problems", "suggestions"].includes(t.id),
    );
    for (const tab of ungated) {
      expect(tab.minPass).toBe(0);
    }
  });
});

describe("SOURCEVISION_TAB_IDS", () => {
  it("matches the IDs extracted from SOURCEVISION_TABS", () => {
    expect(SOURCEVISION_TAB_IDS).toEqual(SOURCEVISION_TABS.map((t) => t.id));
  });

  it("has the same length as SOURCEVISION_TABS", () => {
    expect(SOURCEVISION_TAB_IDS).toHaveLength(SOURCEVISION_TABS.length);
  });
});
