/**
 * Placement candidates and relation labels set their own text size. Without
 * it they inherit the browser's 16px and run several lines tall in the
 * 280px detail panel. The same classes render in the change detail panel, on
 * the Inbox page and in the capture Preview card (which has no `.cp-section`
 * around it), so `.cp-target` and `.cp-relation` carry the size themselves.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "../../../src/viewer/styles/prd-tree.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every rule whose selector list contains `selector` exactly. */
function declarations(selector: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out;
}

describe("placement text size", () => {
  it.each([".cp-section", ".cp-form", ".cp-target", ".cp-relation"])(
    "%s sets font-size: var(--font-base)",
    (selector) => {
      expect(declarations(selector).join("\n")).toMatch(/font-size:\s*var\(--font-base\)/);
    },
  );

  it(".cp-target-detail stays at --font-xs", () => {
    expect(declarations(".cp-target-detail").join("\n")).toMatch(/font-size:\s*var\(--font-xs\)/);
  });
});
