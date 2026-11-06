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
import { AreaInPlace, AreaView, areaCapabilityPath, areaCountLabels, areaPath, stewardLabel } from "../../../src/viewer/views/area.js";
import { PlanWithSidecarContext, type PlanWithSidecar } from "../../../src/viewer/components/plan-with-sidecar.js";
import { renderActiveView } from "../../../src/viewer/views/view-registry.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";
import { AREA_DETAIL_FIXTURE, CAPABILITY_DETAIL_FIXTURE, PRODUCT_MAP_FIXTURE } from "../../fixtures/v2-product-map.js";

vi.mock("../../../src/viewer/hooks/use-gateway.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/viewer/hooks/use-gateway.js")>(),
  createWSPipeline: vi.fn(() => ({ push: vi.fn(), dispose: vi.fn() })),
}));

const AREA_URL = `/api/rex/product/area/${AREA_DETAIL_FIXTURE.slug}`;

/** A valid v2 status: Plan mounts its v2-only tiles (the Product map) only once a layout is known. */
const V2_STATUS = {
  initialized: true,
  sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 0, modulesComplete: 0, modulesTotal: 0 },
  rex: { exists: true, layout: "v2", percentComplete: 0, stats: null, hasInProgress: false, hasPending: false, nextTaskTitle: null },
  hench: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
};
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

  it("Place on the Inbox card opens placement mode for that change", async () => {
    const inbox = [{
      id: "change-loose", title: "Loose idea", relation: "touches" as const, strength: "possible" as const,
      target: { id: AREA_DETAIL_FIXTURE.capabilities[0]!.id, title: AREA_DETAIL_FIXTURE.capabilities[0]!.title, type: "capability" as const },
    }];
    stubRoutes({ [AREA_URL]: { layout: "v2", area: { ...AREA_DETAIL_FIXTURE, inbox } } });
    const navigateTo = vi.fn();
    await mount(h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug, navigateTo }));
    act(() => root.querySelector<HTMLButtonElement>('[data-card="inbox"] .inbox-place')!.click());
    expect(navigateTo).toHaveBeenCalledWith("product", { tab: "place/change-loose" });
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
      "/api/status": V2_STATUS,
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
      "/api/status": V2_STATUS,
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

  it("'Open on Product page' encodes a hand-authored slug in the tab", async () => {
    const slug = "café #1";
    const map = {
      ...PRODUCT_MAP_FIXTURE,
      areas: PRODUCT_MAP_FIXTURE.areas.map((a) => (a.id === AREA_DETAIL_FIXTURE.id ? { ...a, slug } : a)),
    };
    stubRoutes({
      "/api/rex/product": { layout: "v2", map },
      [`/api/rex/product/area/${encodeURIComponent(slug)}`]: { layout: "v2", area: { ...AREA_DETAIL_FIXTURE, slug } },
      "/api/status": V2_STATUS,
    });
    const navigateTo = vi.fn();
    await mount(h("div", null, renderActiveView("plan", {
      navigateTo, validViews: buildValidViews(null), data: {}, isFeatureDisabled: () => false,
    } as never)));
    await vi.waitFor(() => expect(root.querySelector(`.pam-block[data-block="${AREA_DETAIL_FIXTURE.id}"]`)).not.toBeNull());
    act(() => root.querySelector<HTMLButtonElement>(`.pam-block[data-block="${AREA_DETAIL_FIXTURE.id}"]`)!.click());
    await settle();
    act(() => root.querySelector<HTMLButtonElement>(".area-open-page")!.click());
    expect(navigateTo).toHaveBeenCalledWith("product", { tab: `area/${encodeURIComponent(slug)}` });
  });
});

describe("a selected capability", () => {
  const CAP_ID = AREA_DETAIL_FIXTURE.capabilities[0]!.id;
  const CAP_URL = `/api/rex/product/capability/${CAP_ID}`;
  const DETAIL = { ...CAPABILITY_DETAIL_FIXTURE, id: CAP_ID, title: AREA_DETAIL_FIXTURE.capabilities[0]!.title };
  const block = () => root.querySelector<HTMLButtonElement>(`.pam-block[data-block="${CAP_ID}"]`)!;

  async function open(extra: Partial<Parameters<typeof AreaView>[0]> = {}): Promise<void> {
    stubRoutes({
      [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE },
      [CAP_URL]: { layout: "v2", capability: DETAIL },
    });
    history.replaceState(null, "", areaPath(AREA_DETAIL_FIXTURE.slug));
    await mount(h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug, ...extra }));
  }

  const pressEscape = (el: Element) =>
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

  it("swaps the column for the capability's statement, criteria and history", async () => {
    await open();
    expect(root.querySelector(".area-cards:not(.area-capability)")).not.toBeNull();
    act(() => block().click());
    await settle();
    const column = root.querySelector(".area-capability")!;
    expect(root.querySelector(".area-cards:not(.area-capability)")).toBeNull();
    expect(column.querySelector(".cap-statement-text")?.textContent).toBe(DETAIL.statement);
    expect(column.querySelectorAll(".cap-criterion")).toHaveLength(DETAIL.criteria.length);
    expect(column.querySelectorAll(".cap-history-table tbody tr")).toHaveLength(DETAIL.history.length);
    expect(location.pathname).toBe(areaCapabilityPath(AREA_DETAIL_FIXTURE.slug, CAP_ID));
  });

  it("shows a pending amendment as a before/after of the statement and the criteria", async () => {
    await open();
    act(() => block().click());
    await settle();
    const amendment = root.querySelector(".cap-amendment")!;
    expect(amendment.querySelector(".cap-diff-statement .cap-diff-before p")?.textContent).toBe(DETAIL.statement);
    expect(amendment.querySelector(".cap-diff-statement .cap-diff-after p")?.textContent)
      .toBe(DETAIL.pendingAmendments[0]!.proposed);
    const rows = [...amendment.querySelectorAll(".cap-diff-row")].map((row) => ({
      id: row.getAttribute("data-criterion-id"),
      kind: row.classList[1],
      before: row.querySelector("del")?.textContent,
      after: row.querySelector("ins")?.textContent,
    }));
    // c4 is inherited: another node's criterion never shows as removed here.
    expect(rows).toEqual([
      { id: "c3", kind: "cap-diff-replaced", before: "The run is recorded with its token spend.", after: "The run is recorded with its token spend and the settings it used." },
      { id: "c5", kind: "cap-diff-added", before: undefined, after: "A saved run block overrides the project defaults." },
      { id: "c2", kind: "cap-diff-removed", before: "A failing validation run ends the task rather than committing.", after: undefined },
    ]);
  });

  it("behind the hub, selecting and leaving a capability keeps the /p/<id> prefix", async () => {
    setBasePathForTests("/p/x");
    try {
      await open();
      history.replaceState(null, "", `/p/x${areaPath(AREA_DETAIL_FIXTURE.slug)}`);
      act(() => block().click());
      await settle();
      expect(location.pathname).toBe(`/p/x${areaCapabilityPath(AREA_DETAIL_FIXTURE.slug, CAP_ID)}`);
      pressEscape(root.querySelector(".area-capability")!);
      expect(location.pathname).toBe(`/p/x${areaPath(AREA_DETAIL_FIXTURE.slug)}`);
    } finally {
      setBasePathForTests(null);
    }
  });

  it("Esc returns to the area with the column restored, and stops there", async () => {
    await open();
    act(() => block().click());
    await settle();
    const onDocumentEscape = vi.fn();
    document.addEventListener("keydown", onDocumentEscape);
    pressEscape(root.querySelector(".area-capability")!);
    document.removeEventListener("keydown", onDocumentEscape);
    expect(root.querySelector(".area-capability")).toBeNull();
    expect(root.querySelector(".area-cards")).not.toBeNull();
    expect(location.pathname).toBe(areaPath(AREA_DETAIL_FIXTURE.slug));
    expect(onDocumentEscape).not.toHaveBeenCalled();
  });

  it("closing the area on Plan with a capability selected gives Plan its address back", async () => {
    stubRoutes({
      [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE },
      [CAP_URL]: { layout: "v2", capability: DETAIL },
    });
    history.replaceState({ view: "plan" }, "", "/plan?x=1");
    await mount(h(AreaInPlace, { slug: AREA_DETAIL_FIXTURE.slug, onOpenPage: vi.fn() }));
    act(() => block().click());
    await settle();
    expect(location.pathname).toBe(areaCapabilityPath(AREA_DETAIL_FIXTURE.slug, CAP_ID));
    act(() => { render(null, root); });
    expect(`${location.pathname}${location.search}`).toBe("/plan?x=1");
    expect(history.state).toEqual({ view: "plan" });
  });

  it("opened at the capability's address, selects it, and Esc goes back to the area's address", async () => {
    history.replaceState(null, "", areaCapabilityPath(AREA_DETAIL_FIXTURE.slug, CAP_ID));
    stubRoutes({
      [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE },
      [CAP_URL]: { layout: "v2", capability: DETAIL },
    });
    await mount(h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug, initialCapabilityId: CAP_ID }));
    expect(root.querySelector(".area-capability")).not.toBeNull();
    // Both reads were in flight together; wait for the capability's to land.
    await vi.waitFor(() => expect(root.querySelector(".area-capability .cap-statement-text")).not.toBeNull());
    pressEscape(root.querySelector(".area-capability")!);
    expect(location.pathname).toBe(areaPath(AREA_DETAIL_FIXTURE.slug));
  });

  it("opened at an address naming a capability the area does not list, shows the cards at the area's address", async () => {
    history.replaceState(null, "", areaCapabilityPath(AREA_DETAIL_FIXTURE.slug, "A1.1"));
    stubRoutes({ [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE } });
    await mount(h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug, initialCapabilityId: "A1.1" }));
    await settle();
    // Clearing the selection is a second render, after the read's own: wait for it, not for a time.
    await vi.waitFor(() => {
      expect(root.querySelector(".area-capability")).toBeNull();
      expect(root.querySelector(".area-cards")).not.toBeNull();
      expect(location.pathname).toBe(areaPath(AREA_DETAIL_FIXTURE.slug));
    });
  });

  it("opened at an address with a malformed capability id, renders the area instead of throwing", async () => {
    stubRoutes({
      "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE },
      [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE },
    });
    await mount(h("div", null, renderActiveView("product", {
      navigateTo: vi.fn(),
      validViews: buildValidViews(null),
      data: {},
      isFeatureDisabled: () => false,
      selectedTab: `area/${AREA_DETAIL_FIXTURE.slug}/capability/%E0`,
    } as never)));
    await vi.waitFor(() => expect(root.querySelector(".area-cards:not(.area-capability)")).not.toBeNull());
    expect(root.querySelector(".area-capability")).toBeNull();
  });

  it("treats a capability the area marks retired as no selection, in the address and after a click", async () => {
    const [first, ...rest] = AREA_DETAIL_FIXTURE.capabilities;
    const retired = { ...AREA_DETAIL_FIXTURE, capabilities: [{ ...first!, status: "retired" as const }, ...rest] };
    stubRoutes({
      [AREA_URL]: { layout: "v2", area: retired },
      [CAP_URL]: { layout: "v2", capability: DETAIL },
    });
    history.replaceState(null, "", areaCapabilityPath(AREA_DETAIL_FIXTURE.slug, CAP_ID));
    await mount(h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug, initialCapabilityId: CAP_ID }));
    await vi.waitFor(() => {
      expect(root.querySelector(".area-capability")).toBeNull();
      expect(location.pathname).toBe(areaPath(AREA_DETAIL_FIXTURE.slug));
    });
    expect(block()).toBeNull();
  });

  it("clears the selection and the address when a refresh stops listing the capability", async () => {
    await open();
    act(() => block().click());
    await settle();
    expect(location.pathname).toBe(areaCapabilityPath(AREA_DETAIL_FIXTURE.slug, CAP_ID));
    const retired = { ...AREA_DETAIL_FIXTURE, capabilities: AREA_DETAIL_FIXTURE.capabilities.slice(1) };
    stubRoutes({ [AREA_URL]: { layout: "v2", area: retired }, [CAP_URL]: { layout: "v2", capability: DETAIL } });
    const { createWSPipeline } = await import("../../../src/viewer/hooks/use-gateway.js");
    // Every live read subscribes; the batch reaches them all, as the socket's would.
    const flushes = vi.mocked(createWSPipeline).mock.calls.map(([o]) => (o as { onFlush: (batch: { types: Set<string> }) => void }).onFlush);
    act(() => { for (const flush of flushes) flush({ types: new Set(["rex:prd-changed"]) }); });
    await settle();
    await vi.waitFor(() => {
      expect(root.querySelector(".area-capability")).toBeNull();
      expect(location.pathname).toBe(areaPath(AREA_DETAIL_FIXTURE.slug));
    });
  });
});

describe("with the Sidecar on", () => {
  const CAP_ID = AREA_DETAIL_FIXTURE.capabilities[0]!.id;
  const CAP_URL = `/api/rex/product/capability/${CAP_ID}`;
  const DETAIL = { ...CAPABILITY_DETAIL_FIXTURE, id: CAP_ID, title: AREA_DETAIL_FIXTURE.capabilities[0]!.title };
  const sidecar = (): PlanWithSidecar => ({ plan: vi.fn(), planIn: vi.fn(), reportArea: vi.fn() });
  const withSidecar = (value: PlanWithSidecar, props: Partial<Parameters<typeof AreaView>[0]> = {}) =>
    h(PlanWithSidecarContext.Provider, { value }, h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug, ...props }));

  it("reports the area it shows, and nothing once it closes", async () => {
    stubRoutes({ [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE } });
    const value = sidecar();
    await mount(withSidecar(value));
    await vi.waitFor(() =>
      expect(value.reportArea).toHaveBeenLastCalledWith({ id: AREA_DETAIL_FIXTURE.id, label: AREA_DETAIL_FIXTURE.title, capabilityId: null }));
    act(() => { render(null, root); });
    expect(value.reportArea).toHaveBeenLastCalledWith(null);
  });

  it("reports the capability selected in it", async () => {
    stubRoutes({ [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE }, [CAP_URL]: { layout: "v2", capability: DETAIL } });
    const value = sidecar();
    await mount(withSidecar(value, { initialCapabilityId: CAP_ID }));
    await vi.waitFor(() => expect(value.reportArea).toHaveBeenLastCalledWith({ id: AREA_DETAIL_FIXTURE.id, label: AREA_DETAIL_FIXTURE.title, capabilityId: CAP_ID }));
  });

  it("offers Plan in this area, aimed at the area's id", async () => {
    stubRoutes({ [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE } });
    const value = sidecar();
    await mount(withSidecar(value));
    await vi.waitFor(() => expect(root.querySelector(".area-plan-in")).not.toBeNull());
    act(() => { root.querySelector<HTMLButtonElement>(".area-plan-in")!.click(); });
    expect(value.planIn).toHaveBeenCalledWith(AREA_DETAIL_FIXTURE.id);
  });

  it("offers no Plan in this area while the Sidecar is off", async () => {
    stubRoutes({ [AREA_URL]: { layout: "v2", area: AREA_DETAIL_FIXTURE } });
    await mount(h(AreaView, { slug: AREA_DETAIL_FIXTURE.slug }));
    expect(root.querySelector(".area-plan-in")).toBeNull();
  });
});
