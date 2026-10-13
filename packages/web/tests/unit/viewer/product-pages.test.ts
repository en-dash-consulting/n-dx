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
import { clearProjectMetadataCache, getProjectMetadata } from "../../../src/viewer/hooks/use-project-metadata.js";
import {
  CAPABILITY_DETAIL_FIXTURE,
  CHANGES_FIXTURE,
  PRODUCT_MAP_FIXTURE,
} from "../../fixtures/v2-product-map.js";

// The WebSocket pipeline is captured so a test can deliver a coalesced flush.
const flushes: Array<(batch: { types: Set<string> }) => void> = [];
vi.mock("../../../src/viewer/hooks/use-gateway.js", () => ({
  createWSPipeline: vi.fn((opts: { onFlush: (batch: { types: Set<string> }) => void }) => {
    flushes.push(opts.onFlush);
    return { push: vi.fn(), dispose: vi.fn() };
  }),
}));

let root: HTMLDivElement;
let fetched: string[];

/** Deliver a flushed batch of frame types to every mounted subscriber. */
async function flushFrames(...types: string[]): Promise<void> {
  act(() => { for (const onFlush of [...flushes]) onFlush({ types: new Set(types) }); });
  await settle();
}

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
  // The project-metadata hook caches `/api/project` at module level, so
  // without this the second case reads the first case's answer and never
  // exercises the cold path.
  clearProjectMetadataCache();
  flushes.length = 0;
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

  it("a capability that fails to load still offers the way back to the map", async () => {
    stubRoutes({ "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE } });
    await mount(h(ProductPage, null));
    act(() => { root.querySelector<HTMLButtonElement>(".pm-capability-link")!.click(); });
    await settle();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain("not found");
    act(() => { root.querySelector<HTMLButtonElement>(".cap-back")!.click(); });
    expect(root.querySelectorAll(".pm-area")).toHaveLength(PRODUCT_MAP_FIXTURE.areas.length);
  });

  it("the Changes view renders the changes from GET /api/rex/changes", async () => {
    stubRoutes({ "/api/rex/changes": { layout: "v2", changes: CHANGES_FIXTURE } });
    const navigateTo = vi.fn();
    await mount(h(ChangesPage, { navigateTo }));
    expect(root.querySelectorAll("[data-change-id]")).toHaveLength(CHANGES_FIXTURE.length);

    act(() => { root.querySelector<HTMLButtonElement>(".ch-change-link")!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: expect.any(String) });
  });

  it("the Product page refetches the map after a rex:prd-changed frame", async () => {
    const renamed = { ...PRODUCT_MAP_FIXTURE, areas: PRODUCT_MAP_FIXTURE.areas.map((a) => ({ ...a, title: `${a.title} (new)` })) };
    const routes: Record<string, unknown> = { "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE } };
    stubRoutes(routes);
    await mount(h(ProductPage, null));
    expect(root.textContent).not.toContain("(new)");

    routes["/api/rex/product"] = { layout: "v2", map: renamed };
    await flushFrames("rex:prd-changed");
    expect(fetched).toEqual(["/api/rex/product", "/api/rex/product"]);
    expect(root.textContent).toContain("(new)");
  });

  it("the Changes page lists a change added since it mounted", async () => {
    const added = { ...CHANGES_FIXTURE[0]!, id: "change-added-later", displayId: "CH-999", title: "Added later" };
    const routes: Record<string, unknown> = { "/api/rex/changes": { layout: "v2", changes: CHANGES_FIXTURE } };
    stubRoutes(routes);
    await mount(h(ChangesPage, null));
    expect(root.querySelector('[data-change-id="change-added-later"]')).toBeNull();

    routes["/api/rex/changes"] = { layout: "v2", changes: [...CHANGES_FIXTURE, added] };
    await flushFrames("rex:prd-changed");
    expect(root.querySelector('[data-change-id="change-added-later"]')).not.toBeNull();
  });

  it("an open capability page refetches its capability", async () => {
    const capabilityUrl = `/api/rex/product/capability/${CAPABILITY_DETAIL_FIXTURE.id}`;
    stubRoutes({
      "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE },
      [capabilityUrl]: { layout: "v2", capability: CAPABILITY_DETAIL_FIXTURE },
    });
    await mount(h(ProductPage, null));
    act(() => {
      [...root.querySelectorAll<HTMLButtonElement>(".pm-capability-link")]
        .find((b) => b.textContent === CAPABILITY_DETAIL_FIXTURE.title)!.click();
    });
    await settle();

    await flushFrames("rex:prd-changed");
    expect(fetched.filter((u) => u === capabilityUrl)).toHaveLength(2);
    expect(root.querySelector(".cap-container")).not.toBeNull();
  });

  it("ignores a flush that carries no rex:prd-changed frame", async () => {
    stubRoutes({ "/api/rex/changes": { layout: "v2", changes: CHANGES_FIXTURE } });
    await mount(h(ChangesPage, null));
    await flushFrames("hench:run-changed");
    expect(fetched).toEqual(["/api/rex/changes"]);
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
    // Mount under act so the effect that starts the `/api/project` read runs
    // here, then await that same read under act so its state update flushes
    // synchronously. A fixed wait let the update land outside act(), which
    // armed preact's after-paint fallback timer (the frame-leak guard's
    // failure) and, on a slow runner, asserted before the CLI name arrived.
    await act(async () => { render(h(Page, null), root); });
    await act(async () => { await getProjectMetadata(); });
    const empty = root.querySelector(".pm-no-product-layer");
    expect(empty?.textContent).toContain("ndx migrate");
    expect(root.querySelector(".pm-area, [data-change-id]")).toBeNull();
  });
});
