import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  snapshotRefreshState,
  validateRefreshStep,
  validateRefreshCompletion,
  rollbackRefreshState,
} from "../../packages/core/refresh-validate.js";

// ---------------------------------------------------------------------------
// snapshotRefreshState
// ---------------------------------------------------------------------------
describe("snapshotRefreshState", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-refresh-validate-snap-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty snapshot when .sourcevision directory does not exist", async () => {
    const plan = { steps: [{ kind: "sourcevision-analyze" }] };
    const snapshot = await snapshotRefreshState(tmpDir, plan);
    expect(snapshot.fileCount).toBe(0);
    expect(Object.keys(snapshot.files)).toHaveLength(0);
  });

  it("captures existing sourcevision files when the directory exists", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify({ analyzedAt: "2026-01-01T00:00:00.000Z" }),
      "utf-8",
    );
    await writeFile(join(svDir, "CONTEXT.md"), "# Context\n", "utf-8");

    const plan = { steps: [{ kind: "sourcevision-analyze" }] };
    const snapshot = await snapshotRefreshState(tmpDir, plan);

    expect(snapshot.fileCount).toBeGreaterThanOrEqual(2);
    expect(snapshot.files["manifest.json"]).toBeDefined();
    expect(snapshot.files["CONTEXT.md"]).toBeDefined();
    expect(snapshot.capturedAt).toBeLessThanOrEqual(Date.now());
  });

  it("does not snapshot when only web-build is planned", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(join(svDir, "manifest.json"), "{}", "utf-8");

    const plan = { steps: [{ kind: "web-build" }] };
    const snapshot = await snapshotRefreshState(tmpDir, plan);

    // web-build does not touch .sourcevision, so no snapshot needed
    expect(snapshot.fileCount).toBe(0);
  });

  it("snapshots when sourcevision-dashboard-artifacts step is planned", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(join(svDir, "dashboard-artifacts.json"), JSON.stringify({ ok: true }), "utf-8");

    const plan = { steps: [{ kind: "sourcevision-dashboard-artifacts" }] };
    const snapshot = await snapshotRefreshState(tmpDir, plan);

    expect(snapshot.files["dashboard-artifacts.json"]).toBeDefined();
    expect(snapshot.fileCount).toBeGreaterThan(0);
  });

  it("records absDir and svDir paths in the snapshot", async () => {
    const plan = { steps: [{ kind: "sourcevision-analyze" }] };
    const snapshot = await snapshotRefreshState(tmpDir, plan);
    expect(snapshot.absDir).toBeTruthy();
    expect(snapshot.svDir).toContain(".sourcevision");
  });
});

// ---------------------------------------------------------------------------
// validateRefreshStep
// ---------------------------------------------------------------------------
describe("validateRefreshStep", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-refresh-validate-step-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports missing manifest.json for sourcevision-analyze step", () => {
    const result = validateRefreshStep("sourcevision-analyze", tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("manifest.json"))).toBe(true);
  });

  it("succeeds when manifest.json exists and contains valid JSON", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify({ analyzedAt: "2026-01-01" }),
      "utf-8",
    );

    const result = validateRefreshStep("sourcevision-analyze", tmpDir);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("reports invalid JSON in manifest.json", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(join(svDir, "manifest.json"), "{ not valid json {{", "utf-8");

    const result = validateRefreshStep("sourcevision-analyze", tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("invalid JSON"))).toBe(true);
  });

  it("reports missing dashboard-artifacts.json for sourcevision-dashboard-artifacts step", () => {
    const result = validateRefreshStep("sourcevision-dashboard-artifacts", tmpDir);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("dashboard-artifacts.json"))).toBe(true);
  });

  it("succeeds when dashboard-artifacts.json exists with valid JSON", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(join(svDir, "dashboard-artifacts.json"), JSON.stringify({ ok: true }), "utf-8");

    const result = validateRefreshStep("sourcevision-dashboard-artifacts", tmpDir);
    expect(result.valid).toBe(true);
  });

  it("requires no output files for web-build step (always valid)", () => {
    const result = validateRefreshStep("web-build", tmpDir);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("requires no output files for sourcevision-pr-markdown step (always valid)", () => {
    const result = validateRefreshStep("sourcevision-pr-markdown", tmpDir);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("requires no output files for an unknown step kind (always valid)", () => {
    const result = validateRefreshStep("unknown-future-step", tmpDir);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateRefreshCompletion
// ---------------------------------------------------------------------------
describe("validateRefreshCompletion", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-refresh-validate-comp-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("succeeds when all step outputs are present and valid", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(join(svDir, "manifest.json"), JSON.stringify({ ok: true }), "utf-8");
    await writeFile(join(svDir, "dashboard-artifacts.json"), JSON.stringify({ ok: true }), "utf-8");

    const plan = {
      steps: [
        { kind: "sourcevision-analyze" },
        { kind: "sourcevision-dashboard-artifacts" },
      ],
    };
    const result = validateRefreshCompletion(tmpDir, plan);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("fails when a required output file is missing", () => {
    const plan = { steps: [{ kind: "sourcevision-analyze" }] };
    const result = validateRefreshCompletion(tmpDir, plan);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("[sourcevision-analyze]"))).toBe(true);
  });

  it("prefixes each issue with the step kind", () => {
    const plan = {
      steps: [
        { kind: "sourcevision-analyze" },
        { kind: "sourcevision-dashboard-artifacts" },
      ],
    };
    const result = validateRefreshCompletion(tmpDir, plan);
    expect(result.valid).toBe(false);
    const prefixes = result.issues.map((i) => i.split("]")[0] + "]");
    expect(prefixes.some((p) => p.includes("sourcevision-analyze"))).toBe(true);
  });

  it("succeeds immediately for an empty plan (no steps to validate)", () => {
    const plan = { steps: [] };
    const result = validateRefreshCompletion(tmpDir, plan);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("succeeds for a plan containing only web-build (no file outputs to check)", () => {
    const plan = { steps: [{ kind: "web-build" }] };
    const result = validateRefreshCompletion(tmpDir, plan);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rollbackRefreshState
// ---------------------------------------------------------------------------
describe("rollbackRefreshState", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-refresh-validate-rollback-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("restores a snapshotted file to its pre-refresh content", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    const original = JSON.stringify({ version: "before-refresh" });
    await writeFile(join(svDir, "manifest.json"), original, "utf-8");

    // Take snapshot before the refresh runs
    const plan = { steps: [{ kind: "sourcevision-analyze" }] };
    const snapshot = await snapshotRefreshState(tmpDir, plan);
    expect(snapshot.fileCount).toBeGreaterThan(0);

    // Simulate a refresh that overwrites the file with a new (or corrupt) value
    await writeFile(join(svDir, "manifest.json"), "corrupted content", "utf-8");

    // Rollback
    const result = await rollbackRefreshState(snapshot);
    expect(result.restored).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    // File must contain the original content
    const after = await readFile(join(svDir, "manifest.json"), "utf-8");
    expect(after).toBe(original);
  });

  it("restores multiple files from the snapshot", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    const files = {
      "manifest.json": JSON.stringify({ v: 1 }),
      "CONTEXT.md": "# Before\n",
      "dashboard-artifacts.json": JSON.stringify({ refreshedAt: "2026-01-01" }),
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(svDir, name), content, "utf-8");
    }

    const plan = {
      steps: [{ kind: "sourcevision-analyze" }, { kind: "sourcevision-dashboard-artifacts" }],
    };
    const snapshot = await snapshotRefreshState(tmpDir, plan);

    // Overwrite each file
    for (const name of Object.keys(files)) {
      await writeFile(join(svDir, name), "overwritten", "utf-8");
    }

    const result = await rollbackRefreshState(snapshot);
    expect(result.restored).toBeGreaterThanOrEqual(3);
    expect(result.failed).toBe(0);

    for (const [name, expected] of Object.entries(files)) {
      const actual = await readFile(join(svDir, name), "utf-8");
      expect(actual).toBe(expected);
    }
  });

  it("returns zero counts and no errors for an empty snapshot", async () => {
    const snapshot = {
      absDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      files: {},
      capturedAt: Date.now(),
      fileCount: 0,
    };
    const result = await rollbackRefreshState(snapshot);
    expect(result.restored).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("returns zero counts for a null snapshot", async () => {
    const result = await rollbackRefreshState(null);
    expect(result.restored).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("recreates .sourcevision directory if it was deleted before rollback", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(join(svDir, "manifest.json"), JSON.stringify({ v: 1 }), "utf-8");

    const plan = { steps: [{ kind: "sourcevision-analyze" }] };
    const snapshot = await snapshotRefreshState(tmpDir, plan);
    expect(snapshot.fileCount).toBeGreaterThan(0);

    // Simulate the directory being fully removed during a botched refresh
    await rm(svDir, { recursive: true, force: true });

    const result = await rollbackRefreshState(snapshot);
    expect(result.restored).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
  });
});
