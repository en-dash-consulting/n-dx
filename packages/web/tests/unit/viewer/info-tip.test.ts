// @vitest-environment jsdom
/**
 * InfoTip — the ⓘ that shows a glossary definition on hover or focus — and
 * the places the preview demo carried one: the Zones figure, the cohesion
 * and coupling gauges, and the map's cross-zone boundaries.
 */
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { InfoTip } from "../../../src/viewer/components/info-tip.js";
import { MetricCard } from "../../../src/viewer/components/data-display/health-gauge.js";
import { getGlossaryDefinition } from "../../../src/viewer/components/glossary-terms.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let root: HTMLDivElement;

function mount(vnode: ReturnType<typeof h>): HTMLDivElement {
  root = document.createElement("div");
  document.body.appendChild(root);
  act(() => { render(vnode, root); });
  return root;
}

afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
});

describe("InfoTip", () => {
  it("is a named button described by a tooltip holding the glossary definition", () => {
    mount(h(InfoTip, { term: "cohesion" }));
    const button = root.querySelector<HTMLButtonElement>("button.info-tip-btn")!;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("About cohesion");
    const bubble = root.querySelector(".info-tip-bubble")!;
    expect(bubble.getAttribute("role")).toBe("tooltip");
    expect(button.getAttribute("aria-describedby")).toBe(bubble.id);
    expect(bubble.textContent).toBe(getGlossaryDefinition("cohesion"));
  });

  it("points at an existing description and hides its own copy when given one", () => {
    mount(h(InfoTip, { term: "archetype", describedBy: "elsewhere" }));
    expect(root.querySelector("button")!.getAttribute("aria-describedby")).toBe("elsewhere");
    const bubble = root.querySelector(".info-tip-bubble")!;
    expect(bubble.getAttribute("aria-hidden")).toBe("true");
    expect(bubble.hasAttribute("role")).toBe(false);
  });

  it("uses the label for the button name when given", () => {
    mount(h(InfoTip, { term: "zone", label: "zones" }));
    expect(root.querySelector("button")!.getAttribute("aria-label")).toBe("About zones");
  });

  it("renders nothing for a term the glossary does not define", () => {
    mount(h(InfoTip, { term: "not-a-real-term" }));
    expect(root.querySelector(".info-tip")).toBeNull();
  });

  it("does not pass its click to the host (a sortable header, a card)", () => {
    let hostClicks = 0;
    mount(h("div", { onClick: () => { hostClicks += 1; } }, h(InfoTip, { term: "coupling" })));
    act(() => { root.querySelector<HTMLButtonElement>("button")!.click(); });
    expect(hostClicks).toBe(0);
  });
});

describe("MetricCard info slot", () => {
  it("keeps the ⓘ reachable: outside the aria-hidden label text", () => {
    mount(h(MetricCard, { value: 30, label: "Zones", info: h(InfoTip, { term: "zone" }) }));
    const label = root.querySelector(".metric-label")!;
    expect(label.getAttribute("aria-hidden")).toBeNull();
    expect(label.querySelector('[aria-hidden="true"]')!.textContent).toBe("Zones");
    expect(label.querySelector("button.info-tip-btn")).not.toBeNull();
  });

  it("is unchanged without one", () => {
    mount(h(MetricCard, { value: 30, label: "Files" }));
    expect(root.querySelector(".metric-label")!.getAttribute("aria-hidden")).toBe("true");
  });
});

/**
 * The demo carried four ⓘ tips. Each is wired in the real view that shows the
 * same figure — a textual check, like the glossary coverage scan, so a view
 * refactor that drops one fails here rather than silently.
 */
describe("the preview demo's ⓘ tips exist in the dashboard", () => {
  const VIEWS = join(import.meta.dirname!, "..", "..", "..", "src", "viewer", "views");
  const src = (file: string) => readFileSync(join(VIEWS, file), "utf-8");

  it.each([
    ["overview.ts", "zone", "the Zones figure"],
    ["overview.ts", "cohesion", "the Avg Cohesion gauge"],
    ["overview.ts", "coupling", "the Avg Coupling gauge"],
    ["graph.ts", "cross-zone import", "the map's busiest boundaries"],
    ["files.ts", "archetype", "the Files Archetype column"],
  ])("%s has an InfoTip for %s (%s)", (file, term) => {
    expect(src(file)).toMatch(new RegExp(`InfoTip,\\s*\\{\\s*term:\\s*"${term}"`));
  });
});
