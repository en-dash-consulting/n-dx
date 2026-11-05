// @vitest-environment jsdom
/**
 * The area view: its header, its own page at `/product/area/<slug>`, and the
 * in-place opening from Plan's product map that names the area in the address
 * bar and gives Plan's address back on close.
 *
 * @see src/viewer/views/area.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AreaInPlace, AreaView, areaCountLabels, stewardLabel } from "../../../src/viewer/views/area.js";
import { renderActiveView } from "../../../src/viewer/views/view-registry.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { AREA_DETAIL_FIXTURE, PRODUCT_MAP_FIXTURE } from "../../fixtures/v2-product-map.js";

vi.mock("../../../src/viewer/hooks/use-gateway.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/viewer/hooks/use-gateway.js")>(),
  createWSPipeline: vi.fn(() => ({ push: vi.fn(), dispose: vi.fn() })),
}));

const AREA_URL = `/api/rex/product/area/${AREA_DETAIL_FIXTURE.slug}`;
let root: HTMLDivElement;

function stubRoutes(routes: Record<string, unknown>): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = routes[url];
    return { ok: body !== undefined, status: body !== undefined ? 200 : 404, json: async () => body ?? { error: "not found" } };
  }));
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
  await act(async () => {});
}

async function mount(vnode: ReturnType<typeof h>): Promise<void> {
  act(() => { render(vnode, root); });
  await settle();
}

beforeEach(() => {
  clearProjectMetadataCache();
  history.replaceState(null, "", "/plan");
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

describe("header text", () => {
  it("counts each thing the header names, singular at one", () => {
    expect(areaCountLabels({ capabilities: 1, constraints: 2, met: 0, changing: 1, defective: 3, openChanges: 1 }))
      .toEqual(["1 capability", "2 constraints", "0 met", "1 changing", "3 defective", "1 open change"]);
  });

  it("names the stewards, or says there is none", () => {
    expect(stewardLabel([])).toBe("no steward");
    expect(stewardLabel(["Sterling H"])).toBe("steward: Sterling H");
    expect(stewardLabel(["A", "B"])).toBe("stewards: A, B");
  });
});

describe("AreaView", () => {
  it("heads the area with its summary, counts and steward chip", async () => {
    stubRoutes({ [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE } });
    await mount(h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug }));
    const head = root.querySelector(".area-head")!;
    expect(head.querySelector(".area-summary")?.textContent).toBe(AREA_DETAIL_FIXTURE.summary);
    expect([...head.querySelectorAll(".area-counts li")].map((li) => li.textContent))
      .toEqual(["3 capabilities", "1 constraint", "1 met", "1 changing", "0 defective", "2 open changes"]);
    expect(head.querySelector(".area-steward")?.textContent).toBe("steward: Sterling H");
  });

  it("says 'no steward' when the area has none", async () => {
    stubRoutes({ [AREA_URL]: { layout: "v2", area: { ...AREA_DETAIL_FIXTURE, stewards: [] } } });
    await mount(h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug }));
    const chip = root.querySelector(".area-steward")!;
    expect(chip.textContent).toBe("no steward");
    expect(chip.classList.contains("area-steward-none")).toBe(true);
  });

  it("+ Change in this area opens a capture limited to the area; Esc closes it and nothing around it", async () => {
    stubRoutes({ [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE } });
    await mount(h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug }));
    const toggle = [...root.querySelectorAll<HTMLButtonElement>(".area-actions button")]
      .find((b) => b.textContent === "+ Change in this area")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    act(() => { toggle.click(); });
    const capture = root.querySelector(".area-capture")!;
    expect(capture.querySelector(".smart-add-title")?.textContent).toBe(`Change in ${AREA_DETAIL_FIXTURE.title}`);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const onDocumentEscape = vi.fn();
    document.addEventListener("keydown", onDocumentEscape);
    act(() => {
      capture.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    document.removeEventListener("keydown", onDocumentEscape);
    expect(root.querySelector(".area-capture")).toBeNull();
    // The full-screen tile closes on a document-level Escape; this one stopped at the capture.
    expect(onDocumentEscape).not.toHaveBeenCalled();
  });

  it("reports an area the server cannot find", async () => {
    stubRoutes({});
    await mount(h(AreaView, { slug: "gone" }));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("Could not load the area: not found");
  });
});

describe("AreaInPlace", () => {
  it("names the area in the address bar while open and gives the old address back on close", async () => {
    stubRoutes({ [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE } });
    history.replaceState({ view: "plan" }, "", "/plan?x=1");
    await mount(h(AreaInPlace, { slug: AREA_DETAIL_FIXTURE.slug, onOpenPage: vi.fn() }));
    expect(location.pathname).toBe(`/product/area/${AREA_DETAIL_FIXTURE.slug}`);
    // The entry is still Plan's, so Back and popstate read it as Plan.
    expect((history.state as { view: string }).view).toBe("plan");
    act(() => { render(null, root); });
    expect(`${location.pathname}${location.search}`).toBe("/plan?x=1");
    expect(history.state).toEqual({ view: "plan" });
  });

  it("leaves a navigation made while open alone", async () => {
    stubRoutes({ [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE } });
    const onOpenPage = vi.fn(() => history.pushState({ view: "product" }, "", `/product/area/${AREA_DETAIL_FIXTURE.slug}`));
    await mount(h(AreaInPlace, { slug: AREA_DETAIL_FIXTURE.slug, onOpenPage }));
    act(() => root.querySelector<HTMLButtonElement>(".area-open-page")!.click());
    expect(onOpenPage).toHaveBeenCalledOnce();
    act(() => { render(null, root); });
    expect(location.pathname).toBe(`/product/area/${AREA_DETAIL_FIXTURE.slug}`);
    expect(history.state).toEqual({ view: "product" });
  });
});

describe("from Plan's product map", () => {
  it("opens the area in the Product tile's full-screen, and Esc or the trail returns to Plan", async () => {
    stubRoutes({
      "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE },
      [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE },
    });
    const navigateTo = vi.fn();
    await mount(h("div", null, renderActiveView("plan", {
      navigateTo,
      validViews: buildValidViews(null),
      data: {},
      isFeatureDisabled: () => false,
    } as never)));
    const block = () => root.querySelector<HTMLButtonElement>(`[data-tile="product-map"] .pam-block[data-block="${AREA_DETAIL_FIXTURE.id}"]`)!;
    await vi.waitFor(() => expect(block()).not.toBeNull());

    act(() => block().click());
    await settle();
    const dialog = root.querySelector<HTMLElement>(".stage-tile-fullscreen [role=dialog]")!;
    expect(dialog.getAttribute("aria-label")).toBe(AREA_DETAIL_FIXTURE.title);
    expect([...dialog.querySelectorAll(".stage-tile-trail button, .stage-tile-trail h2")].map((el) => el.textContent))
      .toEqual(["← Plan", "Product", AREA_DETAIL_FIXTURE.title]);
    expect(dialog.querySelector(".area-head .area-steward")?.textContent).toBe("steward: Sterling H");
    expect(location.pathname).toBe(`/product/area/${AREA_DETAIL_FIXTURE.slug}`);
    expect(navigateTo).not.toHaveBeenCalled();

    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(root.querySelector(".stage-tile-fullscreen")).toBeNull();
    expect(location.pathname).toBe("/plan");

    act(() => block().click());
    await settle();
    act(() => root.querySelector<HTMLButtonElement>(".stage-tile-trail-back")!.click());
    expect(root.querySelector(".stage-tile-fullscreen")).toBeNull();
    expect(location.pathname).toBe("/plan");
  });

  it("'Open on Product page' goes to the area's own route", async () => {
    stubRoutes({
      "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE },
      [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE },
    });
    const navigateTo = vi.fn();
    await mount(h("div", null, renderActiveView("plan", {
      navigateTo, validViews: buildValidViews(null), data: {}, isFeatureDisabled: () => false,
    } as never)));
    await vi.waitFor(() => expect(root.querySelector(`.pam-block[data-block="${AREA_DETAIL_FIXTURE.id}"]`)).not.toBeNull());
    act(() => root.querySelector<HTMLButtonElement>(`.pam-block[data-block="${AREA_DETAIL_FIXTURE.id}"]`)!.click());
    await settle();
    act(() => root.querySelector<HTMLButtonElement>(".area-open-page")!.click());
    expect(navigateTo).toHaveBeenCalledWith("product", { tab: `area/${AREA_DETAIL_FIXTURE.slug}` });
  });
});
