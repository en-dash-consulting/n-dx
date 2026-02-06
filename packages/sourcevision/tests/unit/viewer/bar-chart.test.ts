// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { BarChart } from "../../../src/viewer/components/data-display/mini-charts.js";

describe("BarChart", () => {
  function renderToDiv(vnode: ReturnType<typeof h>) {
    const root = document.createElement("div");
    render(vnode, root);
    return root;
  }

  it("renders correct number of bars", () => {
    const data = [
      { label: "TypeScript", value: 42 },
      { label: "JavaScript", value: 18 },
      { label: "CSS", value: 5 },
    ];
    const root = renderToDiv(h(BarChart, { data }));
    const groups = root.querySelectorAll("g");
    expect(groups.length).toBe(3);
  });

  it("returns null for empty data", () => {
    const root = renderToDiv(h(BarChart, { data: [] }));
    expect(root.innerHTML).toBe("");
  });

  it("renders bar labels", () => {
    const data = [{ label: "Python", value: 10 }];
    const root = renderToDiv(h(BarChart, { data }));
    expect(root.textContent).toContain("Python");
  });

  it("renders bar values", () => {
    const data = [{ label: "Go", value: 25 }];
    const root = renderToDiv(h(BarChart, { data }));
    expect(root.textContent).toContain("25");
  });

  it("applies custom colors", () => {
    const data = [{ label: "Rust", value: 7, color: "#ff0000" }];
    const root = renderToDiv(h(BarChart, { data }));
    const rect = root.querySelector("rect");
    expect(rect?.getAttribute("fill")).toBe("#ff0000");
  });
});
