// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { ActionIcon } from "../../../src/viewer/components/index.js";
import type { ActionIconName } from "../../../src/viewer/components/index.js";

describe("ActionIcon", () => {
  const names: ActionIconName[] = ["copy", "check", "close", "more", "expand"];

  it.each(names)("renders %s as a decorative currentColor SVG sized by the icon token class", (name) => {
    const root = document.createElement("div");
    render(h(ActionIcon, { name }), root);
    const svg = root.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("action-icon");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(root.textContent).toBe("");
  });

  it("adds an extra class for the small variant", () => {
    const root = document.createElement("div");
    render(h(ActionIcon, { name: "close", class: "action-icon-sm" }), root);
    expect(root.querySelector("svg")!.getAttribute("class")).toBe("action-icon action-icon-sm");
  });
});
