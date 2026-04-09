import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  checkProjectStaleness,
  formatStalenessNotice,
  shouldSuppressStaleness,
  REX_SCHEMA_PREFIX,
  SV_SCHEMA_MAJOR,
  HENCH_SCHEMA_PREFIX,
  REQUIRED_DIRS,
  REQUIRED_N_DX_CONFIG_KEYS,
} from "../../packages/core/staleness-check.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Create a minimal project directory with all expected n-dx directories and
 * config files. Returns the absolute path to the temp dir.
 */
function createHealthyProject(tmpDir) {
  // Directories
  mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
  mkdirSync(join(tmpDir, ".rex"), { recursive: true });
  mkdirSync(join(tmpDir, ".hench"), { recursive: true });

  // Schema files
  writeFileSync(
    join(tmpDir, ".rex", "prd.json"),
    JSON.stringify({ schema: "rex/v1", title: "test", items: [] }),
    "utf-8",
  );
  writeFileSync(
    join(tmpDir, ".sourcevision", "manifest.json"),
    JSON.stringify({ schemaVersion: "1.0.0", toolVersion: "0.1.0" }),
    "utf-8",
  );
  writeFileSync(
    join(tmpDir, ".hench", "config.json"),
    JSON.stringify({ schema: "hench/v1", model: "sonnet" }),
    "utf-8",
  );

  // Project config
  writeFileSync(
    join(tmpDir, ".n-dx.json"),
    JSON.stringify({ llm: { vendor: "claude" }, _initVersion: "0.2.2" }),
    "utf-8",
  );
}

// ── checkProjectStaleness ────────────────────────────────────────────────────

describe("checkProjectStaleness", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-staleness-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Healthy project ──────────────────────────────────────────────────────

  it("returns isStale=false for a fully healthy project", () => {
    createHealthyProject(tmpDir);
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.initVersion).toBe("0.2.2");
  });

  // ── Missing directories ──────────────────────────────────────────────────

  it("detects missing .sourcevision/ directory", () => {
    createHealthyProject(tmpDir);
    rmSync(join(tmpDir, ".sourcevision"), { recursive: true });
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    const dirIssues = result.issues.filter((i) => i.type === "missing-dir");
    expect(dirIssues).toHaveLength(1);
    expect(dirIssues[0].detail).toContain(".sourcevision");
  });

  it("detects missing .rex/ directory", () => {
    createHealthyProject(tmpDir);
    rmSync(join(tmpDir, ".rex"), { recursive: true });
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    const dirIssues = result.issues.filter((i) => i.type === "missing-dir");
    expect(dirIssues).toHaveLength(1);
    expect(dirIssues[0].detail).toContain(".rex");
  });

  it("detects missing .hench/ directory", () => {
    createHealthyProject(tmpDir);
    rmSync(join(tmpDir, ".hench"), { recursive: true });
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    const dirIssues = result.issues.filter((i) => i.type === "missing-dir");
    expect(dirIssues).toHaveLength(1);
    expect(dirIssues[0].detail).toContain(".hench");
  });

  it("detects all three directories missing", () => {
    // Empty dir — no .sourcevision, .rex, or .hench
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    const dirIssues = result.issues.filter((i) => i.type === "missing-dir");
    expect(dirIssues).toHaveLength(3);
  });

  // ── Schema version mismatches ────────────────────────────────────────────

  it("detects rex schema mismatch", () => {
    createHealthyProject(tmpDir);
    writeFileSync(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v0", title: "test", items: [] }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    const schemaIssues = result.issues.filter((i) => i.type === "schema-mismatch");
    expect(schemaIssues.some((i) => i.detail.includes("prd.json"))).toBe(true);
  });

  it("accepts forward-compatible rex schema (rex/v1.1)", () => {
    createHealthyProject(tmpDir);
    writeFileSync(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v1.1", title: "test", items: [] }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    const rexIssues = result.issues.filter((i) => i.detail?.includes("prd.json"));
    expect(rexIssues).toHaveLength(0);
  });

  it("detects sourcevision schema mismatch", () => {
    createHealthyProject(tmpDir);
    writeFileSync(
      join(tmpDir, ".sourcevision", "manifest.json"),
      JSON.stringify({ schemaVersion: "2.0.0", toolVersion: "0.1.0" }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    const schemaIssues = result.issues.filter((i) => i.type === "schema-mismatch");
    expect(schemaIssues.some((i) => i.detail.includes("manifest.json"))).toBe(true);
  });

  it("accepts compatible sourcevision schema (same major)", () => {
    createHealthyProject(tmpDir);
    writeFileSync(
      join(tmpDir, ".sourcevision", "manifest.json"),
      JSON.stringify({ schemaVersion: "1.2.3", toolVersion: "0.1.0" }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    const svIssues = result.issues.filter((i) => i.detail?.includes("manifest.json"));
    expect(svIssues).toHaveLength(0);
  });

  it("detects hench config schema mismatch", () => {
    createHealthyProject(tmpDir);
    writeFileSync(
      join(tmpDir, ".hench", "config.json"),
      JSON.stringify({ schema: "hench/v0", model: "sonnet" }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    const schemaIssues = result.issues.filter((i) => i.type === "schema-mismatch");
    expect(schemaIssues.some((i) => i.detail.includes("hench config"))).toBe(true);
  });

  it("accepts forward-compatible hench schema (hench/v1.2)", () => {
    createHealthyProject(tmpDir);
    writeFileSync(
      join(tmpDir, ".hench", "config.json"),
      JSON.stringify({ schema: "hench/v1.2", model: "sonnet" }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    const henchIssues = result.issues.filter((i) => i.detail?.includes("hench config"));
    expect(henchIssues).toHaveLength(0);
  });

  it("detects missing schema field in prd.json", () => {
    createHealthyProject(tmpDir);
    writeFileSync(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ title: "test", items: [] }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    const schemaIssues = result.issues.filter((i) => i.type === "schema-mismatch");
    expect(schemaIssues.some((i) => i.detail.includes("missing"))).toBe(true);
  });

  // ── Missing config keys ──────────────────────────────────────────────────

  it("detects missing required config key (llm.vendor)", () => {
    createHealthyProject(tmpDir);
    // Write .n-dx.json without llm.vendor
    writeFileSync(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ _initVersion: "0.2.0" }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    const configIssues = result.issues.filter((i) => i.type === "missing-config-key");
    expect(configIssues.some((i) => i.detail.includes("llm.vendor"))).toBe(true);
  });

  it("does not flag config keys when .n-dx.json is absent", () => {
    createHealthyProject(tmpDir);
    rmSync(join(tmpDir, ".n-dx.json"));
    const result = checkProjectStaleness(tmpDir);
    // No missing-config-key issues — we only check if the file exists
    const configIssues = result.issues.filter((i) => i.type === "missing-config-key");
    expect(configIssues).toHaveLength(0);
  });

  // ── Graceful degradation ─────────────────────────────────────────────────

  it("handles malformed JSON files gracefully", () => {
    createHealthyProject(tmpDir);
    writeFileSync(join(tmpDir, ".rex", "prd.json"), "NOT JSON", "utf-8");
    // Should not throw
    const result = checkProjectStaleness(tmpDir);
    // prd.json is unparseable → treated as null → no schema mismatch for it
    expect(result).toBeDefined();
  });

  it("handles empty project directory (no files at all)", () => {
    const result = checkProjectStaleness(tmpDir);
    expect(result.isStale).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.initVersion).toBeUndefined();
  });

  // ── initVersion extraction ───────────────────────────────────────────────

  it("extracts initVersion from .n-dx.json", () => {
    createHealthyProject(tmpDir);
    const result = checkProjectStaleness(tmpDir);
    expect(result.initVersion).toBe("0.2.2");
  });

  it("returns undefined initVersion when field is missing", () => {
    createHealthyProject(tmpDir);
    writeFileSync(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude" } }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    expect(result.initVersion).toBeUndefined();
  });

  it("returns undefined initVersion when _initVersion is not a string", () => {
    createHealthyProject(tmpDir);
    writeFileSync(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude" }, _initVersion: 123 }),
      "utf-8",
    );
    const result = checkProjectStaleness(tmpDir);
    expect(result.initVersion).toBeUndefined();
  });
});

// ── Constants ────────────────────────────────────────────────────────────────

describe("staleness constants", () => {
  it("exports expected schema prefixes", () => {
    expect(REX_SCHEMA_PREFIX).toBe("rex/v1");
    expect(SV_SCHEMA_MAJOR).toBe("1");
    expect(HENCH_SCHEMA_PREFIX).toBe("hench/v1");
  });

  it("exports expected required directories", () => {
    expect(REQUIRED_DIRS).toEqual([".sourcevision", ".rex", ".hench"]);
  });

  it("exports at least one required config key", () => {
    expect(REQUIRED_N_DX_CONFIG_KEYS.length).toBeGreaterThan(0);
    expect(REQUIRED_N_DX_CONFIG_KEYS).toContain("llm.vendor");
  });
});

// ── formatStalenessNotice ────────────────────────────────────────────────────

describe("formatStalenessNotice", () => {
  it("includes init version when available", () => {
    const result = {
      isStale: true,
      issues: [{ type: "missing-dir", detail: "Missing .rex/" }],
      initVersion: "0.1.0",
    };
    const msg = formatStalenessNotice(result, "0.2.2");
    expect(msg).toContain("0.1.0");
    expect(msg).toContain("ndx init");
  });

  it("uses generic message when no init version", () => {
    const result = {
      isStale: true,
      issues: [{ type: "missing-dir", detail: "Missing .rex/" }],
      initVersion: undefined,
    };
    const msg = formatStalenessNotice(result, "0.2.2");
    expect(msg).toContain("incomplete");
    expect(msg).toContain("ndx init");
  });

  it("returns a single line (no newlines)", () => {
    const result = {
      isStale: true,
      issues: [{ type: "schema-mismatch", detail: "prd schema" }],
      initVersion: "0.1.0",
    };
    const msg = formatStalenessNotice(result, "0.2.2");
    expect(msg).not.toContain("\n");
  });
});

// ── shouldSuppressStaleness ──────────────────────────────────────────────────

describe("shouldSuppressStaleness", () => {
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, writable: true, configurable: true });
  });

  it("suppresses during init command", () => {
    expect(shouldSuppressStaleness(["init", "."], 0)).toBe(true);
  });

  it("suppresses during help command", () => {
    expect(shouldSuppressStaleness(["help"], 0)).toBe(true);
  });

  it("suppresses during version command", () => {
    expect(shouldSuppressStaleness(["version"], 0)).toBe(true);
    expect(shouldSuppressStaleness(["-v"], 0)).toBe(true);
    expect(shouldSuppressStaleness(["--version"], 0)).toBe(true);
  });

  it("suppresses when --help flag is present", () => {
    expect(shouldSuppressStaleness(["status", "--help"], 0)).toBe(true);
    expect(shouldSuppressStaleness(["plan", "-h"], 0)).toBe(true);
  });

  it("suppresses on non-zero exit code", () => {
    expect(shouldSuppressStaleness(["status"], 1)).toBe(true);
  });

  it("does not suppress on exit code 0 with no flags", () => {
    expect(shouldSuppressStaleness(["status"], 0)).toBe(false);
  });

  it("suppresses on --quiet", () => {
    expect(shouldSuppressStaleness(["status", "--quiet"], 0)).toBe(true);
  });

  it("suppresses on -q", () => {
    expect(shouldSuppressStaleness(["status", "-q"], 0)).toBe(true);
  });

  it("suppresses on --json", () => {
    expect(shouldSuppressStaleness(["version", "--json"], 0)).toBe(true);
  });

  it("suppresses on --format=json", () => {
    expect(shouldSuppressStaleness(["status", "--format=json"], 0)).toBe(true);
  });

  it("suppresses when stdout is not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true, configurable: true });
    expect(shouldSuppressStaleness(["status"], 0)).toBe(true);
  });

  it("does not suppress normal commands in TTY mode", () => {
    expect(shouldSuppressStaleness(["analyze", "."], 0)).toBe(false);
    expect(shouldSuppressStaleness(["plan", "--accept", "."], 0)).toBe(false);
    expect(shouldSuppressStaleness(["work", "."], 0)).toBe(false);
  });
});
