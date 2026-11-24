/**
 * Every `btn-*` modifier the viewer puts on a button has a rule. `btn-sm` was
 * used on ~20 compact controls for a long while with no rule behind it, so
 * they all rendered at `.btn`'s full size; this scans the markup so the next
 * unstyled modifier fails here rather than in a screenshot.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const VIEWER = join(import.meta.dirname, "../../../src/viewer");
const STYLES = join(VIEWER, "styles");

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, ext) : path.endsWith(ext) ? [path] : [];
  });
}

/** `btn-*` classes in string literals that also carry `btn` (a class list). */
function modifiersInMarkup(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of files(VIEWER, ".ts")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
      const classes = m[1]!.split(/\s+/);
      if (!classes.includes("btn")) continue;
      for (const c of classes) {
        if (!/^btn-[a-z0-9-]+$/.test(c)) continue;
        used.set(c, [...(used.get(c) ?? []), file.slice(VIEWER.length + 1)]);
      }
    }
  }
  return used;
}

const css = files(STYLES, ".css").map((f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
// Escaped for the template string: `\\.` reaches the regex as `\.` (a dot), where a
// bare `\.` would arrive as `.` and match any character before the class name.
const hasRule = (cls: string) => new RegExp(`\\.${cls}(?![\\w-])[^{}]*\\{`).test(css);

describe("button modifier classes", () => {
  const used = modifiersInMarkup();

  it("finds the small-button class in the markup", () => {
    expect(used.has("btn-sm")).toBe(true);
  });

  it("has a rule for every btn-* class the viewer uses", () => {
    const missing = [...used.keys()].filter((c) => !hasRule(c)).map((c) => `${c} (${used.get(c)!.join(", ")})`);
    expect(missing).toEqual([]);
  });

  it("sizes .btn-sm from the spacing and type tokens", () => {
    const rule = /(?:^|[},])\s*[^{}]*\.btn-sm(?![\w-])[^{}]*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/padding:\s*var\(--space-[\w-]+\)\s+var\(--space-[\w-]+\)/);
    expect(rule).toMatch(/font-size:\s*var\(--font-sm\)/);
  });
});
