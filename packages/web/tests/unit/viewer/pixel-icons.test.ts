// @vitest-environment jsdom
/** Pixel-art icon maps and the PixelIcon SVG renderer. */
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PixelIcon as BarrelPixelIcon } from "../../../src/viewer/components/index.js";
import {
  PixelIcon,
  PIXEL_TILES as TILES,
  PIXEL_GLYPHS as GLYPHS,
  type PixelIconName,
  type PixelTileName,
} from "../../../src/viewer/components/pixel-icons.js";

const TILE_NAMES: PixelTileName[] = ["robot-wrangler", "project", "workflow", "commands"];
const GLYPH_NAMES: PixelIconName[] = [...TILE_NAMES, "settings"];

let root: HTMLDivElement;

function mount(vnode: ReturnType<typeof h>): SVGSVGElement {
  root = document.createElement("div");
  document.body.appendChild(root);
  act(() => { render(vnode, root); });
  return root.querySelector("svg")!;
}

afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
});

describe("pixel maps", () => {
  it("exports PixelIcon through the components barrel", () => {
    expect(BarrelPixelIcon).toBe(PixelIcon);
  });

  it.each(TILE_NAMES)("tile %s is 22×22 of palette characters", (name) => {
    const map = TILES[name];
    expect(map).toHaveLength(22);
    for (const row of map) expect(row).toMatch(/^[.PTGWNK]{22}$/);
  });

  it.each(GLYPH_NAMES)("glyph %s is 11×11 of palette characters", (name) => {
    const map = GLYPHS[name];
    expect(map).toHaveLength(11);
    for (const row of map) expect(row).toMatch(/^[.PTGWNK]{11}$/);
  });

  it("has a tile for the four pages only", () => {
    expect(Object.keys(TILES).sort()).toEqual([...TILE_NAMES].sort());
    expect(Object.keys(GLYPHS).sort()).toEqual([...GLYPH_NAMES].sort());
  });
});

describe("PixelIcon", () => {
  it("renders one decorative, crisp svg sized to its grid", () => {
    const svg = mount(h(PixelIcon, { name: "project", variant: "tile", size: 44, class: "x" }));
    expect(root.querySelectorAll("svg")).toHaveLength(1);
    expect(svg.getAttribute("viewBox")).toBe("0 0 22 22");
    expect(svg.getAttribute("width")).toBe("44");
    expect(svg.getAttribute("height")).toBe("44");
    expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("class")).toBe("x");
  });

  it("draws a tile as navy background, art, then teal ground line", () => {
    const svg = mount(h(PixelIcon, { name: "workflow", variant: "tile" }));
    const rects = [...svg.querySelectorAll("rect")];
    expect(rects[0].getAttribute("fill")).toBe("#001769");
    expect(rects[0].getAttribute("width")).toBe("22");
    expect(rects[0].getAttribute("height")).toBe("22");
    const last = rects[rects.length - 1];
    expect(last.getAttribute("x")).toBe("2");
    expect(last.getAttribute("y")).toBe("19");
    expect(last.getAttribute("width")).toBe("20");
    expect(last.getAttribute("height")).toBe("1");
    expect(last.getAttribute("fill")).toBe("#00E5B9");
  });

  it("draws a glyph with neither background nor ground line", () => {
    const svg = mount(h(PixelIcon, { name: "settings", variant: "glyph" }));
    expect(svg.getAttribute("viewBox")).toBe("0 0 11 11");
    for (const r of svg.querySelectorAll("rect")) {
      expect(r.getAttribute("height")).toBe("1");
      expect(r.getAttribute("width")).not.toBe("11");
      expect(r.getAttribute("fill")).toBe("var(--pixel-steel)");
    }
  });

  it("colours glyphs from --pixel-* properties and tiles from literals", () => {
    const glyph = mount(h(PixelIcon, { name: "robot-wrangler", variant: "glyph" }));
    for (const r of glyph.querySelectorAll("rect")) expect(r.getAttribute("fill")).toMatch(/^var\(--pixel-/);
    render(null, root);
    const tile = mount(h(PixelIcon, { name: "robot-wrangler", variant: "tile" }));
    for (const r of tile.querySelectorAll("rect")) expect(r.getAttribute("fill")).toMatch(/^#/);
  });

  it("merges same-colour horizontal runs", () => {
    const svg = mount(h(PixelIcon, { name: "robot-wrangler", variant: "tile" }));
    expect(svg.querySelectorAll("rect").length).toBeLessThan(120);
    // Row 11 of the map is one steel run of 10 pixels.
    const run = [...svg.querySelectorAll("rect")].find(
      (r) => r.getAttribute("y") === "11" && r.getAttribute("fill") === "#c8c6d6",
    )!;
    expect(run.getAttribute("x")).toBe("6");
    expect(run.getAttribute("width")).toBe("10");
  });
});

describe("--pixel-* tokens", () => {
  const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/tokens.css"), "utf8");
  const block = (theme: string) =>
    css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`))![1];

  it.each(["dark", "light"])("defines every colour in the %s theme", (theme) => {
    for (const t of ["purple", "teal", "steel", "white", "navy", "screen"]) {
      expect(block(theme)).toMatch(new RegExp(`--pixel-${t}:\\s*#[0-9a-fA-F]{6}`));
    }
  });
});
