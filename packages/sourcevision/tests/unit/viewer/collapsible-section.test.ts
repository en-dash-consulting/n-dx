// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { CollapsibleSection } from "../../../src/viewer/components/data-display/collapsible-section.js";

describe("CollapsibleSection", () => {
  function renderToDiv(vnode: ReturnType<typeof h>) {
    const root = document.createElement("div");
    render(vnode, root);
    return root;
  }

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
});
