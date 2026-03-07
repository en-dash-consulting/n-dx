// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { BatchImportPanel, BatchItemRow } from "../../../src/viewer/components/prd-tree/batch-import-panel.js";
import type { BatchItem } from "../../../src/viewer/components/prd-tree/batch-import-panel.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

/** Flush microtasks and Preact batched updates. */
async function flush() {
  await new Promise<void>((r) => queueMicrotask(r));
  await new Promise<void>((r) => queueMicrotask(r));
}

describe("BatchImportPanel", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the initial panel with title and drop zone", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    expect(root.querySelector(".batch-import-title")?.textContent).toBe("Batch Import");
    expect(root.querySelector(".batch-import-subtitle")).toBeTruthy();
    expect(root.querySelector(".batch-import-dropzone")).toBeTruthy();
  });

  it("renders the drop zone with file browse button", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const browseBtn = root.querySelector(".batch-import-browse-btn");
    expect(browseBtn).toBeTruthy();
    expect(browseBtn?.textContent).toBe("browse");
  });

  it("renders the add text entry button", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const addBtn = root.querySelector(".batch-import-add-text-btn");
    expect(addBtn).toBeTruthy();
    expect(addBtn?.textContent).toContain("Add text entry");
  });

  it("adds a text entry when add button is clicked", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const addBtn = root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn");
    addBtn?.click();
    await flush();

    // Should now show the queue with one item
    expect(root.querySelector(".batch-import-queue")).toBeTruthy();
    expect(root.querySelector(".batch-import-queue-title")?.textContent).toContain("1 item");
    expect(root.querySelector(".batch-import-item-textarea")).toBeTruthy();
  });

  it("does not show process button when no valid items exist", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    expect(root.querySelector(".batch-import-process-btn")).toBeNull();
  });

  it("does not show queue when no items added", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    expect(root.querySelector(".batch-import-queue")).toBeNull();
  });

  it("has hidden file input that accepts multiple file types", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const fileInput = root.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).toBeTruthy();
    expect(fileInput?.multiple).toBe(true);
    expect(fileInput?.accept).toContain(".txt");
    expect(fileInput?.accept).toContain(".md");
    expect(fileInput?.accept).toContain(".json");
    expect(fileInput?.style.display).toBe("none");
  });

  it("renders format badge for text entries", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    // Add a text entry
    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();

    const badge = root.querySelector(".batch-import-format-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe("TEXT");
  });

  it("provides format selector for each item", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();

    const select = root.querySelector<HTMLSelectElement>(".batch-import-format-select");
    expect(select).toBeTruthy();
    expect(select?.options.length).toBe(3);
    expect(select?.options[0]?.value).toBe("text");
    expect(select?.options[1]?.value).toBe("markdown");
    expect(select?.options[2]?.value).toBe("json");
  });

  it("has remove button for each item", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();

    const removeBtn = root.querySelector(".batch-import-remove-btn");
    expect(removeBtn).toBeTruthy();
    expect(removeBtn?.getAttribute("aria-label")).toBe("Remove item");
  });

  it("removes item when remove button is clicked", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    // Add an item
    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();
    expect(root.querySelector(".batch-import-queue")).toBeTruthy();

    // Remove it
    root.querySelector<HTMLButtonElement>(".batch-import-remove-btn")?.click();
    await flush();

    expect(root.querySelector(".batch-import-queue")).toBeNull();
  });

  it("clears all items when clear all button is clicked", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    // Add two items
    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();
    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();

    expect(root.querySelector(".batch-import-queue-title")?.textContent).toContain("2 items");

    // Clear all
    root.querySelector<HTMLButtonElement>(".batch-import-clear-btn")?.click();
    await flush();

    expect(root.querySelector(".batch-import-queue")).toBeNull();
  });

  it("shows supported file types hint in drop zone", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const hint = root.querySelector(".batch-import-dropzone-hint");
    expect(hint?.textContent).toContain(".txt");
    expect(hint?.textContent).toContain(".md");
    expect(hint?.textContent).toContain(".json");
  });

  // ── File upload & preview ────────────────────────────────────────

  // ── File upload & preview (via BatchItemRow direct rendering) ───

  describe("file upload and preview", () => {
    function makeFileItem(overrides: Partial<BatchItem> = {}): BatchItem {
      return {
        id: "file-1",
        content: "line one\nline two\nline three",
        format: "markdown",
        source: "test.md",
        ...overrides,
      };
    }

    function renderRow(item: BatchItem) {
      return renderToDiv(h(BatchItemRow, {
        item,
        onUpdate: vi.fn(),
        onRemove: vi.fn(),
      }));
    }

    it("shows file metadata (size, lines, words) for uploaded files", () => {
      const root = renderRow(makeFileItem());

      const meta = root.querySelector(".batch-import-item-meta");
      expect(meta).toBeTruthy();
      expect(meta?.textContent).toContain("3 lines");
      expect(meta?.textContent).toContain("word");
    });

    it("shows expand toggle button for file items", () => {
      const root = renderRow(makeFileItem());

      const expandBtn = root.querySelector(".batch-import-expand-btn");
      expect(expandBtn).toBeTruthy();
      expect(expandBtn?.getAttribute("aria-expanded")).toBe("false");
      expect(expandBtn?.getAttribute("aria-label")).toBe("Expand preview");
    });

    it("does not show expand toggle for text entries", () => {
      const root = renderRow(makeFileItem({ source: "Text entry" }));

      expect(root.querySelector(".batch-import-expand-btn")).toBeNull();
    });

    it("expands file preview when toggle is clicked", async () => {
      const content = "line 1\nline 2\nline 3\nline 4\nline 5";
      const root = renderRow(makeFileItem({ content, source: "readme.md" }));

      // Initially collapsed
      let preview = root.querySelector(".batch-import-item-preview");
      expect(preview?.classList.contains("batch-import-item-preview-expanded")).toBe(false);

      // Click expand
      root.querySelector<HTMLButtonElement>(".batch-import-expand-btn")?.click();
      await flush();

      // Now expanded
      preview = root.querySelector(".batch-import-item-preview");
      expect(preview?.classList.contains("batch-import-item-preview-expanded")).toBe(true);
      expect(root.querySelector(".batch-import-expand-btn")?.getAttribute("aria-expanded")).toBe("true");
    });

    it("collapses preview on second toggle click", async () => {
      const root = renderRow(makeFileItem());

      const expandBtn = root.querySelector<HTMLButtonElement>(".batch-import-expand-btn")!;

      // Expand
      expandBtn.click();
      await flush();
      expect(root.querySelector(".batch-import-item-preview-expanded")).toBeTruthy();

      // Collapse
      expandBtn.click();
      await flush();
      expect(root.querySelector(".batch-import-item-preview-expanded")).toBeNull();
    });

    it("shows MARKDOWN format badge for .md files", () => {
      const root = renderRow(makeFileItem({ format: "markdown", source: "spec.md" }));

      const badge = root.querySelector(".batch-import-format-badge");
      expect(badge?.textContent).toBe("MARKDOWN");
      expect(badge?.classList.contains("batch-import-format-markdown")).toBe(true);
    });

    it("shows TEXT format badge for .txt files", () => {
      const root = renderRow(makeFileItem({ format: "text", source: "notes.txt" }));

      const badge = root.querySelector(".batch-import-format-badge");
      expect(badge?.textContent).toBe("TEXT");
    });

    it("shows human-readable file size", () => {
      // ~27 bytes of content
      const root = renderRow(makeFileItem());

      const meta = root.querySelector(".batch-import-item-meta");
      expect(meta?.textContent).toContain("B"); // e.g. "27 B"
    });

    it("shows word count in metadata", () => {
      const root = renderRow(makeFileItem({ content: "one two three four five" }));

      const meta = root.querySelector(".batch-import-item-meta");
      expect(meta?.textContent).toContain("5 words");
    });

    it("shows truncated content when collapsed", () => {
      const longContent = "x".repeat(500);
      const root = renderRow(makeFileItem({ content: longContent }));

      const preview = root.querySelector(".batch-import-item-preview");
      // Collapsed shows at most 300 chars + ellipsis
      expect(preview?.textContent?.length).toBeLessThanOrEqual(301); // 300 + ellipsis char
    });

    it("shows full content when expanded", async () => {
      const longContent = "x".repeat(500);
      const root = renderRow(makeFileItem({ content: longContent }));

      root.querySelector<HTMLButtonElement>(".batch-import-expand-btn")?.click();
      await flush();

      const preview = root.querySelector(".batch-import-item-preview");
      expect(preview?.textContent).toBe(longContent);
    });
  });

  // ── Progress indicator ────────────────────────────────────────────

  describe("processing progress indicator", () => {
    it("shows stage-based progress when processing", async () => {
      // Set up a fetch that we can control
      let resolveResponse!: (value: Response) => void;
      fetchSpy.mockReturnValue(new Promise<Response>((r) => { resolveResponse = r; }));

      const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

      // Add a text entry with content
      root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
      await flush();
      const textarea = root.querySelector<HTMLTextAreaElement>(".batch-import-item-textarea")!;
      const inputEvent = new Event("input", { bubbles: true });
      Object.defineProperty(inputEvent, "target", { value: { value: "Add user auth" } });
      textarea.dispatchEvent(inputEvent);
      await flush();

      // Click process
      root.querySelector<HTMLButtonElement>(".batch-import-process-btn")?.click();
      await flush();

      // Should show progress indicator
      const progress = root.querySelector(".batch-import-progress");
      expect(progress).toBeTruthy();

      // Should have progress bar with aria role
      const fill = root.querySelector(".batch-import-progress-fill");
      expect(fill).toBeTruthy();
      expect(fill?.getAttribute("role")).toBe("progressbar");

      // Should show processing stages
      const stages = root.querySelectorAll(".batch-import-stage");
      expect(stages.length).toBe(3);

      // Clean up
      resolveResponse(new Response(JSON.stringify({ proposals: [], confidence: 0 })));
      await flush();
    });

    it("shows three stage labels: Upload, Analyze, Generate", async () => {
      let resolveResponse!: (value: Response) => void;
      fetchSpy.mockReturnValue(new Promise<Response>((r) => { resolveResponse = r; }));

      const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

      // Add content and process
      root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
      await flush();
      const textarea = root.querySelector<HTMLTextAreaElement>(".batch-import-item-textarea")!;
      const inputEvent = new Event("input", { bubbles: true });
      Object.defineProperty(inputEvent, "target", { value: { value: "Some requirement" } });
      textarea.dispatchEvent(inputEvent);
      await flush();

      root.querySelector<HTMLButtonElement>(".batch-import-process-btn")?.click();
      await flush();

      const stages = root.querySelectorAll(".batch-import-stage");
      const stageTexts = Array.from(stages).map((s) => s.textContent?.trim() ?? "");
      expect(stageTexts.some((t) => t.includes("Upload"))).toBe(true);
      expect(stageTexts.some((t) => t.includes("Analyze"))).toBe(true);
      expect(stageTexts.some((t) => t.includes("Generate"))).toBe(true);

      resolveResponse(new Response(JSON.stringify({ proposals: [], confidence: 0 })));
      await flush();
    });
  });
});
