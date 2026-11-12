// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TileGrid, TRACKS_PER_ROW, fitTracks } from "../../../src/viewer/views/stage-tiles.js";
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

  it("draws a band above the grid, outside its fixed rows, with no header to open it", () => {
    mount({ tiles: [{ view: "changes", panel: "flow", title: "Lifecycle", band: true }, ...TILES] });
    const band = root.querySelector<HTMLElement>(".stage-bands > .stage-band[data-tile='flow']")!;
    expect(band.querySelector(".panel-flow")).not.toBeNull();
    expect(band.querySelector(".stage-tile-head")).toBeNull();
    expect(root.querySelector(".stage-tiles [data-tile='flow']")).toBeNull();
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

  it("opens a tile at a focus from its panel: the trail names it, the tile step drops it, Esc returns", () => {
    mount({
      renderPanel: (p, opened, grid) => opened
        ? h("div", { class: `panel-${p}-opened`, "data-focus": grid.focus?.id ?? "" })
        : h("button", { class: `open-${p}`, onClick: () => grid.openTile(p, { id: "checkout", label: "Checkout" }) }, "Checkout"),
    });
    const opener = tile("map").querySelector<HTMLButtonElement>(".open-map")!;
    opener.focus();
    act(() => opener.click());
    expect(dialog()!.querySelector("[role=dialog]")?.getAttribute("aria-label")).toBe("Checkout");
    const trail = dialog()!.querySelector(".stage-tile-trail")!;
    expect([...trail.querySelectorAll("button, h2")].map((el) => el.textContent)).toEqual(["← Analysis", "Codebase map", "Checkout"]);
    expect(dialog()!.querySelector<HTMLElement>(".panel-map-opened")?.dataset.focus).toBe("checkout");

    // The tile step keeps the modal open, on the tile as a whole.
    act(() => trail.querySelector<HTMLButtonElement>(".stage-tile-trail-tile")!.click());
    expect(dialog()!.querySelector<HTMLElement>(".panel-map-opened")?.dataset.focus).toBe("");
    expect(dialog()!.querySelector("h2")?.textContent).toBe("Codebase map");

    // Closing hands focus back to the block without scrolling the page.
    const focus = vi.spyOn(opener, "focus");
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(dialog()).toBeNull();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
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

  it("offers no Open ↗ without a navigateTo", () => {
    mount();
    act(() => head("files").click());
    expect([...dialog()!.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Open ↗");
  });

  it("opens a tile's own page from Open ↗ in the modal", () => {
    const calls: unknown[][] = [];
    mount({ navigateTo: (...a) => { calls.push(a); } });
    act(() => head("files").click());
    const open = [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Open ↗")!;
    act(() => open.click());
    expect(calls).toEqual([["files"]]);
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

describe("a tile with more than it shows", () => {
  /** Makes every tile body report `content` px of content in a `box` px box. */
  function sizeBodies(content: number, box: number) {
    const proto = HTMLElement.prototype;
    const spies = [
      vi.spyOn(proto, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("stage-tile-body") ? content : 0;
      }),
      vi.spyOn(proto, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("stage-tile-body") ? box : 0;
      }),
    ];
    return () => spies.forEach((s) => s.mockRestore());
  }

  const settle = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });

  it("offers Open to see all over its fade, which opens the tile", async () => {
    const restore = sizeBodies(600, 200);
    try {
      mount();
      await settle();
      const more = tile("files").querySelector<HTMLButtonElement>(".stage-tile-more")!;
      expect(more.textContent).toContain("Open to see all");
      expect(more.getAttribute("aria-label")).toBe("Open Files to see everything");
      act(() => more.click());
      expect(dialog()).not.toBeNull();
    } finally {
      restore();
    }
  });

  it("offers nothing when everything fits", async () => {
    const restore = sizeBodies(150, 200);
    try {
      mount();
      await settle();
      expect(root.querySelector(".stage-tile-more")).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("fitTracks", () => {
  it("spans the 4px tracks a tile's chrome, content and 16px gap need", () => {
    // 46px head and borders + 162px content + 16px gap = 224px = 56 tracks.
    expect(fitTracks(46, 162, TRACKS_PER_ROW)).toBe(56);
    // Rounds up: never clips its own content.
    expect(fitTracks(46, 163, TRACKS_PER_ROW)).toBe(57);
  });

  it("keeps the configured size (null) once content reaches it, and when nothing is measured", () => {
    expect(fitTracks(46, 232 - 46, TRACKS_PER_ROW)).toBeNull();
    expect(fitTracks(46, 5000, TRACKS_PER_ROW * 2)).toBeNull();
    expect(fitTracks(46, 0, TRACKS_PER_ROW)).toBeNull();
  });

  it("one configured row is 232px of tile plus the gap", () => {
    expect(TRACKS_PER_ROW * 4 - 16).toBe(232);
  });

  it("the stylesheet's row spans are TRACKS_PER_ROW per configured row", () => {
    const css = readFileSync(resolve(__dirname, "../../../src/viewer/styles/stage-tiles.css"), "utf-8");
    // The first rule per size is the wide layout's; a narrow-screen override may shrink r3.
    for (const rows of [1, 2, 3]) {
      const span = new RegExp(String.raw`\.stage-tile--r${rows}\s*\{\s*grid-row:\s*span\s+(\d+)`).exec(css);
      expect(Number(span?.[1]), `r${rows}`).toBe(TRACKS_PER_ROW * rows);
    }
  });
});
