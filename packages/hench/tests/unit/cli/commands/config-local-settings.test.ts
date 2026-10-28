import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdConfig } from "../../../../src/cli/commands/config.js";
import { initConfig, loadConfig } from "../../../../src/store/config.js";
import { applyRepoTrust } from "../../../../src/store/trust.js";
import { evaluateRepoTrust } from "../../../../src/prd/llm-gateway.js";

// The trust review reads a non-default apiKeyEnv in .hench/config.json as the
// repository's credential routing, so `hench config apiKeyEnv` writes the
// user's choice to .n-dx.local.json, where it applies without trust.
describe("hench config apiKeyEnv", () => {
  let dir: string;
  let home: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "hench-config-local-"));
    home = mkdtempSync(join(tmpdir(), "hench-config-home-"));
    await initConfig(join(dir, ".hench"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8"));

  it("writes .n-dx.local.json, and the checkout stays at baseline with the value applied", async () => {
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ hench: { apiKeyEnv: "OLD_KEY" } }));

    await cmdConfig(dir, ["apiKeyEnv", "MY_ANTHROPIC_KEY"], {});

    expect(readJson(join(dir, ".n-dx.local.json")).hench.apiKeyEnv).toBe("MY_ANTHROPIC_KEY");
    expect(readJson(join(dir, ".hench", "config.json")).apiKeyEnv).toBe("ANTHROPIC_API_KEY");
    expect(readJson(join(dir, ".n-dx.json")).hench).toBeUndefined();

    expect(evaluateRepoTrust(dir, { ndxHome: home }).state).toBe("baseline");
    const config = await loadConfig(join(dir, ".hench"));
    expect(applyRepoTrust(config, dir, undefined, { ndxHome: home }).config.apiKeyEnv).toBe("MY_ANTHROPIC_KEY");
  });

  it("does not copy the local value into .hench/config.json on a later write", async () => {
    await cmdConfig(dir, ["apiKeyEnv", "MY_ANTHROPIC_KEY"], {});
    await cmdConfig(dir, ["maxTurns", "10"], {});

    const henchFile = readJson(join(dir, ".hench", "config.json"));
    expect(henchFile.maxTurns).toBe(10);
    expect(henchFile.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
    expect(evaluateRepoTrust(dir, { ndxHome: home }).state).toBe("baseline");
  });
});

// A non-bare claudePath in .hench/config.json is a vendor-cli-path finding, so
// `hench config claudePath` writes .n-dx.local.json. claudePath is optional:
// the hench file keeps no value rather than a placeholder.
describe("hench config claudePath", () => {
  let dir: string;
  let home: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "hench-config-local-"));
    home = mkdtempSync(join(tmpdir(), "hench-config-home-"));
    await initConfig(join(dir, ".hench"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8"));

  it("writes .n-dx.local.json, removes it from .hench/config.json, and the value applies untrusted", async () => {
    const henchPath = join(dir, ".hench", "config.json");
    writeFileSync(henchPath, JSON.stringify({ ...readJson(henchPath), claudePath: "/old/claude" }));

    await cmdConfig(dir, ["claudePath", "/x/claude"], {});

    expect(readJson(join(dir, ".n-dx.local.json")).hench.claudePath).toBe("/x/claude");
    expect(Object.hasOwn(readJson(henchPath), "claudePath")).toBe(false);

    expect(evaluateRepoTrust(dir, { ndxHome: home }).state).toBe("baseline");
    const config = await loadConfig(join(dir, ".hench"));
    expect(applyRepoTrust(config, dir, undefined, { ndxHome: home }).config.claudePath).toBe("/x/claude");
  });

  it("does not copy the local value into .hench/config.json on a later write", async () => {
    await cmdConfig(dir, ["claudePath", "/x/claude"], {});
    await cmdConfig(dir, ["maxTurns", "10"], {});

    const henchFile = readJson(join(dir, ".hench", "config.json"));
    expect(henchFile.maxTurns).toBe(10);
    expect(Object.hasOwn(henchFile, "claudePath")).toBe(false);
    expect(evaluateRepoTrust(dir, { ndxHome: home }).state).toBe("baseline");
  });
});
