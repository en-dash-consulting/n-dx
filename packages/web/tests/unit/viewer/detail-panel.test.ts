// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { DetailPanel } from "../../../src/viewer/components/detail-panel.js";

describe("DetailPanel", () => {
  function renderToDiv(vnode: ReturnType<typeof h>) {
    const root = document.createElement("div");
    render(vnode, root);
    return root;
  }

  it("returns null when detail is null", () => {
    const root = renderToDiv(h(DetailPanel, { detail: null, onClose: () => {} }));
    expect(root.innerHTML).toBe("");
  });

  it("renders title from detail object", () => {
    const detail = { type: "file" as const, title: "my-file.ts", path: "src/my-file.ts" };
    const root = renderToDiv(h(DetailPanel, { detail, onClose: () => {} }));
    expect(root.textContent).toContain("my-file.ts");
  });

  it("renders generic key-value entries for unknown detail types", () => {
    const detail = { type: "generic" as const, title: "Custom", customField: "hello", count: 42 };
    const root = renderToDiv(h(DetailPanel, { detail, onClose: () => {} }));
    expect(root.textContent).toContain("Custom Field");
    expect(root.textContent).toContain("hello");
    expect(root.textContent).toContain("42");
  });

  it("renders file detail with path in code block", () => {
    const detail = {
      type: "file" as const,
      title: "index.ts",
      path: "src/index.ts",
      language: "TypeScript",
      size: "2.4 KB",
      lines: 150,
      role: "source",
    };
    const root = renderToDiv(h(DetailPanel, { detail, onClose: () => {} }));
    expect(root.textContent).toContain("src/index.ts");
    expect(root.textContent).toContain("TypeScript");
    expect(root.textContent).toContain("source");
  });

  it("renders zone detail with description and metrics", () => {
    const detail = {
      type: "zone" as const,
      title: "Core Logic",
      zoneId: "zone-1",
      id: "zone-1",
      description: "Core business logic",
      files: 15,
      entryPoints: [],
      cohesion: "0.85",
      coupling: "0.20",
    };
    const root = renderToDiv(h(DetailPanel, { detail, onClose: () => {} }));
    expect(root.textContent).toContain("Core Logic");
    expect(root.textContent).toContain("Core business logic");
    expect(root.textContent).toContain("0.85");
    expect(root.textContent).toContain("0.20");
  });

  it("renders close button", () => {
    const detail = { type: "generic" as const, title: "Test" };
    const root = renderToDiv(h(DetailPanel, { detail, onClose: () => {} }));
    const closeBtn = root.querySelector("[aria-label='Close detail panel']");
    expect(closeBtn).not.toBeNull();
  });

  it("renders 'View in Graph' button for file details when navigateTo provided", () => {
    const detail = { type: "file" as const, title: "file.ts", path: "src/file.ts" };
    const root = renderToDiv(
      h(DetailPanel, { detail, navigateTo: () => {}, onClose: () => {} })
    );
    expect(root.textContent).toContain("View in Graph");
  });

  it("renders 'View in Files' button for zone details when navigateTo provided", () => {
    const detail = { type: "zone" as const, title: "Zone", zoneId: "z1", id: "z1", description: "test", files: 0, entryPoints: [], cohesion: "0", coupling: "0" };
    const root = renderToDiv(
      h(DetailPanel, { detail, navigateTo: () => {}, onClose: () => {} })
    );
    expect(root.textContent).toContain("View in Files");
  });

  it("handles arrays in generic detail", () => {
    const detail = { type: "generic" as const, title: "Test", items: ["a", "b", "c"] };
    const root = renderToDiv(h(DetailPanel, { detail, onClose: () => {} }));
    expect(root.textContent).toContain("a, b, c");
  });

  it("truncates long arrays in generic detail", () => {
    const detail = { type: "generic" as const, title: "Test", items: ["a", "b", "c", "d", "e", "f", "g"] };
    const root = renderToDiv(h(DetailPanel, { detail, onClose: () => {} }));
    expect(root.textContent).toContain("7 total");
  });
});
