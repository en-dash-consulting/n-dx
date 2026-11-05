/**
 * The machine-diagnostic panels lived only in the Runs page's System status
 * drawer; when that drawer went, they stayed exported and tested but no view
 * mounted them. A panel in this list is either rendered by some view or gone
 * from the components barrel — never both exported and orphaned.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VIEWER_DIR = join(import.meta.dirname!, "..", "..", "..", "src", "viewer");
const VIEWS_DIR = join(VIEWER_DIR, "views");
const BARREL = join(VIEWER_DIR, "components", "index.ts");

const PANELS = ["ConcurrencyPanel", "MemoryPanel", "WsHealthPanel", "ThrottleControlsPanel"];

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? collectTsFiles(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe("diagnostic panels", () => {
  const barrel = readFileSync(BARREL, "utf-8");
  const views = collectTsFiles(VIEWS_DIR).map((file) => readFileSync(file, "utf-8"));

  it.each(PANELS)("%s is rendered by a view if the barrel exports it", (name) => {
    if (!new RegExp(`export \\{[^}]*\\b${name}\\b`).test(barrel)) return;
    const rendered = views.some((src) => new RegExp(`\\bh\\(\\s*${name}\\b`).test(src));
    expect(rendered, `${name} is exported from components/index.ts but no view renders it`).toBe(true);
  });
});
