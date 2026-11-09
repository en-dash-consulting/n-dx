/**
 * A workflow suggestion card is narrow (a stage tile's width). Its action row
 * must wrap, or the last button (Dismiss) runs past the card and is clipped by
 * the tile body's overflow: hidden.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/workflow-optimization.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every rule whose selector list contains `selector` exactly. */
function declarations(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out.join("\n");
}

describe("workflow suggestion actions", () => {
  it("wrap so the buttons stay inside the card", () => {
    expect(declarations(".wf-suggestion-actions")).toMatch(/display:\s*flex/);
    expect(declarations(".wf-suggestion-actions")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("keep the link button pushed to the start at full width", () => {
    expect(declarations(".wf-suggestion-actions .link-btn")).toMatch(/margin-right:\s*auto/);
  });
});
