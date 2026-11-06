// @vitest-environment jsdom
/**
 * The routed Product and Changes pages: fed from the v2 product reads, and on
 * a v1 project an empty state naming `ndx migrate`.
 *
 * @see src/viewer/views/product-pages.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render, type FunctionComponent } from "preact";
import { act } from "preact/test-utils";
import { ProductPage, ChangesPage } from "../../../src/viewer/views/product-pages.js";
import { STAGES, stageViews } from "../../../src/viewer/views/index.js";
import { renderActiveView } from "../../../src/viewer/views/view-registry.js";
import { isAppliedStage } from "../../../src/viewer/views/product-model.js";
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

  it("Plan no longer lists Requirements, yet still owns its route and keeps it valid", () => {
    expect(STAGES.plan.sections.map((s) => s.view)).not.toContain("requirements");
    expect(stageViews("plan")).toContain("requirements");
    expect(buildValidViews(null).has("requirements")).toBe(true);
    expect(buildValidViews("rex").has("requirements")).toBe(true);
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
    // Applied and shipped changes start collapsed behind their release's count.
    const open = CHANGES_FIXTURE.filter((c) => !isAppliedStage(c.stage));
    expect(root.querySelectorAll("[data-change-id]")).toHaveLength(open.length);

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

  describe("a refetch that fails after a successful load", () => {
    const capabilityUrl = `/api/rex/product/capability/${CAPABILITY_DETAIL_FIXTURE.id}`;

    /** Answer from `routes`, but 500 (or reject) every product read once `broken.on`. */
    function stubBreakable(broken: { on: boolean; reject?: boolean }): void {
      const routes: Record<string, unknown> = {
        "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE },
        [capabilityUrl]: { layout: "v2", capability: CAPABILITY_DETAIL_FIXTURE },
      };
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (broken.on && broken.reject) throw new Error("network down");
        if (broken.on) return { ok: false, status: 500, json: async () => ({ error: "Could not read the product" }) };
        return { ok: true, status: 200, json: async () => routes[url] };
      }));
    }

    it.each([
      ["answers 500", false],
      ["rejects", true],
    ])("keeps the map on screen and reports it when the fetch %s", async (_name, reject) => {
      const broken = { on: false, reject };
      stubBreakable(broken);
      await mount(h(ProductPage, null));
      broken.on = true;
      await flushFrames("rex:prd-changed");

      expect(root.querySelectorAll(".pm-area")).toHaveLength(PRODUCT_MAP_FIXTURE.areas.length);
      expect(root.querySelector('[role="alert"]')?.textContent).toContain("Could not refresh");
    });

    it("leaves an open capability page and its Back button rendered", async () => {
      const broken = { on: false };
      stubBreakable(broken);
      await mount(h(ProductPage, null));
      act(() => {
        [...root.querySelectorAll<HTMLButtonElement>(".pm-capability-link")]
          .find((b) => b.textContent === CAPABILITY_DETAIL_FIXTURE.title)!.click();
      });
      await settle();
      broken.on = true;
      await flushFrames("rex:prd-changed");

      expect(root.querySelector(".cap-container")?.getAttribute("data-capability-id")).toBe(CAPABILITY_DETAIL_FIXTURE.id);
      expect(root.querySelector(".cap-back")).not.toBeNull();
      expect(root.querySelector('[role="alert"]')?.textContent).toContain("Could not read the product");
    });

    it("clears the notice once a later refetch succeeds", async () => {
      const broken = { on: false };
      stubBreakable(broken);
      await mount(h(ProductPage, null));
      broken.on = true;
      await flushFrames("rex:prd-changed");
      broken.on = false;
      await flushFrames("rex:prd-changed");
      expect(root.querySelector('[role="alert"]')).toBeNull();
    });
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

  describe("editing a capability's spec", () => {
    const capabilityUrl = `/api/rex/product/capability/${CAPABILITY_DETAIL_FIXTURE.id}`;
    const met = { ...CAPABILITY_DETAIL_FIXTURE, status: "met" as const, specChangedSinceMet: false };
    let posts: Array<{ url: string; body: Record<string, unknown> }>;

    /** Serve the capability read and answer `POST /api/rex/product/edit` with `editStatus`. */
    function stubEditable(capability: typeof met, editStatus = 200): void {
      posts = [];
      fetched = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        fetched.push(url);
        if (init?.method === "POST") {
          posts.push({ url, body: JSON.parse(init.body ?? "{}") });
          return { ok: editStatus === 200, status: editStatus, json: async () => (editStatus === 200 ? { layout: "v2" } : { error: "refused by rex" }) };
        }
        const body = url === "/api/rex/product"
          ? { layout: "v2", map: PRODUCT_MAP_FIXTURE }
          : url === capabilityUrl ? { layout: "v2", capability } : undefined;
        return { ok: body !== undefined, status: body ? 200 : 404, json: async () => body ?? { error: "not found" } };
      }));
    }

    async function openAndType(): Promise<void> {
      await mount(h(ProductPage, null));
      act(() => {
        [...root.querySelectorAll<HTMLButtonElement>(".pm-capability-link")]
          .find((b) => b.textContent === CAPABILITY_DETAIL_FIXTURE.title)!.click();
      });
      await settle();
      const statement = root.querySelector<HTMLTextAreaElement>(".cap-edit-statement")!;
      act(() => {
        statement.value = "A reworded statement.";
        statement.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    const save = async () => {
      await act(async () => {
        root.querySelector<HTMLFormElement>(".cap-edit-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        // The post resolves, then the refetch it triggers; both inside this act.
        await new Promise((r) => setTimeout(r, 20));
      });
      await settle();
    };

    it("renders the edit form, and a submit posts the edit and refetches the page", async () => {
      stubEditable(met);
      await openAndType();
      await save();

      expect(posts).toEqual([{
        url: "/api/rex/product/edit",
        body: {
          id: met.id,
          statement: "A reworded statement.",
          criteria: met.criteria.filter((c) => !c.inheritedFrom).map(({ id, text }) => ({ id, text })),
          editorial: false,
        },
      }]);
      expect(fetched.filter((u) => u === capabilityUrl)).toHaveLength(2);
    });

    it("sends editorial: true when the checkbox is checked", async () => {
      stubEditable(met);
      await openAndType();
      act(() => { root.querySelector<HTMLInputElement>(".cap-edit-editorial-check")!.click(); });
      await save();
      expect(posts[0].body.editorial).toBe(true);
    });

    it("reseeds the form when a refetch brings a criterion edited elsewhere", async () => {
      stubEditable(met);
      await openAndType();
      const own = met.criteria.find((c) => !c.inheritedFrom)!;
      const edited = { ...met, criteria: met.criteria.map((c) => (c.id === own.id ? { ...c, text: "Edited elsewhere" } : c)) };
      stubEditable(edited);
      await flushFrames("rex:prd-changed");
      const input = root.querySelector<HTMLInputElement>(`.cap-edit-criterion[data-criterion-id="${own.id}"]`)!;
      expect(input.value).toBe("Edited elsewhere");
    });

    it("shows why a save was refused and does not refetch", async () => {
      stubEditable(met, 409);
      await openAndType();
      await save();
      expect(root.textContent).toContain("Could not save the edit: refused by rex");
      expect(fetched.filter((u) => u === capabilityUrl)).toHaveLength(1);
    });
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
    await act(async () => { render(h(Page as FunctionComponent, null), root); });
    await act(async () => { await getProjectMetadata(); });
    const empty = root.querySelector(".pm-no-product-layer");
    expect(empty?.textContent).toContain("ndx migrate");
    expect(root.querySelector(".pm-area, [data-change-id]")).toBeNull();
  });

  const v1Tabs = () => [...root.querySelectorAll<HTMLButtonElement>('[aria-label="Product views"] [role="tab"]')];

  it("the /requirements route shows the requirements view under the Product tabs", async () => {
    stubRoutes({ "/api/rex/product": { layout: "v1" } });
    await mount(h(ProductPage, { initialTab: "requirements" }));
    // The requirements view mounts once the product read lands, and reads on mount.
    await vi.waitFor(() => expect(fetched).toContain("/api/rex/requirements/coverage"));
    await settle();
    expect(v1Tabs().map((t) => t.textContent)).toEqual(["Map", "Requirements"]);
    expect(v1Tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector(".pm-no-product-layer")).toBeNull();
  });

  it("the Product page opens on Map with the migrate notice, and Requirements is one click away", async () => {
    stubRoutes({ "/api/rex/product": { layout: "v1" } });
    await mount(h(ProductPage, null));
    expect(v1Tabs().map((t) => t.textContent)).toEqual(["Map", "Requirements"]);
    expect(root.querySelector(".pm-no-product-layer")).not.toBeNull();
    act(() => { v1Tabs()[1].click(); });
    await vi.waitFor(() => expect(fetched).toContain("/api/rex/requirements/coverage"));
    await settle();
    expect(root.querySelector(".pm-no-product-layer")).toBeNull();
  });
});

describe("the Requirements tab", () => {
  const tabs = () => [...root.querySelectorAll<HTMLButtonElement>('[aria-label="Product views"] [role="tab"]')];

  it("sits beside Map and renders the coverage and traceability reads", async () => {
    stubRoutes({ "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE } });
    await mount(h(ProductPage, null));
    expect(tabs().map((t) => t.textContent)).toEqual(["Map", "Requirements"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");

    act(() => { tabs()[1].click(); });
    await vi.waitFor(() => expect(fetched).toContain("/api/rex/requirements/traceability"));
    await settle();
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(fetched).toContain("/api/rex/requirements/coverage");
    expect(root.querySelector(".pm-area")).toBeNull();
  });

  it("moving from /requirements to /product opens the map, not the previous route's tab", async () => {
    stubRoutes({ "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE } });
    // The shell renders the active view in one slot, unkeyed, so the registry must key the two routes apart.
    await mount(h("div", null, renderActiveView("requirements", {} as never)));
    await vi.waitFor(() => expect(tabs()[1]?.getAttribute("aria-selected")).toBe("true"));
    await mount(h("div", null, renderActiveView("product", {} as never)));
    await vi.waitFor(() => expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true"));
    expect(root.querySelectorAll(".pm-area")).toHaveLength(PRODUCT_MAP_FIXTURE.areas.length);
  });

  it("the /requirements route opens on that tab on a v2 project", async () => {
    stubRoutes({ "/api/rex/product": { layout: "v2", map: PRODUCT_MAP_FIXTURE } });
    await mount(h(ProductPage, { initialTab: "requirements" }));
    await vi.waitFor(() => expect(fetched).toContain("/api/rex/requirements/coverage"));
    await settle();
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  });
});
