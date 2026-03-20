import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { ensureHenchDir, loadConfig, initConfig } from "../../../src/store/config.js";

describe("project-config merge (hench)", () => {
  let tmpDir: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-projcfg-"));
    henchDir = join(tmpDir, ".n-dx/hench");
    await initConfig(henchDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads config without config.json", async () => {
    const config = await loadConfig(henchDir);
    expect(config.model).toBe("sonnet");
    expect(config.maxTurns).toBe(50);
  });

  it("merges config.json overrides into config", async () => {
    await writeFile(
      join(tmpDir, ".n-dx", "config.json"),
      JSON.stringify({ hench: { model: "opus", maxTurns: 200 } }, null, 2) + "\n",
    );

    const config = await loadConfig(henchDir);
    expect(config.model).toBe("opus");
    expect(config.maxTurns).toBe(200);
    // Non-overridden values remain
    expect(config.provider).toBe("cli");
    expect(config.guard.commandTimeout).toBe(30000);
  });

  it("deep merges nested guard overrides", async () => {
    await writeFile(
      join(tmpDir, ".n-dx", "config.json"),
      JSON.stringify({
        hench: { guard: { commandTimeout: 60000 } },
      }, null, 2) + "\n",
    );

    const config = await loadConfig(henchDir);
    expect(config.guard.commandTimeout).toBe(60000);
    // Other guard values preserved
    expect(config.guard.maxFileSize).toBe(1048576);
    expect(config.guard.allowedCommands).toEqual([
      "npm", "npx", "node", "git", "tsc", "vitest",
    ]);
  });

  it("project config overrides array values entirely", async () => {
    await writeFile(
      join(tmpDir, ".n-dx", "config.json"),
      JSON.stringify({
        hench: { guard: { allowedCommands: ["pnpm", "git"] } },
      }, null, 2) + "\n",
    );

    const config = await loadConfig(henchDir);
    expect(config.guard.allowedCommands).toEqual(["pnpm", "git"]);
  });

  it("ignores invalid config.json gracefully", async () => {
    await writeFile(join(tmpDir, ".n-dx", "config.json"), "not valid json\n");

    const config = await loadConfig(henchDir);
    expect(config.model).toBe("sonnet");
  });

  it("ignores config.json with no hench section", async () => {
    await writeFile(
      join(tmpDir, ".n-dx", "config.json"),
      JSON.stringify({ rex: { project: "other" } }, null, 2) + "\n",
    );

    const config = await loadConfig(henchDir);
    expect(config.model).toBe("sonnet");
  });
});
