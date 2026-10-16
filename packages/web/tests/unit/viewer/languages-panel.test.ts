// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { LanguagesPanel } from "../../../src/viewer/views/overview.js";
import type { LoadedData } from "../../../src/viewer/types.js";

const file = (path: string, language: string, lineCount: number) => ({ path, language, lineCount, size: 1, hash: path, role: "source", category: "x", lastModified: 0 });

const data = {
  manifest: null, imports: null, zones: null, components: null,
  inventory: {
    files: [file("a.cs", "C#", 100), file("b.cs", "C#", 50), file("p.aspx", "ASP.NET", 30), file("s.js", "JavaScript", 10)],
    summary: {
      totalFiles: 4, totalLines: 190,
      byLanguage: { "C#": 2, "ASP.NET": 1, JavaScript: 1 },
      byRole: {}, byCategory: {},
      analysedLanguages: ["C#", "ASP.NET", "JavaScript"].slice(0, 2),
      skippedExtensions: { ".png": 12, ".md": 3 },
    },
  },
} as unknown as LoadedData;

let root: HTMLElement | undefined;
function show(opened: boolean): HTMLElement {
  root = document.createElement("div");
  act(() => { render(h(LanguagesPanel, { data, opened }), root!); });
  return root;
}
afterEach(() => { if (root) act(() => { render(null, root!); }); });

describe("LanguagesPanel", () => {
  it("shows the top languages as bars in the tile, with no table", () => {
    const el = show(false);
    expect(el.querySelector("table")).toBeNull();
    expect(el.textContent).toContain("C#");
  });

  it("opens to every language with files, lines, share and import analysis, plus skipped extensions", () => {
    const el = show(true);
    const rows = [...el.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
    expect(rows).toEqual([
      ["C#", "2", "150", "50%", "analysed"],
      ["ASP.NET", "1", "30", "25%", "analysed"],
      ["JavaScript", "1", "10", "25%", "inventoried only"],
    ]);
    expect(el.querySelector(".languages-skipped")?.textContent).toBe("Skipped: .png (12) · .md (3)");
  });

  it("gives C# and ASP.NET distinct colours", () => {
    const swatches = [...show(true).querySelectorAll<HTMLElement>(".languages-swatch")].map((s) => s.style.background);
    expect(swatches[0]).not.toBe(swatches[1]);
  });
});
