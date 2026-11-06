// @vitest-environment jsdom
/**
 * The Plan stage picks its tile set from the PRD layout in project status. A
 * failed status poll (null) must keep the set on screen: swapping it unmounts
 * the open tile and loses its state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { ProjectStatus } from "../../../src/viewer/components/index.js";

let status: Pick<ProjectStatus, "rex"> | null = null;

vi.mock("../../../src/viewer/components/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/viewer/components/index.js")>()),
  useProjectStatus: () => status,
}));

import { StagePage } from "../../../src/viewer/views/stage-pages.js";
import { ProductPage } from "../../../src/viewer/views/product-pages.js";
import { buildValidViews } from "../../../src/shared/index.js";

const withLayout = (layout: "v1" | "v2") => ({ rex: { layout } }) as unknown as Pick<ProjectStatus, "rex">;

let root: HTMLElement;

function mount() {
  act(() => {
    render(h(StagePage, {
      stage: "plan",
      validViews: buildValidViews(null),
      navigateTo: () => {},
      renderView: (v) => h("div", { class: `view-${v}` }),
    }), root);
  });
}

const tiles = () => [...root.querySelectorAll("[data-tile]")].map((e) => e.getAttribute("data-tile"));

beforeEach(() => {
  status = null;
  root = document.createElement("div");
  document.body.appendChild(root);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

describe("Plan tiles before the first status", () => {
  // Tiles are keyed by panel when they have one (Product map, Open changes glance).
  const V2_ONLY = ["product-map", "inbox", "changes-glance"];

  it("mounts no v2-only tile with null status, then a v1 status", () => {
    status = null;
    mount();
    // Validation sits on Plan as the Plan health panel tile.
    expect(tiles()).toContain("plan-health");
    for (const v of V2_ONLY) expect(tiles()).not.toContain(v);

    status = withLayout("v1");
    mount();
    expect(tiles()).toContain("prd");
    // v1 keeps a Product tile (its tabs lead to Requirements), not the v2 Inbox or changes.
    expect(tiles()).toContain("product");
    for (const v of ["inbox", "changes"]) expect(tiles()).not.toContain(v);
  });

  it("brings the v2 tiles in once status says v2", () => {
    status = null;
    mount();
    status = withLayout("v2");
    mount();
    for (const v of V2_ONLY) expect(tiles()).toContain(v);
  });

  it("shows Tasks, and no tile that says to migrate, when status arrives with no PRD", () => {
    status = { rex: { exists: false } } as unknown as Pick<ProjectStatus, "rex">;
    mount();
    // Tasks carries the "no PRD yet" empty state; Product would say to run migrate.
    expect(tiles()).toContain("prd");
    for (const v of V2_ONLY) expect(tiles()).not.toContain(v);
  });

  it("brings the v2 tiles in once a PRD appears", () => {
    status = { rex: { exists: false } } as unknown as Pick<ProjectStatus, "rex">;
    mount();
    status = { rex: { exists: true, layout: "v2" } } as unknown as Pick<ProjectStatus, "rex">;
    mount();
    for (const v of V2_ONLY) expect(tiles()).toContain(v);
  });
});

describe("Plan on a v1 project", () => {
  it("reaches Requirements through the Product tile's tabs", async () => {
    status = withLayout("v1");
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url);
      const body = url === "/api/rex/product" ? { layout: "v1" }
        : url === "/api/rex/requirements/coverage" ? { byCategory: {}, byValidationType: {}, byPriority: {} }
        : url === "/api/rex/requirements/traceability" ? { matrix: [] }
        : {};
      return { ok: true, status: 200, json: async () => body };
    }));
    await act(async () => {
      render(h(StagePage, {
        stage: "plan",
        validViews: buildValidViews(null),
        navigateTo: () => {},
        renderView: (v) => (v === "product" ? h(ProductPage, null) : h("div", { class: `view-${v}` })),
      }), root);
    });
    expect(tiles()).toContain("product");

    const tab = await vi.waitFor(() => {
      const t = [...root.querySelectorAll<HTMLButtonElement>('[data-tile="product"] [aria-label="Product views"] [role="tab"]')]
        .find((b) => b.textContent === "Requirements");
      expect(t).toBeDefined();
      return t!;
    });
    await act(async () => { tab.click(); });
    await vi.waitFor(() => expect(fetched).toContain("/api/rex/requirements/coverage"));
  });
});

describe("Plan tiles across a failed status poll", () => {
  it("keeps the v1 tiles when status drops to null after a v1 load", () => {
    status = withLayout("v1");
    mount();
    const v1 = tiles();
    expect(v1).toContain("prd");
    expect(v1).not.toContain("inbox");

    status = null;
    mount();
    expect(tiles()).toEqual(v1);
  });

  it("keeps the v2 tiles when status drops to null after a v2 load", () => {
    status = withLayout("v2");
    mount();
    const v2 = tiles();
    expect(v2).toContain("inbox");

    status = null;
    mount();
    expect(tiles()).toEqual(v2);
  });
});
