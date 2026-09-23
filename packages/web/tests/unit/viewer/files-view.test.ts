// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { FilesView } from "../../../src/viewer/views/files.js";
import type { LoadedData } from "../../../src/viewer/types.js";
import type { Inventory } from "../../../src/viewer/external.js";

function makeData(overrides: Partial<Inventory["summary"]> = {}): LoadedData {
  return {
    manifest: null,
    inventory: {
      files: [
        {
          path: "src/app.ts",
          size: 100,
          language: "TypeScript",
          lineCount: 10,
          hash: "abc",
          role: "source",
          category: "src",
        },
      ],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { src: 1 },
        ...overrides,
      },
    } as Inventory,
    imports: null,
    zones: null,
    components: null,
    callGraph: null,
  };
}

describe("FilesView — language analysis strip", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  async function renderView(data: LoadedData) {
    act(() => {
      render(h(FilesView, { data, onSelect: () => {} }), root);
    });
    await act(async () => {});
  }

  it("renders the strip above the data table when analysedLanguages/skippedExtensions are present", async () => {
    const data = makeData({
      byLanguage: { TypeScript: 412, JavaScript: 88, Markdown: 31, Zig: 14 },
      analysedLanguages: ["TypeScript", "JavaScript"],
      skippedExtensions: { ".zig": 14, ".toml": 3 },
    });

    await renderView(data);

    const strip = root.querySelector(".language-analysis-strip");
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toContain("Analysed: TypeScript (412), JavaScript (88)");
    expect(strip!.textContent).toContain("Inventoried only: Markdown (31), Zig (14)");
    expect(strip!.textContent).toContain("Skipped: .zig (14), .toml (3)");

    // Strip precedes the table in document order.
    const table = root.querySelector(".data-table-wrapper");
    expect(table).not.toBeNull();
    expect(
      strip!.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("degrades gracefully when the new summary fields are absent (old inventory)", async () => {
    const data = makeData(); // no analysedLanguages / skippedExtensions

    await renderView(data);

    const strip = root.querySelector(".language-analysis-strip");
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toBe("Inventoried: TypeScript (1)");
  });

  it("does not introduce a new view id or route — same table renders regardless", async () => {
    const data = makeData();
    await renderView(data);
    expect(root.querySelector(".data-table")).not.toBeNull();
  });
});
