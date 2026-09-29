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

  describe("project-level overrides (.n-dx.json / .n-dx.local.json)", () => {
    async function writeProjectConfig(data: unknown): Promise<void> {
      await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify(data), "utf-8");
    }

    async function writeLocalConfig(data: unknown): Promise<void> {
      await writeFile(join(tmpDir, ".n-dx.local.json"), JSON.stringify(data), "utf-8");
    }

    it("applies a valid override, unchanged", async () => {
      await writeProjectConfig({ hench: { maxTurns: 12 } });
      const config = await loadConfig(henchDir);
      expect(config.maxTurns).toBe(12);
    });

    it("reverts an invalid override to the base value and warns, naming the field and file", async () => {
      await writeProjectConfig({ hench: { maxTurns: -5 } });
      const warnings: string[] = [];
      const config = await loadConfig(henchDir, {
        onWarning: (message) => warnings.push(message),
      });
      expect(config.maxTurns).toBe(DEFAULT_HENCH_CONFIG().maxTurns);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("hench.maxTurns");
      expect(warnings[0]).toContain(".n-dx.json");
    });

    it("does not throw for an invalid override even without onInvalid: 'use-defaults'", async () => {
      await writeProjectConfig({ hench: { maxTurns: -5 } });
      await expect(loadConfig(henchDir)).resolves.toMatchObject({
        maxTurns: DEFAULT_HENCH_CONFIG().maxTurns,
      });
    });

    it("reverts an invalid promptCacheTtl override instead of passing the raw string through", async () => {
      await writeProjectConfig({ hench: { promptCacheTtl: "1hour" } });
      const warnings: string[] = [];
      const config = await loadConfig(henchDir, {
        onWarning: (message) => warnings.push(message),
      });
      expect(config.promptCacheTtl).toBeUndefined();
      expect(warnings[0]).toContain("hench.promptCacheTtl");
    });

    it("keeps every valid override field when only one is invalid", async () => {
      await writeProjectConfig({ hench: { maxTurns: -5, model: "opus" } });
      const config = await loadConfig(henchDir, { onWarning: () => {} });
      expect(config.maxTurns).toBe(DEFAULT_HENCH_CONFIG().maxTurns);
      expect(config.model).toBe("opus");
    });

    it("validates .n-dx.local.json overrides the same way, naming that file", async () => {
      await writeLocalConfig({ hench: { maxTurns: -5 } });
      const warnings: string[] = [];
      const config = await loadConfig(henchDir, {
        onWarning: (message) => warnings.push(message),
      });
      expect(config.maxTurns).toBe(DEFAULT_HENCH_CONFIG().maxTurns);
      expect(warnings[0]).toContain(".n-dx.local.json");
      expect(warnings[0]).not.toContain(".n-dx.json\"");
    });

    it("blames .n-dx.local.json when both files set the same invalid field (local wins)", async () => {
      await writeProjectConfig({ hench: { maxTurns: 20 } });
      await writeLocalConfig({ hench: { maxTurns: -5 } });
      const warnings: string[] = [];
      const config = await loadConfig(henchDir, {
        onWarning: (message) => warnings.push(message),
      });
      expect(config.maxTurns).toBe(DEFAULT_HENCH_CONFIG().maxTurns);
      expect(warnings[0]).toContain(".n-dx.local.json");
    });

    it("does not warn when overrides are absent", async () => {
      const warnings: string[] = [];
      await loadConfig(henchDir, { onWarning: (message) => warnings.push(message) });
      expect(warnings).toHaveLength(0);
    });
  });
});
