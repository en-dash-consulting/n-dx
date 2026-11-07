// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";

// The layout the status reports; each test sets it before rendering.
let layout: "v1" | "v2" = "v1";
vi.mock("../../../src/viewer/hooks/use-project-status.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/viewer/hooks/use-project-status.js")>()),
  useStatusLayout: () => layout,
}));

import { PageTitle } from "../../../src/viewer/components/page-title.js";
import { ProjectContext } from "../../../src/viewer/components/project-context.js";
import { StageLinks } from "../../../src/viewer/components/stage-links.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { viewLabelFor, viewBlurbFor } from "../../../src/viewer/views/index.js";
import type { ViewId } from "../../../src/viewer/types.js";

async function settle() {
  await new Promise((r) => setTimeout(r, 10));
  await act(async () => {});
}

describe.each([
  ["v2", "Change tree"],
  ["v1", "Tasks"],
] as const)("a %s tree names the prd view %s", (treeLayout, word) => {
  let root: HTMLDivElement;

  beforeEach(() => {
    layout = treeLayout;
    clearProjectMetadataCache();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/api/project")
      ? { ok: true, status: 200, json: async () => ({ name: "demo", description: null, version: null, git: null, nameSource: "directory" }) }
      : { ok: true, status: 200, json: async () => ({}) }));
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  it("in the page title and its blurb", () => {
    act(() => { render(h(PageTitle, { view: "prd" }), root); });
    expect(root.querySelector("h1")?.textContent).toBe(word);
    expect(root.querySelector(".page-title-blurb")?.textContent).toBe(viewBlurbFor("prd", treeLayout));
  });

  it("in document.title", async () => {
    act(() => { render(h(ProjectContext, { view: "prd" }), root); });
    await settle();
    expect(document.title.startsWith(`${word} — Rex`), document.title).toBe(true);
  });
});

describe("the Up Next blurb on a v2 tree", () => {
  it("names changes, not epics", () => {
    layout = "v2";
    const root = document.createElement("div");
    act(() => { render(h(PageTitle, { view: "rex-dashboard" as ViewId }), root); });
    expect(root.querySelector(".page-title-blurb")?.textContent).toBe(viewBlurbFor("rex-dashboard", "v2"));
    expect(viewBlurbFor("rex-dashboard", "v2")).not.toMatch(/epic|feature/i);
    expect(viewLabelFor("rex-dashboard", "v2")).toBe("Up Next");
    act(() => { render(null, root); });
  });
});

describe("stage links", () => {
  it("still name stages on either layout", () => {
    layout = "v2";
    const root = document.createElement("div");
    act(() => {
      render(h(StageLinks, { stage: "plan", validViews: new Set<ViewId>(["analyze", "plan", "work", "tune"]), onNavigate: () => {} }), root);
    });
    expect(root.querySelector(".stage-link-next .stage-link-name")?.textContent).toBe("Work");
    act(() => { render(null, root); });
  });
});
