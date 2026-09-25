import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig, loadConfig, saveConfig } from "../../../src/store/config.js";
import { DEFAULT_HENCH_CONFIG, DEFAULT_RETRY_CONFIG } from "../../../src/schema/v1.js";

describe("loadConfig", () => {
  let tmpDir: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-loadcfg-"));
    henchDir = join(tmpDir, ".hench");
    await initConfig(henchDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeConfig(mutate: (config: Record<string, unknown>) => void): Promise<void> {
    const config = DEFAULT_HENCH_CONFIG() as unknown as Record<string, unknown>;
    mutate(config);
    await writeFile(join(henchDir, "config.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
  }

  it("loads a valid config", async () => {
    const config = await loadConfig(henchDir);
    expect(config.model).toBe("sonnet");
    expect(config.retry).toEqual({ ...DEFAULT_RETRY_CONFIG });
  });

  it("throws on an invalid field by default, naming the field", async () => {
    await writeConfig((c) => { c.maxTurns = -1; });
    await expect(loadConfig(henchDir)).rejects.toThrow(/Invalid hench config.*maxTurns/s);
  });

  describe("onInvalid: 'use-defaults'", () => {
    it("replaces an invalid field with its default and warns instead of throwing", async () => {
      await writeConfig((c) => { c.maxTurns = -1; });
      const warnings: string[] = [];
      const config = await loadConfig(henchDir, {
        onInvalid: "use-defaults",
        onWarning: (message) => warnings.push(message),
      });
      expect(config.maxTurns).toBe(DEFAULT_HENCH_CONFIG().maxTurns);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("using defaults for maxTurns");
    });

    it("replaces an invalid retry group and keeps every valid field", async () => {
      await writeConfig((c) => {
        c.model = "opus";
        c.retry = { maxRetries: "three" };
      });
      const warnings: string[] = [];
      const config = await loadConfig(henchDir, {
        onInvalid: "use-defaults",
        onWarning: (message) => warnings.push(message),
      });
      expect(config.model).toBe("opus");
      expect(config.retry).toEqual({ ...DEFAULT_RETRY_CONFIG });
      expect(warnings[0]).toContain("retry");
    });

    it("drops an invalid optional field the defaults do not carry", async () => {
      await writeConfig((c) => { c.permissionMode = "yolo"; });
      const warnings: string[] = [];
      const config = await loadConfig(henchDir, {
        onInvalid: "use-defaults",
        onWarning: (message) => warnings.push(message),
      });
      expect(config.permissionMode).toBeUndefined();
      expect(warnings[0]).toContain("permissionMode");
    });

    it("does not warn when the config is valid", async () => {
      const warnings: string[] = [];
      const config = await loadConfig(henchDir, {
        onInvalid: "use-defaults",
        onWarning: (message) => warnings.push(message),
      });
      expect(config.model).toBe("sonnet");
      expect(warnings).toHaveLength(0);
    });

    it("still throws on JSON syntax errors", async () => {
      await writeFile(join(henchDir, "config.json"), "{ not json", "utf-8");
      await expect(
        loadConfig(henchDir, { onInvalid: "use-defaults" }),
      ).rejects.toThrow();
    });

    it("still throws when the document is not an object", async () => {
      await writeFile(join(henchDir, "config.json"), "[1, 2, 3]\n", "utf-8");
      await expect(
        loadConfig(henchDir, { onInvalid: "use-defaults" }),
      ).rejects.toThrow(/Invalid hench config/);
    });
  });

  it("saveConfig round-trips what loadConfig reads", async () => {
    const config = await loadConfig(henchDir);
    config.maxTurns = 75;
    await saveConfig(henchDir, config);
    const reloaded = await loadConfig(henchDir);
    expect(reloaded.maxTurns).toBe(75);
  });
});
