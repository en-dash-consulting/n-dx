// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";

import { GRAMMAR_BUILD_DIR } from "../../../scripts/build-grammars.mjs";

// Under jsdom the global URL is not Node's, so fileURLToPath(new URL(...))
// throws. The library must still load and resolve its asset paths.
describe("language packs under jsdom", () => {
  it("imports the pack loader and the Java pack", async () => {
    const { BUILTIN_PACKS } = await import("../../../src/language/pack.js");
    const { javaPack } = await import("../../../src/language/java-pack.js");
    expect(BUILTIN_PACKS).toContain(javaPack);
  });

  it("resolves the grammar directory", async () => {
    const { grammarBuildDir } = await import("../../../src/language/package-paths.js");
    expect(grammarBuildDir()).toBe(GRAMMAR_BUILD_DIR);
  });

  it("resolves query paths to existing files", async () => {
    const { javaPack } = await import("../../../src/language/java-pack.js");
    expect(javaPack.queries.length).toBeGreaterThan(0);
    for (const q of javaPack.queries) {
      expect(isAbsolute(q.path)).toBe(true);
      expect(existsSync(q.path), q.path).toBe(true);
    }
  });
});
