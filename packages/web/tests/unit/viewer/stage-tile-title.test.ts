/**
 * A tile head lays the title and the "N open" count side by side: the count
 * keeps its size, the title shrinks and wraps between words, never inside one.
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

describe("tile head title and count badge", () => {
  it("the badge does not shrink", () => {
    expect(declarations(".stage-tile-head .stage-section-badge")).toMatch(/flex-shrink:\s*0/);
  });

  it("the title can shrink below its content width", () => {
    expect(declarations(".stage-tile-title")).toMatch(/min-width:\s*0/);
  });

  it("the title never breaks mid-word", () => {
    const d = declarations(".stage-tile-title");
    expect(d).not.toMatch(/overflow-wrap:\s*(anywhere|break-word)/);
    expect(d).not.toMatch(/word-break:\s*(break-all|break-word)/);
    expect(d).toMatch(/overflow-wrap:\s*normal/);
    expect(d).toMatch(/word-break:\s*normal/);
  });
});
