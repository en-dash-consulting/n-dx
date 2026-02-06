import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { HenchConfigSchema } from "../../src/schema/validate.js";
import { DEFAULT_HENCH_CONFIG, HENCH_SCHEMA_VERSION } from "../../src/schema/v1.js";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");

describe("hench init", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "hench-e2e-init-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates .hench/ directory with config and runs", () => {
    const output = execSync(`node ${CLI_PATH} init ${testDir}`, {
      encoding: "utf-8",
    });

    expect(output).toContain("Initialized .hench/");
    expect(output).toContain("config.json");
  });

  it("creates valid config.json", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });

    const configPath = join(testDir, ".hench", "config.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);

    expect(config.schema).toBe("hench/v1");
    expect(config.model).toBe("sonnet");
    expect(config.provider).toBe("cli");
    expect(config.maxTurns).toBe(50);
    expect(config.guard.blockedPaths).toContain(".hench/**");
  });

  it("creates config.json that passes schema validation", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });

    const configPath = join(testDir, ".hench", "config.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    const result = HenchConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Schema validation failed: ${result.error.message}`);
    }
  });

  it("creates config.json matching DEFAULT_HENCH_CONFIG", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });

    const configPath = join(testDir, ".hench", "config.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    const defaults = DEFAULT_HENCH_CONFIG();

    expect(config).toEqual(defaults);
  });

  it("creates config.json with correct schema version", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });

    const configPath = join(testDir, ".hench", "config.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);

    expect(config.schema).toBe(HENCH_SCHEMA_VERSION);
  });

  it("creates config.json with all required guard fields", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });

    const configPath = join(testDir, ".hench", "config.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);

    expect(config.guard).toBeDefined();
    expect(config.guard.blockedPaths).toBeInstanceOf(Array);
    expect(config.guard.allowedCommands).toBeInstanceOf(Array);
    expect(config.guard.commandTimeout).toBeGreaterThan(0);
    expect(config.guard.maxFileSize).toBeGreaterThan(0);
  });

  it("creates config.json with all required retry fields", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });

    const configPath = join(testDir, ".hench", "config.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);

    expect(config.retry).toBeDefined();
    expect(config.retry.maxRetries).toBeGreaterThanOrEqual(0);
    expect(config.retry.baseDelayMs).toBeGreaterThan(0);
    expect(config.retry.maxDelayMs).toBeGreaterThan(0);
  });

  it("creates runs/ directory", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });
    await access(join(testDir, ".hench", "runs"));
  });

  it("is idempotent", () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });
    const output = execSync(`node ${CLI_PATH} init ${testDir}`, {
      encoding: "utf-8",
    });
    expect(output).toContain("already initialized");
  });

  it("preserves valid config on re-run", async () => {
    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });

    const configPath = join(testDir, ".hench", "config.json");
    const firstRaw = await readFile(configPath, "utf-8");

    execSync(`node ${CLI_PATH} init ${testDir}`, { encoding: "utf-8" });

    const secondRaw = await readFile(configPath, "utf-8");
    expect(secondRaw).toBe(firstRaw);

    const config = JSON.parse(secondRaw);
    const result = HenchConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});
