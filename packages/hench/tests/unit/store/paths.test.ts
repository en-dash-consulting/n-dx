import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HENCH_CONFIG_FILENAME,
  RUNS_DIRNAME,
  LOCKS_DIRNAME,
  USAGE_CURSORS_DIRNAME,
  REVIEWS_DIRNAME,
  RECOVERY_DIRNAME,
  AGENT_MCP_DIRNAME,
  BOOKKEEPING_DIR_PREFIXES,
  resolveHenchPaths,
  stateDirNameUnder,
} from "../../../src/store/paths.js";

let legacyRoot: string;
let ndxRoot: string;

beforeAll(() => {
  legacyRoot = mkdtempSync(join(tmpdir(), "hench-paths-legacy-"));
  mkdirSync(join(legacyRoot, ".hench"), { recursive: true });

  ndxRoot = mkdtempSync(join(tmpdir(), "hench-paths-ndx-"));
  mkdirSync(join(ndxRoot, ".ndx", "hench"), { recursive: true });
});

afterAll(() => {
  for (const dir of [legacyRoot, ndxRoot]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveHenchPaths", () => {
  it("resolves under .ndx/ when the container is present", () => {
    const paths = resolveHenchPaths(ndxRoot);
    const henchDir = join(ndxRoot, ".ndx", "hench");

    expect(paths.henchDir).toBe(henchDir);
    expect(paths.configPath).toBe(join(henchDir, HENCH_CONFIG_FILENAME));
    expect(paths.runsDir).toBe(join(henchDir, RUNS_DIRNAME));
  });

  it("falls back to .hench/ when the container is absent", () => {
    const paths = resolveHenchPaths(legacyRoot);
    const henchDir = join(legacyRoot, ".hench");

    expect(paths.henchDir).toBe(henchDir);
    expect(paths.configPath).toBe(join(henchDir, HENCH_CONFIG_FILENAME));
    expect(paths.runsDir).toBe(join(henchDir, RUNS_DIRNAME));
  });

  it("honours an explicit mode, for init and migrate-layout", () => {
    expect(resolveHenchPaths(legacyRoot, { mode: "ndx" }).henchDir).toBe(
      join(legacyRoot, ".ndx", "hench"),
    );
  });

  it("anchors every subdirectory to the resolved state directory", () => {
    // These names were each declared privately at their one call site before
    // this module existed — `runs` in two places, `locks` in two more. The
    // assertion is that they now hang off one resolved parent.
    const paths = resolveHenchPaths(legacyRoot);
    const expected: Record<string, string> = {
      runsDir: RUNS_DIRNAME,
      locksDir: LOCKS_DIRNAME,
      usageCursorsDir: USAGE_CURSORS_DIRNAME,
      reviewsDir: REVIEWS_DIRNAME,
      recoveryDir: RECOVERY_DIRNAME,
      agentMcpDir: AGENT_MCP_DIRNAME,
    };

    for (const [field, dirname] of Object.entries(expected)) {
      expect(paths[field as keyof typeof paths]).toBe(join(paths.henchDir, dirname));
    }
  });
});

describe("stateDirNameUnder", () => {
  it("spells each tool's directory for the layout it is asked about", () => {
    expect(stateDirNameUnder("rex", "legacy")).toBe(".rex");
    expect(stateDirNameUnder("hench", "legacy")).toBe(".hench");
    expect(stateDirNameUnder("sourcevision", "legacy")).toBe(".sourcevision");

    expect(stateDirNameUnder("rex", "ndx")).toBe(".ndx/rex");
    expect(stateDirNameUnder("hench", "ndx")).toBe(".ndx/hench");
    expect(stateDirNameUnder("sourcevision", "ndx")).toBe(".ndx/sourcevision");
  });

  it("gives git-pathspec-shaped names — relative, forward slashes", () => {
    // These strings go into `git add` pathspecs and into prefix matches
    // against porcelain output, where a Windows backslash matches nothing.
    for (const which of ["rex", "hench", "sourcevision"] as const) {
      for (const mode of ["legacy", "ndx"] as const) {
        const name = stateDirNameUnder(which, mode);
        expect(name).not.toContain("\\");
        expect(name.startsWith("/")).toBe(false);
      }
    }
  });

  it("answers from the named mode, never from the working directory", () => {
    // An explicit mode skips detection, so nothing touches the disk. If it
    // detected instead, a classifier's verdict would depend on which checkout
    // the process happened to be started in.
    const cwd = process.cwd();
    try {
      process.chdir(ndxRoot);
      expect(stateDirNameUnder("rex", "legacy")).toBe(".rex");
      process.chdir(legacyRoot);
      expect(stateDirNameUnder("rex", "ndx")).toBe(".ndx/rex");
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("BOOKKEEPING_DIR_PREFIXES", () => {
  it("covers rex and hench on both layouts, and nothing else", () => {
    // The container entry is what covers `.ndx/rex` and `.ndx/hench` — one
    // prefix for both, because everything n-dx owns is inside it.
    expect([...BOOKKEEPING_DIR_PREFIXES]).toEqual([".rex/", ".hench/", ".ndx/"]);
  });

  it("does not claim sourcevision output on the legacy layout", () => {
    // Analysis output is not hench's bookkeeping: a run that rewrote it has
    // changed something the gates built on this list should see. Asserted
    // because deriving the list from the resolver's three-directory answer
    // would have swept it in silently.
    expect(BOOKKEEPING_DIR_PREFIXES).not.toContain(".sourcevision/");
  });

  it("matches a PRD write under either layout by prefix", () => {
    const matches = (path: string): boolean =>
      BOOKKEEPING_DIR_PREFIXES.some((prefix) => path.startsWith(prefix));

    expect(matches(".rex/prd_tree/task-1/index.md")).toBe(true);
    expect(matches(".ndx/rex/prd_tree/task-1/index.md")).toBe(true);
    expect(matches(".hench/runs/abc/record.json")).toBe(true);
    expect(matches(".ndx/hench/runs/abc/record.json")).toBe(true);
    expect(matches("src/index.ts")).toBe(false);
  });
});
