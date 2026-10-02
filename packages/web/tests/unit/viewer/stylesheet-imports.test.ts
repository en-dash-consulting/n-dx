/**
 * Every stylesheet under `src/viewer/styles/` reaches the bundle.
 *
 * The viewer's CSS enters through one entry, `styles/index.css`, which
 * `@import`s each sheet. A sheet missing from that list ships nothing, and
 * the components that rely on it fall back to bare browser defaults. This
 * happened to `analysis.css`: its import was removed with the Analysis tab,
 * and when the Plan stage brought the view back its tab bar rendered as
 * unstyled native buttons.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STYLES_DIR = join(import.meta.dirname, "../../../src/viewer/styles");

describe("viewer stylesheet imports", () => {
  it("styles/index.css imports every other stylesheet in the directory", () => {
    const index = readFileSync(join(STYLES_DIR, "index.css"), "utf-8");
    const imported = new Set(
      [...index.matchAll(/@import\s+["']\.\/([^"']+)["']/g)].map((m) => m[1]),
    );
    const sheets = readdirSync(STYLES_DIR).filter((f) => f.endsWith(".css") && f !== "index.css");

    expect(sheets.filter((f) => !imported.has(f))).toEqual([]);
  });
});
