// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  buildLanguageStripGroups,
  LanguageAnalysisStrip,
} from "../../../src/viewer/components/language-analysis-strip.js";

describe("buildLanguageStripGroups", () => {
  it("splits Analysed vs Inventoried only when analysedLanguages is present", () => {
    const groups = buildLanguageStripGroups({
      byLanguage: { TypeScript: 412, JavaScript: 88, Zig: 14, Markdown: 31 },
      analysedLanguages: ["TypeScript", "JavaScript"],
    });

    expect(groups).toEqual([
      {
        heading: "Analysed",
        entries: [
          { label: "TypeScript", count: 412 },
          { label: "JavaScript", count: 88 },
        ],
      },
      {
        heading: "Inventoried only",
        entries: [
          { label: "Markdown", count: 31 },
          { label: "Zig", count: 14 },
        ],
      },
    ]);
  });

  it("adds a Skipped group from skippedExtensions", () => {
    const groups = buildLanguageStripGroups({
      byLanguage: { TypeScript: 412 },
      analysedLanguages: ["TypeScript"],
      skippedExtensions: { ".zig": 14, ".toml": 3 },
    });

    expect(groups).toContainEqual({
      heading: "Skipped",
      entries: [
        { label: ".zig", count: 14 },
        { label: ".toml", count: 3 },
      ],
    });
  });

  it("degrades to a single neutral Inventoried group when analysedLanguages is absent", () => {
    // Simulates an inventory produced before this field existed.
    const groups = buildLanguageStripGroups({
      byLanguage: { TypeScript: 5, Markdown: 2 },
    });

    expect(groups).toEqual([
      {
        heading: "Inventoried",
        entries: [
          { label: "TypeScript", count: 5 },
          { label: "Markdown", count: 2 },
        ],
      },
    ]);
  });

  it("still shows Skipped when analysedLanguages is absent but skippedExtensions is present", () => {
    const groups = buildLanguageStripGroups({
      byLanguage: { TypeScript: 5 },
      skippedExtensions: { ".md": 2 },
    });

    expect(groups.map((g) => g.heading)).toEqual(["Inventoried", "Skipped"]);
  });

  it("omits empty groups entirely", () => {
    const groups = buildLanguageStripGroups({ byLanguage: {} });
    expect(groups).toEqual([]);
  });

  it("does not render an Inventoried only group when every language is analysed", () => {
    const groups = buildLanguageStripGroups({
      byLanguage: { TypeScript: 5 },
      analysedLanguages: ["TypeScript"],
    });

    expect(groups.map((g) => g.heading)).toEqual(["Analysed"]);
  });
});

describe("LanguageAnalysisStrip", () => {
  let root: HTMLDivElement;

  function renderStrip(props: Parameters<typeof LanguageAnalysisStrip>[0]) {
    root = document.createElement("div");
    document.body.appendChild(root);
    act(() => {
      render(h(LanguageAnalysisStrip, props), root);
    });
  }

  it("renders the worked example from the ticket", () => {
    renderStrip({
      summary: {
        byLanguage: { TypeScript: 412, JavaScript: 88, Markdown: 31, Zig: 14 },
        analysedLanguages: ["TypeScript", "JavaScript"],
        skippedExtensions: { ".zig": 14, ".toml": 3 },
      },
    });

    expect(root.textContent).toBe(
      "Analysed: TypeScript (412), JavaScript (88) · Inventoried only: Markdown (31), Zig (14) · Skipped: .zig (14), .toml (3)"
    );
  });

  it("renders nothing when there is no summary", () => {
    renderStrip({ summary: null });
    expect(root.textContent).toBe("");
    expect(root.querySelector(".language-analysis-strip")).toBeNull();
  });

  it("renders nothing when byLanguage is empty and nothing was skipped", () => {
    renderStrip({ summary: { byLanguage: {} } });
    expect(root.querySelector(".language-analysis-strip")).toBeNull();
  });
});
