/**
 * Unit tests for packages/core/stale-check.js
 *
 * Tests cover:
 * - Returns null for a fully initialized, up-to-date project
 * - Returns notice when any init dir is missing
 * - Returns notice when schema version mismatches in manifest.json or prd.json
 * - Returns notice when hench config.json is missing required keys
 * - Includes toolVersion from manifest.json in the notice when available
 * - Shows generic message when no toolVersion can be determined
 * - Allows overriding expected schemas via opts for testing
 * - Error resilience: never throws on corrupt or missing files
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getStaleNotice,
  EXPECTED_REX_SCHEMA,
  EXPECTED_SV_SCHEMA,
  EXPECTED_HENCH_SCHEMA,
  REQUIRED_HENCH_KEYS,
  INIT_DIRS,
} from "../../packages/core/stale-check.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Create a fully initialized project directory with all required files and
 * valid schemas.
 */
async function createFullProject(dir, opts = {}) {
  const { toolVersion = "0.5.0" } = opts;

  await mkdir(join(dir, ".sourcevision"), { recursive: true });
  await mkdir(join(dir, ".rex"), { recursive: true });
  await mkdir(join(dir, ".hench"), { recursive: true });

  await writeJson(join(dir, ".sourcevision", "manifest.json"), {
    schemaVersion: EXPECTED_SV_SCHEMA,
    toolVersion,
    analyzedAt: new Date().toISOString(),
    targetPath: dir,
    modules: {},
  });

  await writeJson(join(dir, ".rex", "prd.json"), {
    schema: EXPECTED_REX_SCHEMA,
    title: "Test Project",
    items: [],
  });

  // Full hench config with all required keys
  const henchConfig = Object.fromEntries(
    REQUIRED_HENCH_KEYS.map((k) => [k, k === "guard" ? {} : k === "retry" ? {} : "placeholder"]),
  );
  henchConfig.schema = EXPECTED_HENCH_SCHEMA;
  await writeJson(join(dir, ".hench", "config.json"), henchConfig);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

describe("exports", () => {
  it("exports INIT_DIRS containing the three init directories", () => {
    expect(INIT_DIRS).toContain(".sourcevision");
    expect(INIT_DIRS).toContain(".rex");
    expect(INIT_DIRS).toContain(".hench");
    expect(INIT_DIRS).toHaveLength(3);
  });

  it("exports REQUIRED_HENCH_KEYS with at least the core config keys", () => {
    expect(REQUIRED_HENCH_KEYS).toContain("schema");
    expect(REQUIRED_HENCH_KEYS).toContain("provider");
    expect(REQUIRED_HENCH_KEYS).toContain("model");
    expect(REQUIRED_HENCH_KEYS).toContain("tokenBudget");
    expect(REQUIRED_HENCH_KEYS).toContain("retry");
    expect(REQUIRED_HENCH_KEYS).toContain("loopPauseMs");
    expect(REQUIRED_HENCH_KEYS).toContain("maxFailedAttempts");
  });

  it("exports expected schema version constants", () => {
    expect(EXPECTED_REX_SCHEMA).toBe("rex/v1");
    expect(EXPECTED_SV_SCHEMA).toBe("1.0.0");
    expect(EXPECTED_HENCH_SCHEMA).toBe("hench/v1");
  });
});

// ── getStaleNotice ────────────────────────────────────────────────────────────

describe("getStaleNotice", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-stale-check-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Clean project ───────────────────────────────────────────────────────────

  it("returns null when dirs exist, schemas match, and all required hench keys are present", async () => {
    await createFullProject(tmpDir);
    expect(getStaleNotice(tmpDir)).toBeNull();
  });

  // ── Missing directories ─────────────────────────────────────────────────────

  it("returns a notice when .sourcevision/ is missing", async () => {
    await createFullProject(tmpDir);
    await rm(join(tmpDir, ".sourcevision"), { recursive: true });
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  it("returns a notice when .rex/ is missing", async () => {
    await createFullProject(tmpDir);
    await rm(join(tmpDir, ".rex"), { recursive: true });
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  it("returns a notice when .hench/ is missing", async () => {
    await createFullProject(tmpDir);
    await rm(join(tmpDir, ".hench"), { recursive: true });
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  it("returns a notice when all three init dirs are missing (empty project dir)", async () => {
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  // ── Schema version mismatches ───────────────────────────────────────────────

  it("returns a notice when sourcevision manifest has an unexpected schema version", async () => {
    await createFullProject(tmpDir);
    await writeJson(join(tmpDir, ".sourcevision", "manifest.json"), {
      schemaVersion: "0.9.0", // outdated schema
      toolVersion: "0.1.0",
      analyzedAt: new Date().toISOString(),
      targetPath: tmpDir,
      modules: {},
    });
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  it("returns null when sourcevision manifest schema matches expected", async () => {
    await createFullProject(tmpDir);
    // manifest already has correct schema from createFullProject
    expect(getStaleNotice(tmpDir)).toBeNull();
  });

  it("returns a notice when rex prd.json has an unexpected schema version", async () => {
    await createFullProject(tmpDir);
    await writeJson(join(tmpDir, ".rex", "prd.json"), {
      schema: "rex/v0", // outdated schema
      title: "Test",
      items: [],
    });
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  it("returns null when rex prd.json schema matches expected", async () => {
    await createFullProject(tmpDir);
    expect(getStaleNotice(tmpDir)).toBeNull();
  });

  it("returns a notice when hench config.json has an unexpected schema version", async () => {
    await createFullProject(tmpDir);
    const henchConfig = Object.fromEntries(
      REQUIRED_HENCH_KEYS.map((k) => [k, k === "guard" ? {} : k === "retry" ? {} : "placeholder"]),
    );
    henchConfig.schema = "hench/v0"; // outdated schema
    await writeJson(join(tmpDir, ".hench", "config.json"), henchConfig);
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  // ── Missing config keys ─────────────────────────────────────────────────────

  it("returns a notice when hench config.json is missing required keys", async () => {
    await createFullProject(tmpDir);
    // Write a minimal hench config missing newer fields
    await writeJson(join(tmpDir, ".hench", "config.json"), {
      schema: EXPECTED_HENCH_SCHEMA,
      provider: "cli",
      model: "sonnet",
      maxTurns: 50,
      maxTokens: 8192,
      // Missing: tokenBudget, rexDir, apiKeyEnv, guard, retry, loopPauseMs, maxFailedAttempts
    });
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  it("returns a notice when hench config.json is missing a single required key", async () => {
    await createFullProject(tmpDir);
    // Write config with all keys except tokenBudget
    const henchConfig = Object.fromEntries(
      REQUIRED_HENCH_KEYS.map((k) => [k, k === "guard" ? {} : k === "retry" ? {} : "placeholder"]),
    );
    henchConfig.schema = EXPECTED_HENCH_SCHEMA;
    delete henchConfig.tokenBudget;
    await writeJson(join(tmpDir, ".hench", "config.json"), henchConfig);
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  it("returns null when hench config.json has all required keys", async () => {
    await createFullProject(tmpDir);
    expect(getStaleNotice(tmpDir)).toBeNull();
  });

  // ── Version string in notice ────────────────────────────────────────────────

  it("includes the toolVersion from manifest.json in the notice", async () => {
    await createFullProject(tmpDir, { toolVersion: "1.2.3" });
    // Remove .hench so we get a stale notice
    await rm(join(tmpDir, ".hench"), { recursive: true });
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("1.2.3");
    expect(notice).toContain("initialized with n-dx 1.2.3");
  });

  it("shows a generic fallback message when no toolVersion is found", async () => {
    // No dirs at all — no manifest to read toolVersion from
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
    // Should not claim a specific version
    expect(notice).not.toMatch(/initialized with n-dx \d/);
  });

  it("shows a generic fallback message when manifest.json has no toolVersion field", async () => {
    await createFullProject(tmpDir);
    // Rewrite manifest without toolVersion
    await writeJson(join(tmpDir, ".sourcevision", "manifest.json"), {
      schemaVersion: EXPECTED_SV_SCHEMA,
      // no toolVersion
      analyzedAt: new Date().toISOString(),
      targetPath: tmpDir,
      modules: {},
    });
    // Trigger a stale condition (missing .hench)
    await rm(join(tmpDir, ".hench"), { recursive: true });
    const notice = getStaleNotice(tmpDir);
    expect(notice).not.toBeNull();
    expect(notice).not.toMatch(/initialized with n-dx \d/);
    expect(notice).toContain("ndx init");
  });

  // ── Schema override opts ────────────────────────────────────────────────────

  it("respects expectedRexSchema override in opts", async () => {
    await createFullProject(tmpDir);
    // Current rex schema is EXPECTED_REX_SCHEMA — override to force a mismatch
    const notice = getStaleNotice(tmpDir, { expectedRexSchema: "rex/v99" });
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  it("respects expectedSvSchema override in opts", async () => {
    await createFullProject(tmpDir);
    const notice = getStaleNotice(tmpDir, { expectedSvSchema: "99.0.0" });
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  it("respects expectedHenchSchema override in opts", async () => {
    await createFullProject(tmpDir);
    const notice = getStaleNotice(tmpDir, { expectedHenchSchema: "hench/v99" });
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });

  // ── Error resilience ────────────────────────────────────────────────────────

  it("does not throw when manifest.json contains invalid JSON", async () => {
    await createFullProject(tmpDir);
    await writeFile(join(tmpDir, ".sourcevision", "manifest.json"), "not json", "utf-8");
    expect(() => getStaleNotice(tmpDir)).not.toThrow();
  });

  it("returns null (no false positive) when only manifest.json is corrupt", async () => {
    await createFullProject(tmpDir);
    await writeFile(join(tmpDir, ".sourcevision", "manifest.json"), "not json", "utf-8");
    // Corrupt manifest skips the schema check; other files are valid
    expect(getStaleNotice(tmpDir)).toBeNull();
  });

  it("does not throw when prd.json contains invalid JSON", async () => {
    await createFullProject(tmpDir);
    await writeFile(join(tmpDir, ".rex", "prd.json"), "not json", "utf-8");
    expect(() => getStaleNotice(tmpDir)).not.toThrow();
  });

  it("returns null (no false positive) when only prd.json is corrupt", async () => {
    await createFullProject(tmpDir);
    await writeFile(join(tmpDir, ".rex", "prd.json"), "not json", "utf-8");
    expect(getStaleNotice(tmpDir)).toBeNull();
  });

  it("does not throw when hench config.json contains invalid JSON", async () => {
    await createFullProject(tmpDir);
    await writeFile(join(tmpDir, ".hench", "config.json"), "not json", "utf-8");
    expect(() => getStaleNotice(tmpDir)).not.toThrow();
  });

  it("returns null (no false positive) when only hench config.json is corrupt", async () => {
    await createFullProject(tmpDir);
    await writeFile(join(tmpDir, ".hench", "config.json"), "not json", "utf-8");
    // Corrupt config skips the keys check; other files are valid
    expect(getStaleNotice(tmpDir)).toBeNull();
  });

  it("does not throw when called on a non-existent directory", () => {
    expect(() => getStaleNotice("/nonexistent/path/that/does/not/exist")).not.toThrow();
  });

  it("returns a notice (missing dirs) for a non-existent directory", () => {
    const notice = getStaleNotice("/nonexistent/path/that/does/not/exist");
    expect(notice).not.toBeNull();
    expect(notice).toContain("ndx init");
  });
});
