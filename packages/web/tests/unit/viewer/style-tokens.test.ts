/**
 * Design tokens referenced by the viewer's stylesheets actually exist.
 *
 * A `var(--x)` naming a property nothing defines does not fail loudly — the
 * declaration is simply dropped and the element inherits, so a monospace
 * panel quietly renders in the body sans stack and a bordered card quietly
 * loses its border. Nothing in a build or a type check catches it.
 *
 * The viewer carries a backlog of these (see the allowlist below). This test
 * does not fix that backlog; it stops it growing, and pins the three tokens
 * that were repaired — `--mono`, `--line` and `--panel2`, which were
 * referenced without a fallback and defined nowhere at all.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES_DIR = join(import.meta.dirname, "../../../src/viewer/styles");

/**
 * Undefined properties that predate this test.
 *
 * Every one is a real defect — `llm-provider.css` in particular is written
 * against a `--color-*` / `--spacing-*` scheme the project never adopted, so
 * most of its declarations do nothing. They are listed rather than fixed
 * because repairing them means choosing replacement values, which is a
 * visual change and wants a designer's eye, not a merge.
 */
const KNOWN_UNDEFINED = new Set([
  "--accent-bright", "--bg-deep", "--bg-inset", "--bg-raised", "--blue", "--border-light",
  "--color-accent", "--color-border", "--color-surface", "--color-surface-hover",
  "--color-text-primary", "--color-text-secondary",
  "--radius", "--space-0-5", "--spacing-lg", "--spacing-md", "--spacing-sm",
  "--spacing-xl", "--spacing-xs", "--text-dim-2", "--text-primary",
  "--text-secondary", "--yellow",
  // Set inline per-element from analysis data rather than in a stylesheet.
  "--zone-color",
]);

/** Tokens that were repaired and must not come back. */
const REPAIRED = ["--mono", "--line", "--panel2"];

function stylesheets(): Array<{ file: string; css: string }> {
  return readdirSync(STYLES_DIR)
    .filter((f) => f.endsWith(".css"))
    .map((file) => ({ file, css: readFileSync(join(STYLES_DIR, file), "utf8") }));
}

function definedProperties(sheets: ReturnType<typeof stylesheets>): Set<string> {
  const defined = new Set<string>();
  for (const { css } of sheets) {
    for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) defined.add(m[1]);
  }
  return defined;
}

/** Every `var(--x)` with no fallback — the uses that silently vanish. */
function unguardedUses(sheets: ReturnType<typeof stylesheets>): Array<{ file: string; name: string }> {
  const uses: Array<{ file: string; name: string }> = [];
  for (const { file, css } of sheets) {
    for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)) {
      uses.push({ file, name: m[1] });
    }
  }
  return uses;
}

describe("viewer design tokens", () => {
  it("defines every token used without a fallback, except a known backlog", () => {
    const sheets = stylesheets();
    const defined = definedProperties(sheets);

    const missing = unguardedUses(sheets)
      .filter(({ name }) => !defined.has(name) && !KNOWN_UNDEFINED.has(name))
      .map(({ file, name }) => `${file}: var(${name})`);

    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it("does not reintroduce the tokens that were defined nowhere", () => {
    const offenders = stylesheets()
      .filter(({ css }) => REPAIRED.some((t) => css.includes(`var(${t})`)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("defines the monospace stack the panels ask for", () => {
    const defined = definedProperties(stylesheets());
    expect(defined.has("--font-mono")).toBe(true);
  });

  it("keeps the backlog honest — every allowlisted token is still undefined", () => {
    // An entry that has since been defined is stale and should be removed, or
    // the allowlist silently grants permission to break it again.
    const defined = definedProperties(stylesheets());
    const stale = [...KNOWN_UNDEFINED].filter((t) => defined.has(t)).sort();
    expect(stale).toEqual([]);
  });
});
