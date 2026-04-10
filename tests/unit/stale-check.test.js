import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

/**
 * Unit tests for stale-check.js.
 *
 * Uses vi.mock to intercept node:fs so no real filesystem reads occur.
 */

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from "node:fs";
import { checkProjectStaleness, formatStalenessNotice } from "../../packages/core/stale-check.js";

const DIR = "/project";

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFs({ dirs = [], files = {} } = {}) {
  existsSync.mockImplementation((p) => {
    for (const d of dirs) {
      if (p === join(DIR, d) || p === d) return true;
    }
    return p in files;
  });
  readFileSync.mockImplementation((p) => {
    if (p in files) return files[p];
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
  });
}

const VALID_SV_MANIFEST = JSON.stringify({ schemaVersion: "1.0.0", toolVersion: "0.1.0" });
const VALID_REX_PRD = JSON.stringify({ schema: "rex/v1", title: "test", items: [] });
const VALID_REX_CONFIG = JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" });
const VALID_HENCH_CONFIG = JSON.stringify({
  schema: "hench/v1",
  model: "sonnet",
  maxTurns: 50,
  maxTokens: 8192,
  rexDir: ".rex",
  apiKeyEnv: "ANTHROPIC_API_KEY",
  guard: { blockedPaths: [], allowedCommands: [], commandTimeout: 30000, maxFileSize: 1048576 },
});

function allDirs() {
  return [".sourcevision", ".rex", ".hench"];
}

function allFiles(overrides = {}) {
  return {
    [join(DIR, ".sourcevision", "manifest.json")]: VALID_SV_MANIFEST,
    [join(DIR, ".rex", "prd.json")]: VALID_REX_PRD,
    [join(DIR, ".rex", "config.json")]: VALID_REX_CONFIG,
    [join(DIR, ".hench", "config.json")]: VALID_HENCH_CONFIG,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("checkProjectStaleness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("missing directories", () => {
    it("returns empty array when all directories exist and files are valid", () => {
      mockFs({ dirs: allDirs(), files: allFiles() });
      expect(checkProjectStaleness(DIR)).toEqual([]);
    });

    it("detects missing .sourcevision directory", () => {
      mockFs({ dirs: [".rex", ".hench"], files: allFiles() });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "missing-dir" && d.message.includes(".sourcevision"))).toBe(true);
    });

    it("detects missing .rex directory", () => {
      mockFs({ dirs: [".sourcevision", ".hench"], files: allFiles() });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "missing-dir" && d.message.includes(".rex"))).toBe(true);
    });

    it("detects missing .hench directory", () => {
      mockFs({ dirs: [".sourcevision", ".rex"], files: allFiles() });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "missing-dir" && d.message.includes(".hench"))).toBe(true);
    });

    it("detects all three missing directories at once", () => {
      mockFs({ dirs: [], files: {} });
      const details = checkProjectStaleness(DIR);
      const missingDirs = details.filter((d) => d.kind === "missing-dir");
      expect(missingDirs).toHaveLength(3);
    });
  });

  describe("schema version mismatches", () => {
    it("detects outdated sourcevision manifest schema", () => {
      mockFs({
        dirs: allDirs(),
        files: allFiles({
          [join(DIR, ".sourcevision", "manifest.json")]: JSON.stringify({ schemaVersion: "0.9.0" }),
        }),
      });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "schema-mismatch" && d.message.includes("sourcevision"))).toBe(true);
    });

    it("does not flag sourcevision manifest with correct schema", () => {
      mockFs({ dirs: allDirs(), files: allFiles() });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "schema-mismatch" && d.message.includes("sourcevision"))).toBe(false);
    });

    it("detects outdated rex PRD schema", () => {
      mockFs({
        dirs: allDirs(),
        files: allFiles({
          [join(DIR, ".rex", "prd.json")]: JSON.stringify({ schema: "rex/v0" }),
        }),
      });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "schema-mismatch" && d.message.includes("rex PRD"))).toBe(true);
    });

    it("does not flag rex PRD with correct schema", () => {
      mockFs({ dirs: allDirs(), files: allFiles() });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "schema-mismatch" && d.message.includes("rex PRD"))).toBe(false);
    });

    it("detects outdated hench config schema", () => {
      mockFs({
        dirs: allDirs(),
        files: allFiles({
          [join(DIR, ".hench", "config.json")]: JSON.stringify({
            schema: "hench/v0",
            model: "sonnet",
            maxTurns: 50,
            maxTokens: 8192,
            rexDir: ".rex",
            apiKeyEnv: "KEY",
            guard: {},
          }),
        }),
      });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "schema-mismatch" && d.message.includes("hench config"))).toBe(true);
    });

    it("does not flag hench config with correct schema", () => {
      mockFs({ dirs: allDirs(), files: allFiles() });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "schema-mismatch" && d.message.includes("hench config"))).toBe(false);
    });

    it("skips schema check when manifest schema field is absent", () => {
      mockFs({
        dirs: allDirs(),
        files: allFiles({
          [join(DIR, ".sourcevision", "manifest.json")]: JSON.stringify({ toolVersion: "0.1.0" }),
        }),
      });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "schema-mismatch" && d.message.includes("sourcevision"))).toBe(false);
    });
  });

  describe("missing required config keys", () => {
    it("detects missing key in .rex/config.json", () => {
      mockFs({
        dirs: allDirs(),
        files: allFiles({
          [join(DIR, ".rex", "config.json")]: JSON.stringify({ schema: "rex/v1", adapter: "file" }), // missing "project"
        }),
      });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "missing-key" && d.message.includes("project"))).toBe(true);
    });

    it("detects missing key in .hench/config.json", () => {
      mockFs({
        dirs: allDirs(),
        files: allFiles({
          [join(DIR, ".hench", "config.json")]: JSON.stringify({
            schema: "hench/v1",
            model: "sonnet",
            maxTurns: 50,
            maxTokens: 8192,
            rexDir: ".rex",
            apiKeyEnv: "KEY",
            // missing "guard"
          }),
        }),
      });
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.kind === "missing-key" && d.message.includes("guard"))).toBe(true);
    });

    it("does not flag optional hench keys (tokenBudget, retry, loopPauseMs, maxFailedAttempts)", () => {
      // Current project's config intentionally omits optional-with-default keys
      mockFs({ dirs: allDirs(), files: allFiles() });
      const details = checkProjectStaleness(DIR);
      const optionalKeys = ["tokenBudget", "retry", "loopPauseMs", "maxFailedAttempts"];
      for (const key of optionalKeys) {
        expect(details.some((d) => d.kind === "missing-key" && d.message.includes(key))).toBe(false);
      }
    });
  });

  describe("resilience", () => {
    it("reports all three missing directories when no project is initialized", () => {
      existsSync.mockReturnValue(false);
      const details = checkProjectStaleness(DIR);
      expect(details).toHaveLength(3);
      expect(details.every((d) => d.kind === "missing-dir")).toBe(true);
    });

    it("ignores malformed JSON in config files", () => {
      mockFs({
        dirs: allDirs(),
        files: {
          [join(DIR, ".sourcevision", "manifest.json")]: "not valid json {{{",
          [join(DIR, ".rex", "prd.json")]: VALID_REX_PRD,
          [join(DIR, ".rex", "config.json")]: VALID_REX_CONFIG,
          [join(DIR, ".hench", "config.json")]: VALID_HENCH_CONFIG,
        },
      });
      // Should not throw and should skip the malformed file
      expect(() => checkProjectStaleness(DIR)).not.toThrow();
      const details = checkProjectStaleness(DIR);
      expect(details.some((d) => d.message.includes("sourcevision"))).toBe(false);
    });

    it("never throws even when existsSync throws", () => {
      existsSync.mockImplementation(() => { throw new Error("Unexpected"); });
      expect(() => checkProjectStaleness(DIR)).not.toThrow();
    });

    it("handles missing files gracefully (directories exist but no config files)", () => {
      mockFs({ dirs: allDirs(), files: {} });
      // No config files found — no missing-key or schema-mismatch errors
      const details = checkProjectStaleness(DIR);
      expect(details.every((d) => d.kind === "missing-dir")).toBe(true);
      expect(details).toHaveLength(0);
    });
  });
});

describe("formatStalenessNotice", () => {
  it("returns a non-empty string", () => {
    const notice = formatStalenessNotice([{ kind: "missing-dir", message: "Missing .rex/ directory" }]);
    expect(typeof notice).toBe("string");
    expect(notice.length).toBeGreaterThan(0);
  });

  it("includes the message for each detail", () => {
    const notice = formatStalenessNotice([
      { kind: "missing-dir", message: "Missing .rex/ directory" },
      { kind: "schema-mismatch", message: "rex PRD schema rex/v0 (expected rex/v1)" },
    ]);
    expect(notice).toContain("Missing .rex/ directory");
    expect(notice).toContain("rex PRD schema rex/v0");
  });

  it("includes 'ndx init' instruction", () => {
    const notice = formatStalenessNotice([{ kind: "missing-dir", message: "Missing .rex/ directory" }]);
    expect(notice).toContain("ndx init");
  });

  it("includes the init version when provided", () => {
    const notice = formatStalenessNotice(
      [{ kind: "missing-dir", message: "Missing .rex/ directory" }],
      { initVersion: "1.2.3" },
    );
    expect(notice).toContain("1.2.3");
  });

  it("omits version hint when initVersion is not provided", () => {
    const notice = formatStalenessNotice([{ kind: "missing-dir", message: "Missing .rex/ directory" }]);
    expect(notice).not.toContain("initialized with n-dx");
  });
});
