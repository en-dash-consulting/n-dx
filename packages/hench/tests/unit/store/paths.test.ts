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
  resolveHenchPaths,
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
