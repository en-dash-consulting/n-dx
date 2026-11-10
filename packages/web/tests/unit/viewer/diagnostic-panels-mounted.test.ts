/**
 * An exported panel that no view renders is dead UI: the machine-diagnostic
 * panels stayed exported and tested after the Runs page's System status drawer
 * went, and nothing mounted them. Every `*Panel` the components barrel exports
 * must be rendered by a view or by the app shell (`main.ts`), or be removed
 * from the barrel.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VIEWER_DIR = join(import.meta.dirname!, "..", "..", "..", "src", "viewer");
const VIEWS_DIR = join(VIEWER_DIR, "views");
const BARREL = join(VIEWER_DIR, "components", "index.ts");
const SHELL = join(VIEWER_DIR, "main.ts");

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? collectTsFiles(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/** Names of every `*Panel` re-exported by the barrel (`export { A, B as C } from`). */
function exportedPanels(barrel: string): string[] {
  const names = new Set<string>();
  for (const [, list] of barrel.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const item of list.split(",")) {
      const name = item.trim().split(/\s+as\s+/).pop()!;
      if (/^\w*Panel$/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

describe("exported panels are mounted", () => {
  const panels = exportedPanels(readFileSync(BARREL, "utf-8"));
  const renderers = [...collectTsFiles(VIEWS_DIR), SHELL].map((file) => readFileSync(file, "utf-8"));

  it("the barrel exports panels to check", () => {
    expect(panels.length).toBeGreaterThan(0);
  });

  it.each(panels)("%s is rendered by a view or the shell", (name) => {
    const rendered = renderers.some((src) => new RegExp(`\\bh\\(\\s*${name}\\b`).test(src));
    expect(rendered, `${name} is exported from components/index.ts but no view renders it`).toBe(true);
  });
});
