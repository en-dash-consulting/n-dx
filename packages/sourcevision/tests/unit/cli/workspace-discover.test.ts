import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverRepositories,
  findRepositoryRoots,
  isAnalysisCurrent,
  mapBounded,
  type AnalyseRunner,
} from "../../../src/cli/commands/workspace-discover.js";
import { parseWorkspaceFlags } from "../../../src/cli/commands/workspace.js";
import { CLIError } from "../../../src/cli/errors.js";

/** A junction on Windows needs no privilege; elsewhere a plain directory link. */
const DIR_LINK = process.platform === "win32" ? "junction" : "dir";

let base: string;
let outside: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "sv-discover-")));
  outside = realpathSync(mkdtempSync(join(tmpdir(), "sv-discover-outside-")));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

/** An SVN-style root: no git needed, so no HEAD to compare. */
function svnRepo(dir: string): string {
  mkdirSync(join(dir, ".svn"), { recursive: true });
  return dir;
}

/** Writes the two files a current analysis needs, with `files` inventoried. */
function writeAnalysis(repo: string, files: number): void {
  const sv = join(repo, ".sourcevision");
  mkdirSync(sv, { recursive: true });
  writeFileSync(join(sv, "manifest.json"), JSON.stringify({ analyzedAt: "x", modules: {} }));
  writeFileSync(
    join(sv, "inventory.json"),
    JSON.stringify({ files: Array.from({ length: files }, (_, i) => ({ path: `f${i}.ts` })) }),
  );
}

describe("findRepositoryRoots", () => {
  it("finds .git directories, .git files and .svn, and does not descend into a found root", () => {
    mkdirSync(join(base, "a/.git"), { recursive: true });
    mkdirSync(join(base, "a/vendor/inner/.git"), { recursive: true });
    mkdirSync(join(base, "group/b"), { recursive: true });
    writeFileSync(join(base, "group/b/.git"), "gitdir: elsewhere\n");
    svnRepo(join(base, "c"));
    mkdirSync(join(base, "c/sub/.svn"), { recursive: true });
    mkdirSync(join(base, "node_modules/dep/.git"), { recursive: true });

    const { roots, skipped } = findRepositoryRoots(base);
    expect(roots).toEqual([join(base, "a"), join(base, "c"), join(base, "group/b")]);
    expect(skipped).toEqual([]);
  });

  it("never follows a symlink: one to a repository outside is reported, one inside is not walked twice", () => {
    mkdirSync(join(outside, "ext/.git"), { recursive: true });
    mkdirSync(join(base, "real/.git"), { recursive: true });
    symlinkSync(join(outside, "ext"), join(base, "ext-link"), DIR_LINK);
    symlinkSync(join(base, "real"), join(base, "real-link"), DIR_LINK);
    symlinkSync(join(base, "missing"), join(base, "dangling"), DIR_LINK);

    const { roots, skipped } = findRepositoryRoots(base);
    expect(roots).toEqual([join(base, "real")]);
    expect(skipped).toEqual([{ path: "ext-link", reason: "outside-dir", detail: join(outside, "ext") }]);
  });
});

describe("mapBounded", () => {
  it("runs at most `jobs` calls at once and keeps input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapBounded([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});

describe("discoverRepositories", () => {
  it("analyses repositories without an analysis, keeps current ones, and reports failures, timeouts and empty repositories", async () => {
    for (const name of ["ok", "current", "broken", "slow", "empty"]) svnRepo(join(base, name));
    writeAnalysis(join(base, "current"), 3);

    const analysed: string[] = [];
    const runner: AnalyseRunner = async (dir) => {
      analysed.push(dir);
      if (dir.endsWith("broken")) return { status: "failed", detail: "Error: boom" };
      if (dir.endsWith("slow")) return { status: "timed-out", detail: "no result after 1s" };
      writeAnalysis(dir, dir.endsWith("empty") ? 0 : 2);
      return { status: "ok" };
    };

    const result = await discoverRepositories(base, { jobs: 3, timeoutMs: 1000, runner });

    expect(analysed.sort()).toEqual(["broken", "empty", "ok", "slow"].map((n) => join(base, n)));
    expect(result.found).toEqual([
      { path: "current", analysis: "current" },
      { path: "ok", analysis: "analysed" },
    ]);
    expect(result.skipped).toEqual([
      { path: "broken", reason: "analysis-failed", detail: "Error: boom" },
      { path: "empty", reason: "no-supported-files" },
      { path: "slow", reason: "timed-out", detail: "no result after 1s" },
    ]);
  });

  it("reports a successful run that left no readable inventory as a failed analysis", async () => {
    svnRepo(join(base, "r"));
    const result = await discoverRepositories(base, { runner: async () => ({ status: "ok" }) });
    expect(result.skipped).toEqual([{ path: "r", reason: "analysis-failed", detail: "no readable inventory.json" }]);
  });

  it("passes the timeout to the runner", async () => {
    svnRepo(join(base, "r"));
    const seen: number[] = [];
    await discoverRepositories(base, {
      timeoutMs: 1234,
      runner: async (dir, t) => {
        seen.push(t);
        writeAnalysis(dir, 1);
        return { status: "ok" };
      },
    });
    expect(seen).toEqual([1234]);
  });
});

describe("isAnalysisCurrent", () => {
  it("needs both the manifest and the inventory", () => {
    const repo = svnRepo(join(base, "r"));
    expect(isAnalysisCurrent(repo)).toBe(false);
    writeAnalysis(repo, 1);
    expect(isAnalysisCurrent(repo)).toBe(true);
  });
});

describe("parseWorkspaceFlags --discover", () => {
  it("parses --discover in both spellings, --jobs, --timeout and --json", () => {
    expect(parseWorkspaceFlags(["--discover", "clones", "--jobs=3", "--timeout=30", "--json"])).toMatchObject({
      discover: "clones",
      jobs: 3,
      timeoutSeconds: 30,
      json: true,
      positionals: [],
    });
    expect(parseWorkspaceFlags(["--discover=clones"]).discover).toBe("clones");
  });

  it("refuses a --jobs or --timeout that is not a positive whole number", () => {
    for (const bad of ["--jobs=0", "--jobs=two", "--timeout=-1", "--timeout=1.5"]) {
      expect(() => parseWorkspaceFlags(["--discover", "x", bad])).toThrow(CLIError);
    }
  });

  it("refuses --discover without a directory", () => {
    expect(() => parseWorkspaceFlags(["--discover"])).toThrow(CLIError);
  });
});
