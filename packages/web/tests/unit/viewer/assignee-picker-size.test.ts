/**
 * The assignee picker in the change detail panel: the field takes the whole
 * row, so a "Name <email>" value reads in full in the ~280px panel, and its
 * Save, Unassign and Cancel buttons take the panel's small edit-button size
 * (.task-edit-save) rather than .btn's full size. Flex wrapping with a
 * zero minimum keeps phone width free of a sideways scroll.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) =>
  readFileSync(join(import.meta.dirname, "../../../src/viewer/styles", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const assignee = read("assignee.css");
const prdTree = read("prd-tree.css");

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

describe("detail panel assignee field", () => {
  it("lets the input take the remaining row width and shrink below its default minimum", () => {
    const input = declarations(assignee, ".task-assignee-section .assignee-input");
    expect(value(input, "flex")).toBe("1 1 100%");
    expect(value(input, "min-width")).toBe("0");
    for (const sel of [".task-assignee-section .assignee-picker", ".task-assignee-section .assignee-form"]) {
      const decls = declarations(assignee, sel);
      expect(value(decls, "display")).toBe("flex");
      expect(value(decls, "width")).toBe("100%");
    }
  });

  it("wraps the form, and never lets the input outgrow its row", () => {
    expect(value(declarations(assignee, ".assignee-form"), "flex-wrap")).toBe("wrap");
    expect(value(declarations(assignee, ".assignee-input"), "max-width")).toBe("100%");
  });

  it("sizes Save, Unassign and Cancel like the panel's other edit buttons", () => {
    const small = declarations(prdTree, ".task-edit-save");
    const buttons = declarations(assignee, ".assignee-form .btn");
    for (const prop of ["padding", "font-size", "border-radius"]) {
      expect(value(buttons, prop), prop).toBe(value(small, prop));
    }
  });
});
