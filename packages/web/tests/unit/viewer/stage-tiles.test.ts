// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TileGrid } from "../../../src/viewer/views/stage-tiles.js";
import type { StageTile } from "../../../src/viewer/views/stages.js";
import type { ViewId } from "../../../src/viewer/types.js";

const TILES: StageTile[] = [
  { view: "iso-map", size: "hero" },
  { view: "problems" },
  { view: "files" },
  { view: "architecture", tabs: [{ view: "routes" }] },
];

let root: HTMLElement;
const navigateTo = vi.fn();

function mount(extra: Partial<Parameters<typeof TileGrid>[0]> = {}) {
  act(() => {
    render(h(TileGrid, {
      stage: "analyze",
      tiles: TILES,
      tabsOf: (t) => [{ view: t.view }, ...(t.tabs ?? [])],
      navigateTo,
      renderView: (v: ViewId) => h("div", { class: `view view-${v}` }, `view:${v}`),
      renderPanel: () => null,
      renderSummary: (t) => (t.view === "problems" ? h("p", { class: "summary" }, "5 critical") : null),
      ...extra,
    }), root);
  });
}

const tile = (key: string) => root.querySelector<HTMLElement>(`[data-tile="${key}"]`)!;
const toggle = (key: string) => tile(key).querySelector<HTMLButtonElement>(".stage-tile-toggle")!;

beforeEach(() => {
  localStorage.clear();
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.restoreAllMocks();
});

describe("TileGrid", () => {
  it("lays tiles out by size and shows a summary where one exists, else the view", () => {
    mount();
    expect(tile("iso-map").className).toContain("stage-tile--hero");
    expect(tile("problems").className).toContain("stage-tile--normal");
    expect(tile("problems").querySelector(".summary")?.textContent).toBe("5 critical");
    expect(tile("problems").querySelector(".view")).toBeNull();
    expect(tile("files").querySelector(".view-files")).not.toBeNull();
    expect(tile("files").querySelector(".stage-tile-body--clip")).not.toBeNull();
    // The hero tile is never clipped.
    expect(tile("iso-map").querySelector(".stage-tile-body--clip")).toBeNull();
  });

  it("expands a tile in place to the full row showing the real view, and collapses it again", () => {
    mount();
    act(() => toggle("problems").click());
    expect(toggle("problems").getAttribute("aria-expanded")).toBe("true");
    expect(tile("problems").className).toContain("stage-tile--expanded");
    expect(tile("problems").querySelector(".view-problems")).not.toBeNull();
    expect(tile("problems").querySelector(".summary")).toBeNull();

    act(() => toggle("problems").click());
    expect(tile("problems").className).toContain("stage-tile--normal");
    expect(tile("problems").querySelector(".summary")).not.toBeNull();
  });

  it("shows an expanded tile's extra views as tabs", () => {
    mount();
    act(() => toggle("architecture").click());
    const tabs = tile("architecture").querySelectorAll<HTMLButtonElement>("[role=tab]");
    expect([...tabs].map((t) => t.textContent)).toHaveLength(2);
    act(() => tabs[1]!.click());
    expect(tile("architecture").querySelector(".view-routes")).not.toBeNull();
  });

  it("remembers expanded tiles per stage across mounts", () => {
    mount();
    act(() => toggle("files").click());
    render(null, root);
    mount();
    expect(toggle("files").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("problems").getAttribute("aria-expanded")).toBe("false");
  });

  it("still works when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    mount();
    act(() => toggle("files").click());
    expect(toggle("files").getAttribute("aria-expanded")).toBe("true");
  });

  it("opens a tile full-screen, closes it with Esc, and returns focus to the opener", () => {
    mount();
    const opener = tile("problems").querySelector<HTMLButtonElement>('[aria-label="Open Problems full-screen"]')
      ?? tile("problems").querySelector<HTMLButtonElement>(".stage-tile-icon-btn")!;
    opener.focus();
    act(() => opener.click());
    const dialog = root.querySelector<HTMLElement>(".stage-tile-fullscreen")!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.querySelector(".view-problems")).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toContain("Close full-screen");

    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(root.querySelector(".stage-tile-fullscreen")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves room for the open detail panel when full-screen", () => {
    mount({ besideDetail: true });
    act(() => tile("files").querySelector<HTMLButtonElement>(".stage-tile-icon-btn")!.click());
    expect(root.querySelector(".stage-tile-fullscreen")!.className).toContain("stage-tile-fullscreen--beside-detail");
  });

  it("takes the whole page when no detail is open", () => {
    mount();
    act(() => tile("files").querySelector<HTMLButtonElement>(".stage-tile-icon-btn")!.click());
    expect(root.querySelector(".stage-tile-fullscreen")!.className).not.toContain("--beside-detail");
  });

  it("navigates to the view's own page from Open", () => {
    mount();
    const open = [...tile("files").querySelectorAll<HTMLButtonElement>(".stage-tile-btn")].find((b) => b.textContent === "Open ↗")!;
    act(() => open.click());
    expect(navigateTo).toHaveBeenCalledWith("files");
  });
});
