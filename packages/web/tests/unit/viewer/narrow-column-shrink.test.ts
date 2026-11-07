/**
 * The Sidecar drawer narrows the main column. Tasks rows and the Tune panels
 * must shrink with it rather than draw past its right edge, so the flex
 * children that carry variable content can shrink (`min-width: 0`) and the
 * grid tracks that hold them are `minmax(0, …)`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function load(name: string): string {
  return readFileSync(join(import.meta.dirname, "../../../src/viewer/styles", name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Declarations of every rule whose selector list contains `selector` exactly. */
function declarations(css: string, selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out.join("\n");
}

const prd = load("prd-tree.css");
const tiles = load("stage-tiles.css");

describe("Tasks row in a narrowed column", () => {
  it.each([".prd-node-title", ".prd-tag-list"])("%s can shrink below its content", (sel) => {
    expect(declarations(prd, sel)).toMatch(/min-width:\s*0/);
  });

  it(".prd-node-title shrinks from its content width, not from a 0% basis", () => {
    // flex: 1 (basis 0%) gives the title no width at all once the row is
    // short of space, while the tag list keeps what it needs.
    expect(declarations(prd, ".prd-node-title")).toMatch(/flex:\s*1 1 auto/);
  });

  it(".prd-tag-list shrinks and wraps", () => {
    const d = declarations(prd, ".prd-tag-list");
    expect(d).not.toMatch(/flex-shrink:\s*0/);
    expect(d).toMatch(/flex:\s*0 1 auto/);
    expect(d).toMatch(/flex-wrap:\s*wrap/);
  });

  it(".prd-node-actions keeps its width at the row's right edge", () => {
    const d = declarations(prd, ".prd-node-actions");
    expect(d).toMatch(/margin-left:\s*auto/);
    expect(d).toMatch(/flex-shrink:\s*0/);
  });
});

describe("Tune panels in a narrowed column", () => {
  it.each([".outcomes-panel", ".tooling-panel", ".delivery-panel"])("%s has min-width: 0", (sel) => {
    expect(declarations(tiles, sel)).toMatch(/min-width:\s*0/);
  });

  it.each([".outcomes-rows", ".delivery-dimensions"])("%s tracks are minmax(0, 1fr)", (sel) => {
    expect(declarations(tiles, sel)).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it(".tooling-vendors tracks never exceed the container", () => {
    expect(declarations(tiles, ".tooling-vendors")).toMatch(/minmax\(min\(9rem,\s*100%\),\s*1fr\)/);
  });
});
