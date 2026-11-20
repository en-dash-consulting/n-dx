/**
 * The placement panel's search box and Touches/Amends choice wear the
 * dashboard's styles rather than the browser's: the search input (and the
 * amendment fields that share its rule) take the text-input style of
 * `.filter-input`, and each relation option is a bordered choice toned when
 * checked, with a focus ring on the option. Every colour is a theme token, so
 * light and dark both follow. The radios stay native, so the keyboard works
 * as it did (change-placement.test.ts and inbox-triage.test.ts drive them).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) =>
  readFileSync(join(import.meta.dirname, "../../../src/viewer/styles", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const prdTree = read("prd-tree.css");
const forms = read("forms.css");

/** Declarations of every rule whose selector list contains `selector` exactly. */
function declarations(css: string, selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out.join("\n");
}

const value = (decls: string, prop: string) => new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`).exec(decls)?.[1]?.trim();

describe("placement search box", () => {
  it.each([".cp-search-input", ".cp-input"])("%s takes the dashboard's text-input style", (selector) => {
    const mine = declarations(prdTree, selector);
    const input = declarations(forms, ".filter-input");
    for (const prop of ["padding", "background", "border", "border-radius", "color"]) {
      expect(value(mine, prop), prop).toBe(value(input, prop));
    }
  });

  it("shows a visible focus ring in the accent colour", () => {
    expect(value(declarations(prdTree, ".cp-search-input:focus-visible"), "outline")).toBe("2px solid var(--accent)");
  });
});

describe("Touches / Amends choice", () => {
  it("draws each option as a bordered choice on the surface", () => {
    const option = declarations(prdTree, ".cp-relation-option");
    expect(value(option, "border")).toBe("1px solid var(--border)");
    expect(value(option, "background")).toBe("var(--bg-surface)");
    expect(value(option, "cursor")).toBe("pointer");
  });

  it("tones the checked option and rings the focused one", () => {
    const checked = declarations(prdTree, ".cp-relation-option:has(input:checked)");
    expect(value(checked, "border-color")).toBe("var(--accent)");
    expect(value(checked, "background")).toMatch(/color-mix\(in srgb, var\(--accent\) \d+%, var\(--bg-surface\)\)/);
    expect(value(declarations(prdTree, ".cp-relation-option:has(input:focus-visible)"), "outline")).toBe("2px solid var(--accent)");
  });

  it("keeps the radio native, tinted with the accent", () => {
    const radio = declarations(prdTree, '.cp-relation-option input[type="radio"]');
    expect(value(radio, "accent-color")).toBe("var(--accent)");
    expect(radio).not.toMatch(/appearance:\s*none|display:\s*none/);
  });

  it("uses theme tokens only, so dark mode follows", () => {
    for (const selector of [".cp-search-input", ".cp-relation-option", ".cp-relation-option:has(input:checked)"]) {
      expect(declarations(prdTree, selector)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
  });
});
