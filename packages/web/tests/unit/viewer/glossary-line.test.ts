// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { GlossaryLine } from "../../../src/viewer/components/glossary-line.js";
import { getGlossaryDefinition } from "../../../src/viewer/components/glossary-terms.js";

describe("GlossaryLine", () => {
  let root: HTMLDivElement;

  function renderLine(term: string) {
    root = document.createElement("div");
    document.body.appendChild(root);
    act(() => {
      render(h(GlossaryLine, { term }), root);
    });
  }

  it("renders the glossary definition for a known term", () => {
    renderLine("zone");
    expect(root.textContent).toBe(getGlossaryDefinition("zone"));
    expect(root.querySelector(".glossary-line")).not.toBeNull();
  });

  it("renders nothing for a term the glossary does not define", () => {
    renderLine("not-a-real-term");
    expect(root.textContent).toBe("");
    expect(root.querySelector(".glossary-line")).toBeNull();
  });
});

/**
 * The class the component renders has to exist in a bundled stylesheet.
 *
 * A class with no rule does not fail loudly — the element renders, inheriting
 * whatever its parent set. That is not cosmetic here: `GlossaryLine` is
 * rendered inside a `.data-table th` on the Files page, and `.data-table th`
 * sets `text-transform: uppercase`, `letter-spacing` and an 11px header size.
 * Without its own rule the definition inherits all three and a whole sentence
 * renders shouting in the table header, stretching the column with it.
 * `style-tokens.test.ts` checks that `var(--x)` properties resolve; nothing
 * checked that a component's class resolves to anything at all.
 */
describe("[a11y] glossary-line styling", () => {
  const STYLES_DIR = join(import.meta.dirname!, "..", "..", "..", "src", "viewer", "styles");

  function allCss(): string {
    return readdirSync(STYLES_DIR)
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(join(STYLES_DIR, f), "utf8"))
      .join("\n");
  }

  it("defines a .glossary-line rule", () => {
    expect(allCss()).toMatch(/^\s*\.glossary-line\s*\{/m);
  });

  it("neutralises the header casing it would otherwise inherit in a table head", () => {
    const rule = allCss().match(/^\s*\.glossary-line\s*\{([^}]*)\}/m)?.[1] ?? "";
    expect(rule).toMatch(/text-transform:\s*none/);
    expect(rule).toMatch(/letter-spacing:\s*normal/);
    // Otherwise a 100-character sentence sets the Archetype column's width.
    expect(rule).toMatch(/max-width:/);
  });
});
