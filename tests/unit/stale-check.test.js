import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

/**
 * Unit tests for stale-check.js.
 *
 * Uses vi.mock to intercept node:fs so no real filesystem reads occur.
 * Only directory presence is tested — schema/key heuristics were removed.
 */

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

import { existsSync } from "node:fs";
import { checkProjectStaleness, formatStalenessNotice, requiredDirs } from "../../packages/core/stale-check.js";

const DIR = "/project";

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockDirs(present) {
  existsSync.mockImplementation((p) => present.some((d) => p === join(DIR, d)));
}

// ── checkProjectStaleness ──────────────────────────────────────────────────────

describe("checkProjectStaleness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when all three directories exist", () => {
    mockDirs([".sourcevision", ".rex", ".hench"]);
    expect(checkProjectStaleness(DIR)).toEqual([]);
  });

  it("detects missing .sourcevision directory", () => {
    mockDirs([".rex", ".hench"]);
    const details = checkProjectStaleness(DIR);
    expect(details).toHaveLength(1);
    expect(details[0].kind).toBe("missing-dir");
    expect(details[0].dir).toBe(".sourcevision");
  });

  it("detects missing .rex directory", () => {
    mockDirs([".sourcevision", ".hench"]);
    const details = checkProjectStaleness(DIR);
    expect(details).toHaveLength(1);
    expect(details[0].kind).toBe("missing-dir");
    expect(details[0].dir).toBe(".rex");
  });

  it("detects missing .hench directory", () => {
    mockDirs([".sourcevision", ".rex"]);
    const details = checkProjectStaleness(DIR);
    expect(details).toHaveLength(1);
    expect(details[0].kind).toBe("missing-dir");
    expect(details[0].dir).toBe(".hench");
  });

  it("detects all three directories missing at once", () => {
    mockDirs([]);
    const details = checkProjectStaleness(DIR);
    expect(details).toHaveLength(3);
    expect(details.every((d) => d.kind === "missing-dir")).toBe(true);
    const missingNames = details.map((d) => d.dir);
    expect(missingNames).toContain(".sourcevision");
    expect(missingNames).toContain(".rex");
    expect(missingNames).toContain(".hench");
  });

  it("reports no issues when all directories are present regardless of file contents", () => {
    // Schema drift, missing config keys, etc. must NOT trigger the notice
    mockDirs([".sourcevision", ".rex", ".hench"]);
    const details = checkProjectStaleness(DIR);
    expect(details).toHaveLength(0);
  });

  it("never throws even when existsSync throws", () => {
    existsSync.mockImplementation(() => { throw new Error("Unexpected"); });
    expect(() => checkProjectStaleness(DIR)).not.toThrow();
    expect(checkProjectStaleness(DIR)).toEqual([]);
  });
});

// ── requiredDirs export ───────────────────────────────────────────────────────

describe("requiredDirs", () => {
  it("names the three tool directories a legacy project must have", () => {
    expect(requiredDirs(DIR)).toEqual([".sourcevision", ".rex", ".hench"]);
  });

  it("names the container's three on a project that has migrated", async () => {
    // The staleness probe is a *reader* of one project, so it resolves that
    // project's layout rather than accepting both. It used to be a constant,
    // which meant a `.ndx/` project was told on every command that all three
    // of its tool directories were missing and that it should re-run
    // `ndx init` — on a project that was already complete.
    const { mkdtempSync, mkdirSync: realMkdir, rmSync } = await vi.importActual("node:fs");
    const { tmpdir } = await import("node:os");

    const root = mkdtempSync(join(tmpdir(), "ndx-stale-ndx-"));
    try {
      realMkdir(join(root, ".ndx"), { recursive: true });
      expect(requiredDirs(root)).toEqual([
        ".ndx/sourcevision",
        ".ndx/rex",
        ".ndx/hench",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── formatStalenessNotice ──────────────────────────────────────────────────────

describe("formatStalenessNotice", () => {
  it("returns a non-empty string", () => {
    const notice = formatStalenessNotice([{ kind: "missing-dir", dir: ".rex" }]);
    expect(typeof notice).toBe("string");
    expect(notice.length).toBeGreaterThan(0);
  });

  it("names every missing directory", () => {
    const notice = formatStalenessNotice([
      { kind: "missing-dir", dir: ".rex" },
      { kind: "missing-dir", dir: ".hench" },
    ]);
    expect(notice).toContain(".rex");
    expect(notice).toContain(".hench");
  });

  it("includes 'ndx init' instruction", () => {
    const notice = formatStalenessNotice([{ kind: "missing-dir", dir: ".rex" }]);
    expect(notice).toContain("ndx init");
  });

  it("does not reference schema, version, or keys", () => {
    const notice = formatStalenessNotice([{ kind: "missing-dir", dir: ".rex" }]);
    expect(notice).not.toContain("schema");
    expect(notice).not.toContain("version");
    expect(notice).not.toContain("config key");
  });
});
