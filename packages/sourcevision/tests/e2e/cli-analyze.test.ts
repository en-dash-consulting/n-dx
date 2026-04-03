import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateInventory, validateImports, validateClassifications, validateZones, validateComponents } from "../../src/schema/validate.js";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/small-ts-project");
const REMIX_FIXTURE = join(import.meta.dirname, "../fixtures/remix-app");

describe("sourcevision analyze (e2e)", { timeout: 120_000 }, () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("produces valid JSON outputs for small-ts-project", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-e2e-"));
    await cp(FIXTURE_DIR, tmpDir, { recursive: true });

    execFileSync(process.execPath, [CLI_PATH, "analyze", tmpDir, "--fast"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    const svDir = join(tmpDir, ".sourcevision");

    // Check all expected files exist
    expect(existsSync(join(svDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(svDir, "inventory.json"))).toBe(true);
    expect(existsSync(join(svDir, "imports.json"))).toBe(true);
    expect(existsSync(join(svDir, "zones.json"))).toBe(true);
    expect(existsSync(join(svDir, "components.json"))).toBe(true);
    expect(existsSync(join(svDir, "classifications.json"))).toBe(true);
    expect(existsSync(join(svDir, "llms.txt"))).toBe(true);
    expect(existsSync(join(svDir, "CONTEXT.md"))).toBe(true);

    // Validate each JSON file
    const inventory = JSON.parse(readFileSync(join(svDir, "inventory.json"), "utf-8"));
    expect(validateInventory(inventory).ok).toBe(true);

    const imports = JSON.parse(readFileSync(join(svDir, "imports.json"), "utf-8"));
    expect(validateImports(imports).ok).toBe(true);

    const classifications = JSON.parse(readFileSync(join(svDir, "classifications.json"), "utf-8"));
    expect(validateClassifications(classifications).ok).toBe(true);
    expect(classifications.files.length).toBeGreaterThan(0);

    const zones = JSON.parse(readFileSync(join(svDir, "zones.json"), "utf-8"));
    expect(validateZones(zones).ok).toBe(true);

    const components = JSON.parse(readFileSync(join(svDir, "components.json"), "utf-8"));
    expect(validateComponents(components).ok).toBe(true);
  });

  it("produces deterministic output", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-e2e-"));
    await cp(FIXTURE_DIR, tmpDir, { recursive: true });

    // First run
    execFileSync(process.execPath, [CLI_PATH, "analyze", tmpDir, "--fast"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    const svDir = join(tmpDir, ".sourcevision");
    const inv1 = readFileSync(join(svDir, "inventory.json"), "utf-8");
    const imp1 = readFileSync(join(svDir, "imports.json"), "utf-8");

    // Remove .sourcevision and run again
    await rm(svDir, { recursive: true });

    execFileSync(process.execPath, [CLI_PATH, "analyze", tmpDir, "--fast"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    const inv2 = readFileSync(join(svDir, "inventory.json"), "utf-8");
    const imp2 = readFileSync(join(svDir, "imports.json"), "utf-8");

    // inventory and imports should be identical (zones may vary due to timestamp in manifest)
    expect(inv1).toBe(inv2);
    expect(imp1).toBe(imp2);
  });

  it("supports --phase flag", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-e2e-"));
    await cp(FIXTURE_DIR, tmpDir, { recursive: true });

    // Run only phase 1
    execFileSync(process.execPath, [CLI_PATH, "analyze", tmpDir, "--phase=1"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    const svDir = join(tmpDir, ".sourcevision");
    expect(existsSync(join(svDir, "inventory.json"))).toBe(true);
    expect(existsSync(join(svDir, "imports.json"))).toBe(false);
    expect(existsSync(join(svDir, "zones.json"))).toBe(false);
  });

  it("supports --only flag", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-e2e-"));
    await cp(FIXTURE_DIR, tmpDir, { recursive: true });

    // Run only inventory
    execFileSync(process.execPath, [CLI_PATH, "analyze", tmpDir, "--only=inventory"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    const svDir = join(tmpDir, ".sourcevision");
    expect(existsSync(join(svDir, "inventory.json"))).toBe(true);
    expect(existsSync(join(svDir, "imports.json"))).toBe(false);
  });

  it("shows cached files on second run", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-e2e-"));
    await cp(FIXTURE_DIR, tmpDir, { recursive: true });

    // First run
    execFileSync(process.execPath, [CLI_PATH, "analyze", tmpDir, "--fast"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    // Second run — should show "cached" in output
    const output = execFileSync(process.execPath, [CLI_PATH, "analyze", tmpDir, "--fast"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    expect(output).toContain("cached");

    // Validate output is still correct
    const svDir = join(tmpDir, ".sourcevision");
    const inventory = JSON.parse(readFileSync(join(svDir, "inventory.json"), "utf-8"));
    expect(validateInventory(inventory).ok).toBe(true);
  });

  it("detects route modules in remix-app fixture", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-e2e-"));
    await cp(REMIX_FIXTURE, tmpDir, { recursive: true });

    execFileSync(process.execPath, [CLI_PATH, "analyze", tmpDir, "--fast"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    const svDir = join(tmpDir, ".sourcevision");
    const components = JSON.parse(readFileSync(join(svDir, "components.json"), "utf-8"));

    expect(components.routeModules.length).toBeGreaterThan(0);
    expect(components.summary.totalRouteModules).toBeGreaterThan(0);
  });
});
