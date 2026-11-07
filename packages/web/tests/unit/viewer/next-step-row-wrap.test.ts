/**
 * A next-step title holds an unbreakable file path. With `min-width: auto` it
 * cannot shrink below the path, overflows the row and pushes the copy button
 * past the tile edge, where the tile body clips it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/overview.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every rule whose selector list contains `selector` exactly. */
function declarations(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out.join("\n");
}

describe("a next-step row", () => {
  it(".next-step-title shrinks and wraps a long path", () => {
    const d = declarations(".next-step-title");
    expect(d).toMatch(/min-width:\s*0/);
    expect(d).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it.each([".next-step-copy", ".next-step-priority"])("%s keeps its size", (selector) => {
    expect(declarations(selector)).toMatch(/flex-shrink:\s*0/);
  });

  it(".next-step-desc wraps long file lists", () => {
    expect(declarations(".next-step-desc")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
