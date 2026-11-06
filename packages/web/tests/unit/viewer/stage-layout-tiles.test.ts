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
  const V2_ONLY = ["product", "inbox", "changes"];

  it("mounts no v2-only tile with null status, then a v1 status", () => {
    status = null;
    mount();
    expect(tiles()).toContain("validation");
    for (const v of V2_ONLY) expect(tiles()).not.toContain(v);

    status = withLayout("v1");
    mount();
    expect(tiles()).toContain("prd");
    for (const v of V2_ONLY) expect(tiles()).not.toContain(v);
  });

  it("brings the v2 tiles in once status says v2", () => {
    status = null;
    mount();
    status = withLayout("v2");
    mount();
    for (const v of V2_ONLY) expect(tiles()).toContain(v);
  });

  it("shows the v2 tiles when status arrives with no PRD (no layout)", () => {
    status = { rex: { exists: false } } as unknown as Pick<ProjectStatus, "rex">;
    mount();
    for (const v of V2_ONLY) expect(tiles()).toContain(v);
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
