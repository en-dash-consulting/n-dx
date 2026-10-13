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
  BOOKKEEPING_PATHS,
  V2_CHANGES_DIRNAME,
  V2_PRODUCT_DIRNAME,
  resolveHenchPaths,
  stateDirNameUnder,
} from "../../../src/store/paths.js";
import { matchesProjectPath } from "../../../src/store/artifacts.js";

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

describe("BOOKKEEPING_PATHS", () => {
  const matches = (path: string): boolean => matchesProjectPath(path, BOOKKEEPING_PATHS);

  it("covers hench's whole state directory on both layouts", () => {
    // Nothing hench writes about itself is ever a work product.
    expect(matches(".hench/runs/abc/record.json")).toBe(true);
    expect(matches(".ndx/hench/runs/abc/record.json")).toBe(true);
    expect(matches(".hench/reviews/abc.json")).toBe(true);
  });

  it("covers rex's own records on both layouts", () => {
    for (const entry of [
      "prd_tree/task-1/index.md",
      ".cache/prd.json",
      "execution-log.jsonl",
      "execution-log.1.jsonl",
      "tree-meta.json",
      "archive.json",
      "pending-proposals.json",
      "acknowledged-findings.json",
    ]) {
      expect(matches(`.rex/${entry}`), `.rex/${entry}`).toBe(true);
      expect(matches(`.ndx/rex/${entry}`), `.ndx/rex/${entry}`).toBe(true);
    }
  });

  it("covers a v2 tree's product/ and changes/ layers on both layouts", () => {
    // Completing a task on a v2 tree writes changes/<change>/state.yaml (and
    // product/ files when the change applies): bookkeeping, as prd_tree/ is on v1.
    for (const entry of [
      `${V2_PRODUCT_DIRNAME}/area/capability/state.yaml`,
      `${V2_CHANGES_DIRNAME}/ch-1/state.yaml`,
      `${V2_CHANGES_DIRNAME}/ch-1/index.md`,
    ]) {
      expect(matches(`.rex/${entry}`), `.rex/${entry}`).toBe(true);
      expect(matches(`.ndx/rex/${entry}`), `.ndx/rex/${entry}`).toBe(true);
    }
    expect(BOOKKEEPING_PATHS).toEqual(
      expect.arrayContaining([
        ".rex/product/",
        ".rex/changes/",
        ".ndx/rex/product/",
        ".ndx/rex/changes/",
      ]),
    );
  });

  it("does not claim rex's project content on either layout", () => {
    // The defect this list replaced: `.rex/` whole was bookkeeping, so a run
    // that only edited the workflow read as "no changes" and could never
    // complete. workflow.md goes into every agent brief; config.json is
    // project configuration.
    for (const entry of ["workflow.md", "n-dx_workflow.md", "config.json"]) {
      expect(matches(`.rex/${entry}`), `.rex/${entry}`).toBe(false);
      expect(matches(`.ndx/rex/${entry}`), `.ndx/rex/${entry}`).toBe(false);
    }
  });

  it("does not claim sourcevision output on either layout", () => {
    // Analysis output is not hench's bookkeeping: a run that rewrote it has
    // changed something the gates built on this list should see. The legacy
    // layout always behaved this way; `.ndx/` used to sweep the whole
    // container in, so the two layouts disagreed.
    expect(matches(".sourcevision/manifest.json")).toBe(false);
    expect(matches(".ndx/sourcevision/manifest.json")).toBe(false);
  });

  it("matches the state directory itself, not just paths beneath it", () => {
    // `git status --porcelain` can report a new directory as a single entry.
    expect(matches(".hench")).toBe(true);
    expect(matches(".rex/prd_tree")).toBe(true);
  });

  it("discounts rex's locks and backup store on either layout", () => {
    // Review finding on #678. The blanket `.rex/` prefix this list replaced
    // covered these; `rex init` does not gitignore them (it appends only
    // n-dx_workflow.md, execution-log*.jsonl and the derived cache), so on a
    // project that never pasted the ndx.gitignore block they are untracked. A
    // lock held while the end-of-run snapshot is taken then read as the run's
    // own changed work and fired the full-suite gate.
    for (const entry of ["prd.lock", "prd.json.lock", "reshape.lock", ".backups/snap-1.json"]) {
      expect(matches(`.rex/${entry}`), `.rex/${entry}`).toBe(true);
      expect(matches(`.ndx/rex/${entry}`), `.ndx/rex/${entry}`).toBe(true);
    }
  });

  it("does not match unrelated work", () => {
    expect(matches("src/index.ts")).toBe(false);
    // Neither a sibling directory whose name merely starts the same way.
    expect(matches(".rexxed/thing.ts")).toBe(false);
  });
});
