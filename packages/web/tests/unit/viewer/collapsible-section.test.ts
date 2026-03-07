// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { h, render } from "preact";
import { CollapsibleSection } from "../../../src/viewer/components/data-display/collapsible-section.js";

describe("CollapsibleSection", () => {
  function renderToDiv(vnode: ReturnType<typeof h>) {
    const root = document.createElement("div");
    render(vnode, root);
    return root;
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it("renders title", () => {
    const root = renderToDiv(
      h(CollapsibleSection, { title: "Test Section" },
        h("div", null, "Content")
      )
    );
    expect(root.textContent).toContain("Test Section");
  });

  it("renders count badge", () => {
    const root = renderToDiv(
      h(CollapsibleSection, { title: "Items", count: 42 },
        h("div", null, "Item 1")
      )
    );
    expect(root.textContent).toContain("42");
  });

  it("renders children when defaultOpen is true", () => {
    const root = renderToDiv(
      h(CollapsibleSection, { title: "Open Section", defaultOpen: true },
        h("div", null, "visible content")
      )
    );
    expect(root.textContent).toContain("visible content");
  });

  it("hides children when defaultOpen is false", () => {
    const root = renderToDiv(
      h(CollapsibleSection, { title: "Closed Section", defaultOpen: false },
        h("div", null, "hidden content")
      )
    );
    expect(root.textContent).not.toContain("hidden content");
  });

  it("shows 'Show more' when items exceed threshold", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      h("div", { key: i }, `Item ${i}`)
    );
    const root = renderToDiv(
      h(CollapsibleSection, { title: "Many Items", threshold: 5, defaultOpen: true },
        ...items
      )
    );
    expect(root.textContent).toContain("Show");
    expect(root.textContent).toContain("more");
  });

  it("renders all items when under threshold", () => {
    const items = [
      h("div", { key: "a" }, "Alpha"),
      h("div", { key: "b" }, "Beta"),
    ];
    const root = renderToDiv(
      h(CollapsibleSection, { title: "Few Items", threshold: 5, defaultOpen: true },
        ...items
      )
    );
    expect(root.textContent).toContain("Alpha");
    expect(root.textContent).toContain("Beta");
    expect(root.textContent).not.toContain("Show");
  });

  it("has accessible toggle with aria-expanded", () => {
    const root = renderToDiv(
      h(CollapsibleSection, { title: "A11y Test", defaultOpen: true },
        h("div", null, "content")
      )
    );
    const toggle = root.querySelector("[aria-expanded]");
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  describe("storageKey persistence", () => {
    it("reads persisted open state from localStorage", () => {
      localStorage.setItem("collapsible-section:test-key", "true");
      const root = renderToDiv(
        h(CollapsibleSection, { title: "Persisted", defaultOpen: false, storageKey: "test-key" },
          h("div", null, "persisted content")
        )
      );
      // Should be open despite defaultOpen=false because persisted state is true
      expect(root.textContent).toContain("persisted content");
    });

    it("reads persisted closed state from localStorage", () => {
      localStorage.setItem("collapsible-section:closed-key", "false");
      const root = renderToDiv(
        h(CollapsibleSection, { title: "Closed", defaultOpen: true, storageKey: "closed-key" },
          h("div", null, "should be hidden")
        )
      );
      // Should be closed despite defaultOpen=true because persisted state is false
      expect(root.textContent).not.toContain("should be hidden");
    });

    it("falls back to defaultOpen when no persisted state exists", () => {
      const root = renderToDiv(
        h(CollapsibleSection, { title: "Fallback", defaultOpen: true, storageKey: "new-key" },
          h("div", null, "fallback content")
        )
      );
      expect(root.textContent).toContain("fallback content");
    });

    it("persists state to localStorage when toggled", () => {
      const root = renderToDiv(
        h(CollapsibleSection, { title: "Toggle", defaultOpen: true, storageKey: "toggle-key" },
          h("div", null, "content")
        )
      );
      // Click the header to collapse
      const header = root.querySelector(".collapsible-header") as HTMLElement;
      header.click();
      expect(localStorage.getItem("collapsible-section:toggle-key")).toBe("false");
    });

    it("does not persist state when no storageKey is set", () => {
      const root = renderToDiv(
        h(CollapsibleSection, { title: "No Key", defaultOpen: true },
          h("div", null, "content")
        )
      );
      const header = root.querySelector(".collapsible-header") as HTMLElement;
      header.click();
      // No localStorage entries with the collapsible prefix
      const keys = Object.keys(localStorage).filter(k => k.startsWith("collapsible-section:"));
      expect(keys).toHaveLength(0);
    });
  });
});
