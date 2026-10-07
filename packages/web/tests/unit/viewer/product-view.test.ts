// @vitest-environment jsdom
/**
 * Product page renders a v2 fixture: areas, capability rows with computed
 * status and health, open changes as overlays, and the revised/defective rows
 * marked.
 *
 * @see src/viewer/views/product.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import { h } from "preact";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { ProductView } from "../../../src/viewer/views/product.js";
import {
  needsAttention,
  productTotals,
  sortCapabilities,
  type CapabilityRow,
} from "../../../src/viewer/views/product-model.js";
import {
  PRODUCT_MAP_FIXTURE,
  EMPTY_PRODUCT_MAP_FIXTURE,
} from "../../fixtures/v2-product-map.js";

let root: HTMLDivElement | null = null;

function mount(vnode: ReturnType<typeof h>): HTMLDivElement {
  root = renderToDiv(vnode);
  return root;
}

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = null;
});

function rowFor(el: HTMLElement, id: string): HTMLElement {
  const row = el.querySelector(`[data-capability-id="${id}"]`);
  if (!row) throw new Error(`no capability row for ${id}`);
  return row as HTMLElement;
}

describe("ProductView", () => {
  it("renders every area with its capabilities", () => {
    const el = mount(h(ProductView, { map: PRODUCT_MAP_FIXTURE }));

    const areas = el.querySelectorAll(".pm-area");
    expect(areas).toHaveLength(PRODUCT_MAP_FIXTURE.areas.length);
    expect(el.textContent).toContain("Define the product");
    expect(el.textContent).toContain("Execute the work");

    const expectedRows = PRODUCT_MAP_FIXTURE.areas
      .reduce((n, area) => n + area.capabilities.length, 0);
    expect(el.querySelectorAll("[data-capability-id]")).toHaveLength(expectedRows);
  });

  it("shows each capability's computed status and health", () => {
    const el = mount(h(ProductView, { map: PRODUCT_MAP_FIXTURE }));

    const met = rowFor(el, "cap-natural-language-authoring");
    expect(met.querySelector(".pm-status")?.getAttribute("data-status")).toBe("met");
    expect(met.querySelector(".pm-health")?.getAttribute("data-health")).toBe("ok");

    const revised = rowFor(el, "cap-autonomous-runs");
    expect(revised.querySelector(".pm-status")?.getAttribute("data-status")).toBe("revised");
    expect(revised.querySelector(".pm-health")?.getAttribute("data-health")).toBe("defective");
  });

  it("marks revised and defective rows, and leaves healthy met rows unmarked", () => {
    const el = mount(h(ProductView, { map: PRODUCT_MAP_FIXTURE }));

    // Revised spec.
    expect(rowFor(el, "cap-autonomous-runs").getAttribute("data-attention")).toBe("true");
    // Met, but the build is broken — still attention.
    expect(rowFor(el, "cap-token-accounting").getAttribute("data-attention")).toBe("true");
    // Met and healthy.
    expect(rowFor(el, "cap-natural-language-authoring").hasAttribute("data-attention")).toBe(false);

    const marked = el.querySelectorAll(".pm-row-attention");
    expect(marked.length).toBeGreaterThanOrEqual(2);
  });

  it("draws each open change as an overlay on its capability's row", () => {
    const el = mount(h(ProductView, { map: PRODUCT_MAP_FIXTURE }));

    const row = rowFor(el, "cap-autonomous-runs");
    const overlays = row.querySelectorAll(".pm-overlay");
    expect(overlays).toHaveLength(2);
    expect(overlays[0].textContent).toContain("CH-160");
    expect(overlays[0].textContent).toContain("A run field on PRD items");
    expect(overlays[0].getAttribute("data-stage")).toBe("ready");
    expect(overlays[0].querySelector(".pm-overlay-delta")?.textContent).toBe("modified");

    // A change that only touches the capability carries no delta.
    expect(overlays[1].getAttribute("data-stage")).toBe("in-progress");
    expect(overlays[1].querySelector(".pm-overlay-delta")).toBeNull();

    // A capability with no open change says so rather than rendering nothing.
    const settled = rowFor(el, "cap-natural-language-authoring");
    expect(settled.querySelectorAll(".pm-overlay")).toHaveLength(0);
    expect(settled.querySelector(".pm-overlay-none")).not.toBeNull();
  });

  it("renders constraints with health and what they bind", () => {
    const el = mount(h(ProductView, { map: PRODUCT_MAP_FIXTURE }));

    const section = el.querySelector(".pm-constraints");
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("Architecture integrity");
    expect(section?.textContent).toContain("all map nodes");

    const broken = el.querySelector('[data-constraint-id="constraint-cross-os"]');
    expect(broken?.querySelector(".pm-health")?.getAttribute("data-health")).toBe("defective");
    expect(broken?.className).toContain("pm-row-attention");
    expect(broken?.textContent).toContain("Autonomous task runs");
  });

  // Counted from the fixture by hand, not from productTotals: asserting the
  // view against the same function the view calls would pass for any value
  // that function returned, including a wrong one.
  it("summarises the map above the areas", () => {
    const el = mount(h(ProductView, { map: PRODUCT_MAP_FIXTURE }));

    const labels = [...el.querySelectorAll(".pm-totals .metric-card")]
      .map((card) => [
        card.querySelector(".metric-label")?.textContent,
        card.querySelector(".metric-value")?.textContent,
      ]);

    expect(labels).toEqual([
      ["Capabilities", "6"],
      ["Met", "2"],
      // Only "Autonomous task runs".
      ["Revised", "1"],
      // Two capabilities plus the Cross-OS parity constraint.
      ["Defective", "3"],
      // Six open-change listings across the map, but CH-161 appears on two
      // capabilities, so five distinct changes are open.
      ["Open changes", "5"],
    ]);
  });

  it("opens the capability page from a row when a handler is given", () => {
    const opened: string[] = [];
    const el = mount(h(ProductView, {
      map: PRODUCT_MAP_FIXTURE,
      onSelectCapability: (id: string) => opened.push(id),
    }));

    const link = rowFor(el, "cap-placement").querySelector("button.pm-capability-link");
    expect(link).not.toBeNull();
    expect((link as HTMLButtonElement).type).toBe("button");
    (link as HTMLButtonElement).click();
    expect(opened).toEqual(["cap-placement"]);
  });

  it("renders titles as plain text when no handler is given", () => {
    const el = mount(h(ProductView, { map: PRODUCT_MAP_FIXTURE }));
    expect(el.querySelectorAll("button.pm-capability-link")).toHaveLength(0);
    expect(el.textContent).toContain("Automatic placement");
  });

  it("shows an empty state for a map with no areas or constraints", () => {
    const el = mount(h(ProductView, { map: EMPTY_PRODUCT_MAP_FIXTURE }));
    expect(el.querySelector(".empty-state")?.textContent).toContain("No product map yet");
    expect(el.querySelectorAll("[data-capability-id]")).toHaveLength(0);
    expect(el.querySelector(".pm-totals")).toBeNull();
  });
});

describe("capability ordering", () => {
  const row = (over: Partial<CapabilityRow>): CapabilityRow => ({
    id: over.title ?? "x",
    title: "x",
    status: "met",
    health: "ok",
    criteriaCount: 0,
    openChanges: [],
    ...over,
  });

  it("puts rows needing attention first, then orders by status, then title", () => {
    const sorted = sortCapabilities([
      row({ id: "met-b", title: "B met" }),
      row({ id: "defective", title: "Z defective", health: "defective" }),
      row({ id: "proposed", title: "C proposed", status: "proposed" }),
      row({ id: "met-a", title: "A met" }),
    ]).map((r) => r.id);

    expect(sorted).toEqual(["defective", "proposed", "met-a", "met-b"]);
  });

  it("counts a change open against two capabilities once", () => {
    const shared = {
      id: "ch-1", title: "Shared change", stage: "ready" as const,
    };
    const totals = productTotals({
      areas: [{
        id: "a", title: "A", capabilities: [
          row({ id: "one", title: "One", openChanges: [shared] }),
          row({ id: "two", title: "Two", openChanges: [shared, { ...shared, id: "ch-2" }] }),
        ],
      }],
      constraints: [],
    });

    expect(totals.openChanges).toBe(2);
    expect(totals.capabilities).toBe(2);
  });

  it("counts defective constraints alongside defective capabilities", () => {
    const totals = productTotals({
      areas: [{ id: "a", title: "A", capabilities: [row({ health: "defective" })] }],
      constraints: [
        { id: "c1", title: "C1", health: "defective", appliesTo: "all" },
        { id: "c2", title: "C2", health: "ok", appliesTo: "all" },
      ],
    });

    expect(totals.defective).toBe(2);
    // The capability count stays a capability count.
    expect(totals.capabilities).toBe(1);
  });

  it("treats revised or defective as needing attention", () => {
    expect(needsAttention({ status: "revised", health: "ok" })).toBe(true);
    expect(needsAttention({ status: "met", health: "defective" })).toBe(true);
    expect(needsAttention({ status: "met", health: "ok" })).toBe(false);
    expect(needsAttention({ status: "proposed", health: "ok" })).toBe(false);
  });
});
