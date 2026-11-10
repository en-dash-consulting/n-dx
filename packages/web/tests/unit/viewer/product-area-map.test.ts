// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  AreaBlock,
  BLOCK_STATUS_LABELS,
  BLOCK_STATUS_ORDER,
  areaBlock,
  blockName,
  blockStatus,
} from "../../../src/viewer/views/product-area-map.js";
import { areaPath } from "../../../src/viewer/views/area.js";
import { areaCapabilityOfTab, areaSlugOfTab, parsePathnameRoute, routeTab, viewPathname } from "../../../src/viewer/route-state.js";
import type { AreaSection, CapabilityRow } from "../../../src/viewer/views/product-model.js";
import type { ViewId } from "../../../src/viewer/types.js";

const overlay = (id: string) => ({ id, title: id, stage: "proposed" as const });
const cap = (over: Partial<CapabilityRow> = {}): CapabilityRow => ({
  id: "c", title: "C", status: "met", health: "ok", criteriaCount: 1, openChanges: [], ...over,
});
const area = (slug: string, capabilities: CapabilityRow[], openChangeIds: string[] = []): AreaSection => ({
  id: `id-${slug}`, slug, title: slug.toUpperCase(), capabilities, openChangeIds,
});

describe("blockStatus", () => {
  it("is defective when any capability is, whatever its status", () => {
    expect(blockStatus([cap(), cap({ health: "defective" })])).toBe("defective");
  });
  it("reads changing or revised as changing, then proposed, then met", () => {
    expect(blockStatus([cap(), cap({ status: "revised" })])).toBe("changing");
    expect(blockStatus([cap({ status: "changing" }), cap({ status: "proposed" })])).toBe("changing");
    expect(blockStatus([cap(), cap({ status: "proposed" })])).toBe("proposed");
    expect(blockStatus([cap(), cap()])).toBe("met");
  });
  it("ignores retired capabilities, and an area with none left is proposed", () => {
    expect(blockStatus([cap(), cap({ status: "retired" })])).toBe("met");
    expect(blockStatus([cap({ status: "retired" })])).toBe("proposed");
    expect(blockStatus([])).toBe("proposed");
  });
});

describe("areaBlock", () => {
  it("sizes a block by its capability count; open changes are the server's per-area count", () => {
    // The area's count wins over its capabilities' overlays: an addition under
    // the area, or an amendment of the area itself, appears in no overlay.
    const block = areaBlock(area("a", [cap({ openChanges: [overlay("x")] }), cap()], ["x", "y", "z"]));
    expect(block).toMatchObject({ slug: "a", size: 2, openChanges: 3, status: "met" });
  });
});

describe("blockName", () => {
  it("names the area, its counts and its status", () => {
    expect(blockName({ label: "Plan", size: 3, unit: "capabilities", status: "defective", openChanges: 2 }))
      .toBe("Plan: 3 capabilities, defective, 2 open changes");
    expect(blockName({ label: "Plan", size: 1, unit: "capabilities", status: "met", openChanges: 0 }))
      .toBe("Plan: 1 capability, met, no open changes");
  });
});

describe("area routes", () => {
  const valid = new Set<ViewId>(["product", "plan"]);
  it("reads /product/area/<slug> as the Product page at that area and writes it back", () => {
    const route = parsePathnameRoute("/product/area/define-the-product", valid);
    expect(route).toEqual({ view: "product", subId: "area/define-the-product" });
    expect(routeTab("product", route!.subId)).toBe("area/define-the-product");
    expect(areaSlugOfTab("area/define-the-product")).toBe("define-the-product");
    expect(viewPathname("product", "area/define-the-product")).toBe("/product/area/define-the-product");
  });
  it("reads /product/area/<slug>/capability/<id> as that area with the capability selected", () => {
    const route = parsePathnameRoute("/product/area/define-the-product/capability/cap-placement", valid);
    expect(route).toEqual({ view: "product", subId: "area/define-the-product/capability/cap-placement" });
    expect(routeTab("product", route!.subId)).toBe("area/define-the-product/capability/cap-placement");
    expect(areaSlugOfTab(route!.subId)).toBe("define-the-product");
    expect(areaCapabilityOfTab(route!.subId)).toBe("cap-placement");
    expect(areaCapabilityOfTab("area/define-the-product")).toBeNull();
  });
  it("reads a malformed capability id as no selection", () => {
    expect(areaCapabilityOfTab("area/define-the-product/capability/%E0")).toBeNull();
    expect(areaCapabilityOfTab("area/define-the-product/capability/cap%20x")).toBe("cap x");
  });
  it("round-trips a non-ASCII or reserved-character area slug", () => {
    for (const slug of ["café", "my area", "a#b?c"]) {
      const path = areaPath(slug);
      expect(path).toBe(`/product/area/${encodeURIComponent(slug)}`);
      const route = parsePathnameRoute(path, valid);
      expect(route).toEqual({ view: "product", subId: `area/${encodeURIComponent(slug)}` });
      expect(areaSlugOfTab(routeTab("product", route!.subId))).toBe(slug);
      expect(areaSlugOfTab(`area/${encodeURIComponent(slug)}/capability/cap-x`)).toBe(slug);
    }
  });
  it("reads a malformed area slug as no area", () => {
    expect(areaSlugOfTab("area/%E0")).toBeNull();
  });
  it("leaves other product sub-paths alone", () => {
    expect(parsePathnameRoute("/product/other", valid)).toBeNull();
    expect(routeTab("product", "other")).toBeNull();
    expect(areaSlugOfTab(null)).toBeNull();
  });
});

describe("AreaBlock", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); });

  it("is a button with an accessible name that opens on click", async () => {
    const onOpen = vi.fn();
    const block = areaBlock(area("a", [cap({ openChanges: [overlay("x")] })], ["x"]));
    await act(async () => { render(h(AreaBlock, { block, onOpen }), root); });
    const button = root.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("A: 1 capability, met, 1 open change");
    expect(button.querySelector(".pam-open")?.textContent).toBe("1 open");
    button.click();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  describe("with an open-changes handler", () => {
    const mountBadge = async (openChangeIds: string[], onOpen = vi.fn(), onOpenChanges = vi.fn()) => {
      const block = areaBlock(area("a", [cap()], openChangeIds));
      await act(async () => { render(h(AreaBlock, { block, onOpen, onOpenChanges }), root); });
      return { onOpen, onOpenChanges };
    };

    it("shows 'N open' as text on its own labelled button, apart from the block button", async () => {
      await mountBadge(["x", "y"]);
      const badge = root.querySelector<HTMLButtonElement>("button.pam-open")!;
      expect(badge.textContent).toBe("2 open");
      expect(badge.getAttribute("aria-label")).toBe("2 open changes in A: open the list");
      const block = root.querySelector<HTMLButtonElement>("button.pam-block")!;
      expect(block.contains(badge)).toBe(false);
      expect(block.querySelector("button")).toBeNull();
    });

    it("opens the changes from the badge and the area from the block, each alone", async () => {
      const { onOpen, onOpenChanges } = await mountBadge(["x"]);
      root.querySelector<HTMLButtonElement>("button.pam-open")!.click();
      expect(onOpenChanges).toHaveBeenCalledOnce();
      expect(onOpen).not.toHaveBeenCalled();
      root.querySelector<HTMLButtonElement>("button.pam-block")!.click();
      expect(onOpen).toHaveBeenCalledOnce();
      expect(onOpenChanges).toHaveBeenCalledOnce();
    });

    it("draws no badge button when nothing is open", async () => {
      await mountBadge([]);
      expect(root.querySelector(".pam-open")).toBeNull();
      expect(root.querySelector(".pam-cell")).toBeNull();
    });
  });

  it("omits the marker when no change is open", async () => {
    const block = areaBlock(area("a", [cap()]));
    await act(async () => { render(h(AreaBlock, { block, onOpen: () => {} }), root); });
    expect(root.querySelector(".pam-open")).toBeNull();
  });
});
