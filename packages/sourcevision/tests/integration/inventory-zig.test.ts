import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { analyzeInventory } from "../../src/analyzers/inventory.js";

const ZIG_FIXTURE = join(import.meta.dirname, "../fixtures/zig-mixed");

describe("analyzeInventory — zig-mixed fixture (skipped extensions + analysed languages)", () => {
  it("inventories TypeScript/JavaScript/Zig and skips Markdown/TOML/JSON under the default code-only walk", async () => {
    const inv = await analyzeInventory(ZIG_FIXTURE);
    const paths = inv.files.map((f) => f.path).sort();

    expect(paths).toEqual(["native/lib.zig", "src/app.js", "src/index.ts"]);
  });

  it("records skipped extensions with counts for files the walker saw but did not inventory", async () => {
    const inv = await analyzeInventory(ZIG_FIXTURE);

    expect(inv.summary.skippedExtensions).toEqual({
      ".json": 1, // package.json
      ".md": 1, // README.md
      ".toml": 1, // config.toml
    });
  });

  it("marks TypeScript and JavaScript as analysed (import-graph and zone support)", async () => {
    const inv = await analyzeInventory(ZIG_FIXTURE);

    expect(inv.summary.analysedLanguages).toEqual(["JavaScript", "TypeScript"]);
  });

  it("inventories Zig without marking it analysed — no import parser exists for it", async () => {
    const inv = await analyzeInventory(ZIG_FIXTURE);

    expect(inv.summary.byLanguage["Zig"]).toBe(1);
    expect(inv.summary.analysedLanguages).not.toContain("Zig");
  });
});
