/**
 * The viewer marks emphasis with a background tone, never a coloured left
 * stripe (src/viewer/styles/STYLE.md).
 *
 * A thick left border on a rounded card curves with the corner and reads as a
 * stray bracket; it also repeats colour the item's badge already carries. The
 * dashboard had one on ~30 kinds of card before this test, so it scans every
 * stylesheet rather than pinning the cards that were fixed.
 *
 * Structural lines stay legal: a 1px divider, a neutral `var(--border)` rail
 * (a tree's indent line) and a dashed ghost-row marker.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES_DIR = join(import.meta.dirname, "../../../src/viewer/styles");

/** A declaration that paints a left stripe, with the value it uses. */
const STRIPE = [
  // border-left / border-inline-start shorthand wider than a hairline.
  /border-(?:left|inline-start)\s*:\s*([2-9]|\d{2,})px\s+(solid|double)\s+([^;}]+)/g,
  // A width set on its own, which a colour elsewhere turns into a stripe.
  /border-(?:left|inline-start)-width\s*:\s*([2-9]|\d{2,})px/g,
  // Colouring only the left edge of an otherwise uniform border.
  /border-(?:left|inline-start)-color\s*:\s*([^;}]+)/g,
  // The inset-shadow spelling of the same stripe.
  /box-shadow\s*:\s*inset\s+([2-9]|\d{2,})px\s+0(?:px)?\s+0(?:px)?/g,
];

/** A stripe in the neutral border token is a structural rail, not emphasis. */
const NEUTRAL = /^var\(--border\)\s*$/;

/** A split button's divider recoloured to its own background. */
const ALLOWED = new Set(["prepare-task.css: border-left-color: var(--bg)"]);

function stripes(): string[] {
  const hits: string[] = [];
  for (const file of readdirSync(STYLES_DIR).filter((f) => f.endsWith(".css"))) {
    const css = readFileSync(join(STYLES_DIR, file), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const re of STRIPE) {
      for (const m of css.matchAll(re)) {
        const colour = (m[3] ?? (re.source.includes("-color") ? m[1] : "")).trim();
        if (colour && NEUTRAL.test(colour)) continue;
        const hit = `${file}: ${m[0].replace(/\s+/g, " ").trim()}`;
        if (!ALLOWED.has(hit)) hits.push(hit);
      }
    }
  }
  return hits;
}

describe("viewer emphasis", () => {
  it("uses a background tone, not a coloured left stripe", () => {
    expect(stripes(), "Tint the background instead — see src/viewer/styles/STYLE.md").toEqual([]);
  });
});
