// @vitest-environment jsdom
/**
 * The routed Product and Changes pages: fed from the v2 product reads, and on
 * a v1 project an empty state naming `ndx migrate`.
 *
 * @see src/viewer/views/product-pages.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ProductPage, ChangesPage } from "../../../src/viewer/views/product-pages.js";
import { STAGES } from "../../../src/viewer/views/index.js";
import { buildValidViews } from "../../../src/shared/index.js";
import {
  CAPABILITY_DETAIL_FIXTURE,
  CHANGES_FIXTURE,
  PRODUCT_MAP_FIXTURE,
} from "../../fixtures/v2-product-map.js";

let root: HTMLDivElement;
let fetched: string[];

/** Answer each URL from `routes`; anything else is a 404. */
function stubRoutes(routes: Record<string, unknown>): void {
  fetched = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    const body = routes[url];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      json: async () => body ?? { error: "not found" },
    };
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
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

describe("routing", () => {
  it("places Product and Changes on the Plan stage as server-backed rex views", () => {
    const plan = STAGES.plan.sections.filter((s) => s.view === "product" || s.view === "changes");
    expect(plan).toEqual([
      { view: "product", requiresServer: true },
      { view: "changes", requiresServer: true },
    ]);
    expect(buildValidViews("rex").has("product")).toBe(true);
    expect(buildValidViews("rex").has("changes")).toBe(true);
  });
});

describe("on a v2 project", () => {
  it("the Product page renders the map from GET /api/rex/product", async () => {
    stubRoutes({ "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE } });
    await mount(h(ProductPage, null));
    expect(fetched).toEqual(["/api/rex/product"]);
    expect(root.querySelectorAll(".pm-area")).toHaveLength(PRODUCT_MAP_FIXTURE.areas.length);
    expect(root.textContent).toContain("Define the product");
  });

  it("a capability row opens its page from the capability route, and Back returns to the map", async () => {
    const capabilityUrl = `/api/rex/product/capability/${CAPABILITY_DETAIL_FIXTURE.id}`;
    stubRoutes({
      "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE },
      [capabilityUrl]: { layout: "v2", capability: CAPABILITY_DETAIL_FIXTURE },
    });
    await mount(h(ProductPage, null));

    const link = [...root.querySelectorAll<HTMLButtonElement>(".pm-capability-link")]
      .find((b) => b.textContent === CAPABILITY_DETAIL_FIXTURE.title);
    expect(link).toBeDefined();
    act(() => { link!.click(); });
    await settle();

    expect(fetched).toContain(capabilityUrl);
    expect(root.querySelector(".cap-container")?.getAttribute("data-capability-id")).toBe(CAPABILITY_DETAIL_FIXTURE.id);

    act(() => { root.querySelector<HTMLButtonElement>(".cap-back")!.click(); });
    expect(root.querySelector(".pm-container")).not.toBeNull();
  });

  it("the Changes view renders the changes from GET /api/rex/changes", async () => {
    stubRoutes({ "/api/rex/changes": { layout: "v2", changes: CHANGES_FIXTURE } });
    const navigateTo = vi.fn();
    await mount(h(ChangesPage, { navigateTo }));
    expect(root.querySelectorAll("[data-change-id]")).toHaveLength(CHANGES_FIXTURE.length);

    act(() => { root.querySelector<HTMLButtonElement>(".ch-change-link")!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: expect.any(String) });
  });

  it("says what failed when a read errors", async () => {
    stubRoutes({});
    await mount(h(ChangesPage, null));
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("not found");
  });
});

describe("on a v1 project", () => {
  it.each([
    ["Product", ProductPage, "/api/rex/product"],
    ["Changes", ChangesPage, "/api/rex/changes"],
  ] as const)("the %s page shows an empty state naming ndx migrate", async (_name, Page, url) => {
    // The command is named with the project's CLI name, as `ndx start` reports it.
    stubRoutes({ [url]: { layout: "v1" }, "/api/project": { cliName: "ndx" } });
    await mount(h(Page, null));
    await settle(); // the empty state's own project-metadata read
    const empty = root.querySelector(".pm-no-product-layer");
    expect(empty?.textContent).toContain("ndx migrate");
    expect(root.querySelector(".pm-area, [data-change-id]")).toBeNull();
  });
});
