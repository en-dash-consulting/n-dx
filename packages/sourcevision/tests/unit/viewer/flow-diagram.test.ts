// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { FlowDiagram } from "../../../src/viewer/components/data-display/mini-charts.js";

describe("FlowDiagram", () => {
  function renderToDiv(vnode: ReturnType<typeof h>) {
    const root = document.createElement("div");
    render(vnode, root);
    return root;
  }

  const nodes = [
    { id: "a", label: "Zone A", color: "#00E5B9" },
    { id: "b", label: "Zone B", color: "#6c41f0" },
    { id: "c", label: "Zone C", color: "#ff5926" },
  ];

  const edges = [
    { from: "a", to: "b", weight: 5 },
    { from: "b", to: "c", weight: 2 },
  ];

  it("renders nodes", () => {
    const root = renderToDiv(h(FlowDiagram, { nodes, edges }));
    expect(root.textContent).toContain("Zone A");
    expect(root.textContent).toContain("Zone B");
    expect(root.textContent).toContain("Zone C");
  });

  it("renders edges as paths", () => {
    const root = renderToDiv(h(FlowDiagram, { nodes, edges }));
    const paths = root.querySelectorAll("path");
    expect(paths.length).toBe(2);
  });

  it("renders node circles", () => {
    const root = renderToDiv(h(FlowDiagram, { nodes, edges }));
    const circles = root.querySelectorAll("circle");
    expect(circles.length).toBe(3);
  });

  it("returns null for empty nodes", () => {
    const root = renderToDiv(h(FlowDiagram, { nodes: [], edges: [] }));
    expect(root.innerHTML).toBe("");
  });

  it("applies node colors", () => {
    const root = renderToDiv(h(FlowDiagram, { nodes, edges }));
    const circles = root.querySelectorAll("circle");
    const fills = Array.from(circles).map((c) => c.getAttribute("fill"));
    expect(fills).toContain("#00E5B9");
    expect(fills).toContain("#6c41f0");
  });
});
