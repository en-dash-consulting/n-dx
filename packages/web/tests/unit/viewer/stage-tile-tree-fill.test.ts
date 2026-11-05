/**
 * A tile holding the Tasks tree (Plan's Tree tab, a v1 Tasks tile) gives it a
 * bounded flex column. The tree's virtual scroller sizes itself from its
 * container; in a block container it measures the whole tree and renders
 * every row, so a PRD of a thousand items loses its virtualisation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/stage-tiles.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every rule whose selector list contains `selector` exactly. */
function declarations(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out.join("\n");
}

describe("the Tasks tree in a tile", () => {
  it.each([".stage-tile-body:has(.prd-view)", ".stage-tile-fullscreen-body:has(.prd-view)"])(
    "%s is a flex column",
    (selector) => {
      expect(declarations(selector)).toMatch(/display:\s*flex/);
      expect(declarations(selector)).toMatch(/flex-direction:\s*column/);
    },
  );

  it.each([".stage-tile-content:has(.prd-view)", ".stage-tile-content:has(.prd-view) > div:has(> .prd-view)"])(
    "%s fills its parent with a bounded height",
    (selector) => {
      expect(declarations(selector)).toMatch(/flex:\s*1/);
      expect(declarations(selector)).toMatch(/min-height:\s*0/);
      expect(declarations(selector)).toMatch(/flex-direction:\s*column/);
    },
  );
});
