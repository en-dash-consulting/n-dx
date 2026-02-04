import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore, ensureRexDir } from "../../src/store/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import type { PRDStore } from "../../src/store/index.js";

describe("project-config merge (rex)", () => {
  let tmpDir: string;
  let rexDir: string;
  let store: PRDStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-projcfg-"));
    rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);
    store = createStore("file", rexDir);

    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({
        schema: SCHEMA_VERSION,
        project: "base-project",
        adapter: "file",
        sourcevision: "auto",
      }),
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads config without .n-dx.json", async () => {
    const config = await store.loadConfig();
    expect(config.project).toBe("base-project");
    expect(config.adapter).toBe("file");
  });

  it("merges .n-dx.json overrides into config", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ rex: { project: "overridden" } }, null, 2) + "\n",
    );

    const config = await store.loadConfig();
    expect(config.project).toBe("overridden");
    // Non-overridden values remain
    expect(config.adapter).toBe("file");
    expect(config.sourcevision).toBe("auto");
  });

  it("adds optional fields from .n-dx.json", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        rex: { validate: "pnpm typecheck", test: "pnpm test" },
      }, null, 2) + "\n",
    );

    const config = await store.loadConfig();
    expect(config.validate).toBe("pnpm typecheck");
    expect(config.test).toBe("pnpm test");
    expect(config.project).toBe("base-project");
  });

  it("ignores invalid .n-dx.json gracefully", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), "not valid json\n");

    const config = await store.loadConfig();
    expect(config.project).toBe("base-project");
  });

  it("ignores .n-dx.json with no rex section", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ hench: { model: "opus" } }, null, 2) + "\n",
    );

    const config = await store.loadConfig();
    expect(config.project).toBe("base-project");
  });
});
