import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const VIEWER_DIR = join(import.meta.dirname!, "..", "..", "..", "src", "viewer");
const LOADER_DIR = join(VIEWER_DIR, "loader");

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.ts$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe("viewer-data-loader boundaries", () => {
  it("keeps progressive tree loading in prd-tree instead of views/", () => {
    const staleImports = collectTsFiles(VIEWER_DIR).filter((file) =>
      readFileSync(file, "utf-8").includes("views/progressive-loader")
    );

    expect(staleImports).toEqual([]);
    expect(
      readFileSync(join(VIEWER_DIR, "components", "prd-tree", "progressive-loader.ts"), "utf-8"),
    ).toContain("Progressive tree loading for large PRD datasets");
  });

  it("keeps loader schema helpers inside the loader zone", () => {
    expect(existsSync(join(VIEWER_DIR, "validate.ts"))).toBe(false);

    expect(readFileSync(join(LOADER_DIR, "data-loader.ts"), "utf-8")).toContain(
      'from "./schema/index.js"',
    );
    expect(readFileSync(join(LOADER_DIR, "schema", "index.ts"), "utf-8")).toContain(
      'from "./validate.js"',
    );
    expect(readFileSync(join(LOADER_DIR, "schema", "index.ts"), "utf-8")).toContain(
      'from "./compat.js"',
    );
  });
});
