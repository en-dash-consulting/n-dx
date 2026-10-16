// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TileGrid } from "../../../src/viewer/views/stage-tiles.js";
import type { StageTile } from "../../../src/viewer/views/stages.js";
import type { ViewId } from "../../../src/viewer/types.js";

const TILES: StageTile[] = [
  { view: "iso-map", panel: "map", title: "Codebase map", cols: 8, rows: 3, chromeless: true },
  { view: "problems" },
  { view: "files", rows: 2 },
  { view: "architecture", tabs: [{ view: "routes" }] },
];

let root: HTMLElement;

function mount(extra: Partial<Parameters<typeof TileGrid>[0]> = {}) {
  act(() => {
    render(h(TileGrid, {
      stage: "analyze",
      tiles: TILES,
      tabsOf: (t) => [{ view: t.view }, ...(t.tabs ?? [])],
      renderView: (v: ViewId) => h("div", { class: `view view-${v}` }, `view:${v}`),
      renderPanel: (p) => h("div", { class: `panel panel-${p}` }),
      renderSummary: (t) => (t.view === "problems" ? h("p", { class: "summary" }, "5 critical") : null),
      ...extra,
    }), root);
  });
}

const tile = (key: string) => root.querySelector<HTMLElement>(`[data-tile="${key}"]`)!;
const head = (key: string) => tile(key).querySelector<HTMLButtonElement>(".stage-tile-head")!;
const dialog = () => root.querySelector<HTMLElement>(".stage-tile-fullscreen");

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("TileGrid", () => {
  it("spans each tile over its columns and rows", () => {
    mount();
    expect(tile("map").className).toContain("stage-tile--c8");
    expect(tile("map").className).toContain("stage-tile--r3");
    expect(tile("problems").className).toContain("stage-tile--c4 stage-tile--r1");
    expect(tile("files").className).toContain("stage-tile--r2");
  });

  it("shows a summary where one exists, else the view as a preview", () => {
    mount();
    expect(tile("problems").querySelector(".summary")?.textContent).toBe("5 critical");
    expect(tile("problems").querySelector(".view")).toBeNull();
    expect(tile("files").querySelector(".stage-tile-body--view .view-files")).not.toBeNull();
  });

  it("lets a chromeless panel open its own tile in the modal (the map's Expand)", () => {
    mount({
      renderPanel: (p, opened, grid) => opened
        ? h("div", { class: `panel-${p}-opened` })
        : h("button", { class: `expand-${p}`, onClick: () => grid.openTile(p) }, "Expand"),
    });
    act(() => tile("map").querySelector<HTMLButtonElement>(".expand-map")!.click());
    expect(dialog()!.querySelector(".panel-map-opened")).not.toBeNull();
    expect(dialog()!.querySelector("h2")?.textContent).toBe("Codebase map");
  });

  it("renders a chromeless tile as its panel alone, with no header to open it", () => {
    mount();
    expect(tile("map").className).toContain("stage-tile--chromeless");
    expect(tile("map").querySelector(".panel-map")).not.toBeNull();
    expect(tile("map").querySelector(".stage-tile-head")).toBeNull();
  });

  it("opens a tile from its header — its one action — and closes with Esc, returning focus", () => {
    mount();
    expect(head("problems").getAttribute("aria-label")).toBe("Open Problems");
    // No separate expand or Open control on the tile itself.
    expect(tile("problems").querySelectorAll("button")).toHaveLength(1);

    head("problems").focus();
    act(() => head("problems").click());
    expect(dialog()!.querySelector("[role=dialog]")?.getAttribute("aria-modal")).toBe("true");
    expect(dialog()!.querySelector(".view-problems")).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close Problems");

    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(head("problems"));
  });

  it("has two modes only: an opened tile offers no Open link", () => {
    mount();
    act(() => head("files").click());
    expect([...dialog()!.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Open ↗");
  });

  it("heads an opened tile with a trail back to the stage, which closes it", () => {
    mount();
    act(() => head("files").click());
    const trail = dialog()!.querySelector(".stage-tile-trail")!;
    expect(trail.querySelector(".stage-tile-trail-back")?.textContent).toBe("← Analysis");
    expect(trail.querySelector("h2")?.textContent).toBe("Files");
    act(() => trail.querySelector<HTMLButtonElement>(".stage-tile-trail-back")!.click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(head("files"));
  });

  it("closes when the backdrop is clicked, but not when the modal is", () => {
    mount();
    act(() => head("files").click());
    act(() => dialog()!.querySelector<HTMLElement>(".stage-tile-modal")!.click());
    expect(dialog()).not.toBeNull();
    act(() => dialog()!.click());
    expect(dialog()).toBeNull();
  });

  it("shows a tile's extra views as tabs full-screen, moving with the arrow keys", () => {
    mount();
    act(() => head("architecture").click());
    const tabs = [...dialog()!.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    expect(tabs.map((t) => t.textContent)).toHaveLength(2);
    act(() => tabs[1]!.click());
    expect(dialog()!.querySelector(".view-routes")).not.toBeNull();
    act(() => { tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); });
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("leaves room for the open detail panel when full-screen", () => {
    mount({ besideDetail: true });
    act(() => head("files").click());
    expect(dialog()!.className).toContain("stage-tile-fullscreen--beside-detail");
  });

  it("takes the whole page when no detail is open", () => {
    mount();
    act(() => head("files").click());
    expect(dialog()!.className).not.toContain("--beside-detail");
  });
});
