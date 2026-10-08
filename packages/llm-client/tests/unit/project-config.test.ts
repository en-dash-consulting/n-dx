import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deepMerge,
  loadProjectOverrides,
  loadProjectOverrideSources,
  LOCAL_CONFIG_FILE,
  PROJECT_CONFIG_FILE,
  mergeWithOverrides,
} from "../../src/project-config.js";

describe("deepMerge", () => {
  it("merges flat objects", () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("deep-merges nested objects", () => {
    const result = deepMerge(
      { nested: { a: 1, b: 2 } },
      { nested: { b: 3 } },
    );
    expect(result).toEqual({ nested: { a: 1, b: 3 } });
  });

  it("replaces arrays instead of concatenating", () => {
    const result = deepMerge(
      { arr: [1, 2, 3] },
      { arr: [4, 5] },
    );
    expect(result).toEqual({ arr: [4, 5] });
  });

  it("source values take precedence", () => {
    const result = deepMerge({ key: "old" }, { key: "new" });
    expect(result).toEqual({ key: "new" });
  });

  it("handles null values in source", () => {
    const result = deepMerge({ key: { nested: true } }, { key: null as unknown as Record<string, unknown> });
    expect(result).toEqual({ key: null });
  });
});

describe("loadProjectOverrides", () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claude-client-pc-"));
    configDir = join(tmpDir, ".rex");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when .n-dx.json does not exist", async () => {
    const result = await loadProjectOverrides(configDir, "rex");
    expect(result).toEqual({});
  });

  it("returns package-scoped section", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ rex: { model: "opus" } }),
    );
    const result = await loadProjectOverrides(configDir, "rex");
    expect(result).toEqual({ model: "opus" });
  });

  it("returns empty object when package key is missing", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ hench: { maxTurns: 5 } }),
    );
    const result = await loadProjectOverrides(configDir, "rex");
    expect(result).toEqual({});
  });

  it("returns empty object for invalid JSON", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), "not json");
    const result = await loadProjectOverrides(configDir, "rex");
    expect(result).toEqual({});
  });

  it("merges .n-dx.local.json over .n-dx.json (local wins)", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ rex: { model: "sonnet", validate: "pnpm test" } }),
    );
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ rex: { model: "opus" } }),
    );
    const result = await loadProjectOverrides(configDir, "rex");
    expect(result).toEqual({ model: "opus", validate: "pnpm test" });
  });

  it("uses .n-dx.local.json when .n-dx.json does not exist", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ rex: { model: "opus" } }),
    );
    const result = await loadProjectOverrides(configDir, "rex");
    expect(result).toEqual({ model: "opus" });
  });

  it("silently ignores missing .n-dx.local.json", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ rex: { model: "sonnet" } }),
    );
    const result = await loadProjectOverrides(configDir, "rex");
    expect(result).toEqual({ model: "sonnet" });
  });

  it("silently ignores invalid JSON in .n-dx.local.json", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ rex: { model: "sonnet" } }),
    );
    await writeFile(join(tmpDir, ".n-dx.local.json"), "not json");
    const result = await loadProjectOverrides(configDir, "rex");
    expect(result).toEqual({ model: "sonnet" });
  });
});

describe("loadProjectOverrideSources", () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claude-client-pcs-"));
    configDir = join(tmpDir, ".rex");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty array when neither file exists", async () => {
    const result = await loadProjectOverrideSources(configDir, "rex");
    expect(result).toEqual([]);
  });

  it("returns one entry per file that declares the package section", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ rex: { model: "sonnet" } }),
    );
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ rex: { model: "opus" } }),
    );
    const result = await loadProjectOverrideSources(configDir, "rex");
    expect(result).toEqual([
      { file: ".n-dx.json", data: { model: "sonnet" } },
      { file: ".n-dx.local.json", data: { model: "opus" } },
    ]);
  });

  it("omits a file whose package section is absent", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ hench: { maxTurns: 5 } }),
    );
    const result = await loadProjectOverrideSources(configDir, "rex");
    expect(result).toEqual([]);
  });

  it("keeps sections separate rather than merging them", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ rex: { model: "sonnet", validate: "pnpm test" } }),
    );
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ rex: { model: "opus" } }),
    );
    const result = await loadProjectOverrideSources(configDir, "rex");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ file: ".n-dx.json", data: { model: "sonnet", validate: "pnpm test" } });
    expect(result[1]).toEqual({ file: ".n-dx.local.json", data: { model: "opus" } });
  });
});

describe("mergeWithOverrides", () => {
  it("returns config unchanged when overrides are empty", () => {
    const config = { model: "sonnet", maxTurns: 10 };
    const result = mergeWithOverrides(config, {});
    expect(result).toEqual(config);
    // Should be the same reference (no-op fast path)
    expect(result).toBe(config);
  });

  it("merges overrides into config", () => {
    const config = { model: "sonnet", maxTurns: 10 };
    const result = mergeWithOverrides(config, { model: "opus" });
    expect(result).toEqual({ model: "opus", maxTurns: 10 });
  });
});

describe("project overrides on the .ndx/ layout", () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claude-client-pc-ndx-"));
    configDir = join(tmpDir, ".ndx", "rex");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads .ndx/config.json and .ndx/config.local.json and labels each source by its root-relative path", async () => {
    await writeFile(join(tmpDir, ".ndx", "config.json"), JSON.stringify({ rex: { model: "opus" } }));
    await writeFile(join(tmpDir, ".ndx", "config.local.json"), JSON.stringify({ rex: { model: "haiku" } }));
    // Not this project's config on the new layout.
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ rex: { model: "legacy" } }));

    expect(await loadProjectOverrideSources(configDir, "rex")).toEqual([
      { file: ".ndx/config.json", data: { model: "opus" } },
      { file: ".ndx/config.local.json", data: { model: "haiku" } },
    ]);
    expect(await loadProjectOverrides(configDir, "rex")).toEqual({ model: "haiku" });
  });

  it("keeps the legacy names as the exported constants, for labels only", () => {
    expect(PROJECT_CONFIG_FILE).toBe(".n-dx.json");
    expect(LOCAL_CONFIG_FILE).toBe(".n-dx.local.json");
  });
});
