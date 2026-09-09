/**
 * The full-suite gate's ceiling is an operator setting, not a constant.
 *
 * It was hardcoded at 5 minutes. A monorepo that runs every package can
 * legitimately exceed that — and since the gate runs while an agent is also
 * using the machine, overrunning aborts a task whose work was already done and
 * committed. These tests pin the two things that promise makes: the value is
 * settable from either config file, and the gate actually obeys it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig, loadConfig, saveConfig } from "../../src/store/config.js";
import { runTestGate, DEFAULT_TEST_GATE_TIMEOUT_MS } from "../../src/tools/test-runner.js";

describe("hench.fullTestTimeoutMs", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-gate-timeout-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("defaults to the gate's own ceiling when neither config sets it", async () => {
    const config = await loadConfig(henchDir);

    expect(config.fullTestTimeoutMs).toBe(DEFAULT_TEST_GATE_TIMEOUT_MS);
  });

  it("takes the value from .hench/config.json", async () => {
    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, fullTestTimeoutMs: 900_000 });

    expect((await loadConfig(henchDir)).fullTestTimeoutMs).toBe(900_000);
  });

  it("lets .n-dx.json override .hench/config.json", async () => {
    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, fullTestTimeoutMs: 900_000 });
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ hench: { fullTestTimeoutMs: 1_800_000 } }),
      "utf-8",
    );

    // Project config wins — the same precedence loadConfig applies to every
    // other hench key, so an operator can raise this per checkout.
    expect((await loadConfig(henchDir)).fullTestTimeoutMs).toBe(1_800_000);
  });

  it("carries the configured value through to the gate's own limit", async () => {
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ hench: { fullTestTimeoutMs: 1_500 } }),
      "utf-8",
    );
    const config = await loadConfig(henchDir);

    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/index.ts"],
      testCommand: `node -e "setTimeout(() => {}, 60000)"`,
      timeout: config.fullTestTimeoutMs,
    });

    expect(result.passed).toBe(false);
    expect(result.error).toContain("did not finish within 2s");
    // Under the old hardcoded ceiling this would still be running.
    expect(result.totalDurationMs).toBeLessThan(30_000);
  });
});
