import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTokenUsageConfig } from "../../../src/core/token-store.js";

describe("loadTokenUsageConfig project overrides", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rex-token-store-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeJson(path: string, data: unknown): Promise<void> {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(data));
  }

  const packageConfig = {
    schema: "rex/v1",
    project: "p",
    adapter: "file",
    budget: { tokens: 1000, cost: 5 },
  };

  it("applies rex.budget from .n-dx.json next to the .rex directory", async () => {
    const rexDir = join(root, ".rex");
    await writeJson(join(rexDir, "config.json"), packageConfig);
    await writeJson(join(root, ".n-dx.json"), { rex: { budget: { tokens: 42 } } });

    const config = await loadTokenUsageConfig(rexDir);

    expect(config.budget).toEqual({ tokens: 42, cost: 5 });
  });

  it("applies rex.budget from .ndx/config.json on the .ndx/ layout", async () => {
    const rexDir = join(root, ".ndx", "rex");
    await writeJson(join(rexDir, "config.json"), packageConfig);
    await writeJson(join(root, ".ndx", "config.json"), { rex: { budget: { tokens: 7 } } });

    const config = await loadTokenUsageConfig(rexDir);

    expect(config.budget).toEqual({ tokens: 7, cost: 5 });
  });

  it("returns the package config unchanged when no override file exists", async () => {
    const rexDir = join(root, ".rex");
    await writeJson(join(rexDir, "config.json"), packageConfig);

    const config = await loadTokenUsageConfig(rexDir);

    expect(config.budget).toEqual({ tokens: 1000, cost: 5 });
  });
});
