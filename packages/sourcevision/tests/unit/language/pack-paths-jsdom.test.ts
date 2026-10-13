// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";

// Under jsdom the global URL is not Node's, so fileURLToPath(new URL(...))
// throws. The library must still load, find its packs and resolve their asset
// paths.
describe("language packs under jsdom", () => {
  it("loads the Java pack through the pack loader", async () => {
    const { KNOWN_PACKS, loadPack } = await import("../../../src/language/pack-loader.js");
    const load = await loadPack(KNOWN_PACKS.find((p) => p.id === "java")!);
    expect(load.status).toBe("loaded");
  });

  it("resolves sourcevision's version", async () => {
    const { sourcevisionVersion } = await import("../../../src/language/package-paths.js");
    expect(sourcevisionVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("resolves the Java pack's query paths to existing files", async () => {
    const { javaPack } = await import("@n-dx/lang-java");
    expect(javaPack.queries.length).toBeGreaterThan(0);
    for (const q of javaPack.queries) {
      expect(isAbsolute(q.path)).toBe(true);
      expect(existsSync(q.path), q.path).toBe(true);
    }
  });
});
