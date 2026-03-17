// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { SuggestionsView } from "../../../src/viewer/views/suggestions.js";
import type { LoadedData } from "../../../src/viewer/types.js";

function makeData(overrides: Partial<LoadedData["zones"]> = {}): LoadedData {
  return {
    manifest: null,
    inventory: null,
    imports: null,
    zones: {
      enrichmentPass: 0,
      communities: [],
      crossings: [],
      findings: [],
      insights: [],
      ...overrides,
    } as LoadedData["zones"],
    components: null,
    callGraph: null,
  };
}

describe("SuggestionsView", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("shows locked view when enrichment pass is below threshold", () => {
    const data = makeData({ enrichmentPass: 2 });
    render(h(SuggestionsView, { data }), root);

    expect(root.textContent).toContain("Suggestions");
    expect(root.textContent).toContain("Requires enrichment pass 4");
    expect(root.querySelector(".locked-view")).not.toBeNull();
  });

  it("shows locked view with current pass number", () => {
    const data = makeData({ enrichmentPass: 3 });
    render(h(SuggestionsView, { data }), root);

    expect(root.textContent).toContain("current: 3");
  });

  it("renders unlocked view when enrichment pass meets threshold", () => {
    const data = makeData({
      enrichmentPass: 4,
      findings: [
        { type: "suggestion", severity: "info", scope: "global", text: "Use barrel exports", pass: 1 },
        { type: "suggestion", severity: "warning", scope: "zone-a", text: "Extract shared utils", pass: 2 },
      ],
    });
    render(h(SuggestionsView, { data }), root);

    expect(root.querySelector(".locked-view")).toBeNull();
    expect(root.textContent).toContain("Suggestions");
    expect(root.textContent).toContain("2 suggestions for improvement");
  });

  it("counts global vs zone-specific suggestions correctly", () => {
    const data = makeData({
      enrichmentPass: 5,
      findings: [
        { type: "suggestion", severity: "info", scope: "global", text: "Global one", pass: 1 },
        { type: "suggestion", severity: "info", scope: "global", text: "Global two", pass: 1 },
        { type: "suggestion", severity: "warning", scope: "zone-x", text: "Zone one", pass: 2 },
        { type: "observation", severity: "info", scope: "global", text: "Not a suggestion", pass: 1 },
      ],
    });
    render(h(SuggestionsView, { data }), root);

    // Should only count suggestion-type findings
    expect(root.textContent).toContain("3 suggestions for improvement");
    // Stat cards
    const values = root.querySelectorAll(".stat-card .value");
    expect(values.length).toBe(3);
    expect(values[0]?.textContent).toBe("2"); // global
    expect(values[1]?.textContent).toBe("1"); // zone-specific
    expect(values[2]?.textContent).toBe("1"); // zones affected
  });

  it("filters out non-suggestion findings", () => {
    const data = makeData({
      enrichmentPass: 4,
      findings: [
        { type: "observation", severity: "info", scope: "global", text: "Observation", pass: 1 },
        { type: "anti-pattern", severity: "warning", scope: "zone-a", text: "Anti-pattern", pass: 1 },
      ],
    });
    render(h(SuggestionsView, { data }), root);

    expect(root.textContent).toContain("0 suggestions for improvement");
  });

  it("handles null zones gracefully", () => {
    const data: LoadedData = {
      manifest: null,
      inventory: null,
      imports: null,
      zones: null,
      components: null,
      callGraph: null,
    };
    render(h(SuggestionsView, { data }), root);

    // enrichmentPass defaults to 0, should show locked view
    expect(root.querySelector(".locked-view")).not.toBeNull();
  });

  it("counts distinct zones affected", () => {
    const data = makeData({
      enrichmentPass: 4,
      findings: [
        { type: "suggestion", severity: "info", scope: "zone-a", text: "S1", pass: 1 },
        { type: "suggestion", severity: "info", scope: "zone-a", text: "S2", pass: 1 },
        { type: "suggestion", severity: "info", scope: "zone-b", text: "S3", pass: 1 },
        { type: "suggestion", severity: "info", scope: "zone-c", text: "S4", pass: 2 },
      ],
    });
    render(h(SuggestionsView, { data }), root);

    const values = root.querySelectorAll(".stat-card .value");
    expect(values[2]?.textContent).toBe("3"); // 3 distinct zones
  });
});
