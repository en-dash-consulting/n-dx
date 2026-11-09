/**
 * Plan's area map: the "N open" badge (.pam-open, absolutely positioned at a
 * block's top right) must not cover the block's label, and a label such as
 * "Testing & Documentation" wraps between words, never inside one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/product.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every top-level rule whose selector list contains `selector` exactly. */
function declarations(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out.join("\n");
}

describe("area map badge and label", () => {
  it("the badge stays out of the label's space", () => {
    expect(declarations(".pam-open")).toMatch(/position:\s*absolute/);
    // Both badge placements (inside the block, and a button beside it in .pam-cell) reserve a top strip.
    for (const selector of [".pam-block:has(> .pam-open)", ".pam-cell > .pam-block"]) {
      expect(declarations(selector), selector).toMatch(/padding-top:\s*calc\([^;]*1lh/);
    }
  });

  it("the label never breaks mid-word", () => {
    const d = declarations(".pam-label");
    expect(d).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(d).not.toMatch(/word-break:\s*break-(all|word)/);
  });

  it.each([".pam-block", ".pam-cell"])("%s is at least as wide as its longest word, within the row", (selector) => {
    const d = declarations(selector);
    expect(d).toMatch(/min-width:\s*auto/);
    expect(d).toMatch(/max-width:\s*100%/);
  });
});
