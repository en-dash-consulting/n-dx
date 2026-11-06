// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  AreaBlock,
  MAX_BLOCKS,
  ProductAreaMap,
  areaBlocks,
  blockName,
  blockStatus,
} from "../../../src/viewer/views/product-area-map.js";
import { areaPath } from "../../../src/viewer/views/area.js";
import { areaCapabilityOfTab, areaSlugOfTab, parsePathnameRoute, routeTab, viewPathname } from "../../../src/viewer/route-state.js";
import type { AreaSection, CapabilityRow, ProductMap } from "../../../src/viewer/views/product-model.js";
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

describe("areaBlocks", () => {
  it("draws one block per area: size is its capability count, open changes are the server's per-area count", () => {
    // The area's count wins over its capabilities' overlays: an addition under
    // the area, or an amendment of the area itself, appears in no overlay.
    const [block] = areaBlocks([area("a", [cap({ openChanges: [overlay("x")] }), cap()], ["x", "y", "z"])]);
    expect(block).toMatchObject({ slug: "a", size: 2, openChanges: 3, status: "met" });
  });

  it("folds the smallest areas past the cap into one block, keeping order", () => {
    const areas = Array.from({ length: MAX_BLOCKS + 3 }, (_, i) =>
      area(`a${i}`, Array.from({ length: i < 3 ? 1 : 2 }, () => cap())));
    // One change open in two folded areas counts once.
    areas[0]!.openChangeIds = ["x"];
    areas[1]!.openChangeIds = ["x", "y"];
    const blocks = areaBlocks(areas);
    expect(blocks).toHaveLength(MAX_BLOCKS);
    const folded = blocks.at(-1)!;
    expect(folded).toMatchObject({ label: "+4 smaller areas", slug: null, size: 5, openChanges: 2 });
    // a0-a2 (one capability each) and the last of the equal-sized rest fold.
    expect(blocks.slice(0, -1).map((b) => b.slug)).toEqual(areas.slice(3, MAX_BLOCKS + 2).map((a) => a.slug));
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
    const block = areaBlocks([area("a", [cap({ openChanges: [overlay("x")] })], ["x"])])[0]!;
    await act(async () => { render(h(AreaBlock, { block, onOpen }), root); });
    const button = root.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("A: 1 capability, met, 1 open change");
    expect(button.querySelector(".pam-open")?.textContent).toBe("1 open");
    button.click();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  describe("with an open-changes handler", () => {
    const mountBadge = async (openChangeIds: string[], onOpen = vi.fn(), onOpenChanges = vi.fn()) => {
      const block = areaBlocks([area("a", [cap()], openChangeIds)])[0]!;
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
    const block = areaBlocks([area("a", [cap()])])[0]!;
    await act(async () => { render(h(AreaBlock, { block, onOpen: () => {} }), root); });
    expect(root.querySelector(".pam-open")).toBeNull();
  });
});

describe("ProductAreaMap", () => {
  let root: HTMLElement;
  const onOpenArea = vi.fn();
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); onOpenArea.mockReset(); });
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); });

  const map: ProductMap = {
    areas: [area("a", [cap(), cap({ status: "changing" })]), area("b", [cap({ health: "defective" })])],
    constraints: [],
  };

  async function mount(body: unknown) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
    await act(async () => { render(h(ProductAreaMap, { onOpenArea }), root); });
    await act(async () => {});
  }

  it("draws a tinted block per area with a legend, and opens an area by slug", async () => {
    await mount({ layout: "v2", map });
    const blocks = [...root.querySelectorAll<HTMLButtonElement>(".pam-block")];
    expect(blocks.map((b) => b.dataset.status)).toEqual(["changing", "defective"]);
    // Area blocks keep the stylesheet's basis; only the spec map sizes it inline.
    expect(blocks.map((b) => b.style.flexBasis)).toEqual(["", ""]);
    expect(root.querySelector(".pam-legend")?.textContent).toContain("Defective");
    blocks[1]!.click();
    expect(onOpenArea).toHaveBeenCalledWith("b", "B");
  });

  it("passes the area id from a badge, and no id from the folded block's", async () => {
    const onOpenChanges = vi.fn();
    const areas = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => area(`a${i}`, [cap()], [`c${i}`]));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ layout: "v2", map: { areas, constraints: [] } }) })));
    await act(async () => { render(h(ProductAreaMap, { onOpenArea, onOpenChanges }), root); });
    await act(async () => {});
    root.querySelector<HTMLButtonElement>('[data-open-changes="id-a3"]')!.click();
    expect(onOpenChanges).toHaveBeenLastCalledWith("id-a3", "A3");
    root.querySelector<HTMLButtonElement>('[data-open-changes="folded"]')!.click();
    expect(onOpenChanges).toHaveBeenLastCalledWith(null, "+2 smaller areas");
    expect(onOpenArea).not.toHaveBeenCalled();
  });

  it("opens the folded block with no slug", async () => {
    const areas = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => area(`a${i}`, [cap()]));
    await mount({ layout: "v2", map: { areas, constraints: [] } });
    root.querySelector<HTMLButtonElement>('.pam-block[data-block="folded"]')!.click();
    expect(onOpenArea).toHaveBeenCalledWith(null, "+2 smaller areas");
  });

  it("says so when the project has no areas", async () => {
    await mount({ layout: "v2", map: { areas: [], constraints: [] } });
    expect(root.textContent).toContain("No areas yet");
  });
});
