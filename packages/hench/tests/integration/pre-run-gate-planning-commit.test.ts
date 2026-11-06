import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { performPreRunCommitGateIfNeeded, PLANNING_COMMIT_SUBJECT } from "../../src/agent/lifecycle/shared.js";
import { initGitFixtureRepo, RM_RETRY } from "../helpers/index.js";

const execFile = promisify(execFileCb);

/**
 * Decision UT1: before a run, n-dx commits its own pending planning files —
 * the PRD roots and the project config, in either layout — as a commit of
 * their own, then starts. Any other uncommitted file still refuses, and the
 * refusal names only those files. Driven against a real repository, with no
 * git seam, so the pathspecs and the porcelain parse are the real ones.
 */
describe("pre-run commit gate: n-dx planning files", () => {
  let projectDir: string;
  let henchDir: string;
  let logged: string[];

  async function git(...args: string[]): Promise<string> {
    return (await execFile("git", args, { cwd: projectDir })).stdout.trim();
  }

  async function put(rel: string, content: string): Promise<void> {
    await mkdir(join(projectDir, rel, ".."), { recursive: true });
    await writeFile(join(projectDir, rel), content, "utf-8");
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-planning-commit-"));
    henchDir = join(projectDir, ".hench");
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);
    await put("README.md", "# fixture\n");
    await put("src/app.ts", "export const a = 1;\n");
    await put(".hench/config.json", '{ "model": "sonnet" }\n');
    await put(".rex/changes/ch/state.yaml", "status: pending\n");
    await git("add", ".");
    await git("commit", "-m", "initial");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  const gate = (extra: { allowDirty?: boolean } = {}) =>
    performPreRunCommitGateIfNeeded({
      projectDir,
      henchDir,
      autonomous: true,
      itemId: "task-1",
      ...extra,
      deps: { isTTY: false },
    });

  it("commits only the planning files, in one commit, and starts", async () => {
    await put(".rex/changes/ch/state.yaml", "status: in_progress\n");
    await put(".rex/product/area.md", "# Area\n");
    await put(".ndx/rex/changes/other/index.md", "# Other\n");
    await put(".ndx/config.json", "{}\n");
    await put(".n-dx.json", "{}\n");
    const before = await git("rev-parse", "HEAD");

    expect(await gate()).toBe("proceed");

    expect(await git("rev-list", "--count", `${before}..HEAD`)).toBe("1");
    const files = (await git("show", "--name-only", "--format=", "HEAD")).split("\n").sort();
    expect(files).toEqual([
      ".n-dx.json",
      ".ndx/config.json",
      ".ndx/rex/changes/other/index.md",
      ".rex/changes/ch/state.yaml",
      ".rex/product/area.md",
    ]);
    expect(await git("log", "-1", "--format=%s")).toBe(PLANNING_COMMIT_SUBJECT);
    expect(await git("log", "-1", "--format=%(trailers:key=N-DX-Item,valueonly)")).toBe("task-1");
    expect(await git("status", "--porcelain")).toBe("");
  });

  it("never commits rex's locks, backups or derived cache", async () => {
    // Untracked on a project that skipped the hand-pasted ndx.gitignore block.
    await put(".rex/changes/ch/state.yaml", "status: in_progress\n");
    await put(".rex/prd.lock", "{}\n");
    await put(".rex/.backups/prd_tree_2026/index.md", "# copy of the PRD\n");
    await put(".ndx/rex/.cache/prd.json", "{}\n");

    expect(await gate()).toBe("proceed");

    expect(await git("show", "--name-only", "--format=", "HEAD")).toBe(".rex/changes/ch/state.yaml");
    const left = await git("status", "--porcelain", "--untracked-files=all");
    expect(left).toContain(".rex/prd.lock");
    expect(left).toContain(".rex/.backups/");
    expect(left).toContain(".ndx/rex/.cache/prd.json");
  });

  it("starts without a commit when only rex's machine-local files are dirty", async () => {
    await put(".rex/prd.lock", "{}\n");
    const before = await git("rev-parse", "HEAD");

    expect(await gate()).toBe("proceed");

    expect(await git("rev-parse", "HEAD")).toBe(before);
  });

  it("refuses when an app file is also dirty, naming only the non-planning files", async () => {
    await put(".rex/changes/ch/state.yaml", "status: in_progress\n");
    await put(".ndx/config.json", "{}\n");
    await put("src/app.ts", "export const a = 2;\n");
    const before = await git("rev-parse", "HEAD");

    expect(await gate()).toBe("stop");

    expect(await git("rev-parse", "HEAD")).toBe(before);
    const refusal = logged.find((line) => line.includes("Refusing to start"));
    expect(refusal).toContain("1 uncommitted file(s)");
    expect(refusal).toContain("src/app.ts");
    expect(refusal).not.toContain(".rex/");
    expect(refusal).not.toContain(".ndx/config.json");
  });

  it("still refuses on an edited hench config: it is operator configuration", async () => {
    await put(".hench/config.json", '{ "model": "opus" }\n');
    expect(await gate()).toBe("stop");
    expect(logged.find((line) => line.includes("Refusing to start"))).toContain(".hench/config.json");
  });

  it("leaves the tree alone under --allow-dirty", async () => {
    await put(".rex/changes/ch/state.yaml", "status: in_progress\n");
    const before = await git("rev-parse", "HEAD");

    expect(await gate({ allowDirty: true })).toBe("proceed");

    expect(await git("rev-parse", "HEAD")).toBe(before);
    expect(await git("status", "--porcelain")).toContain(".rex/changes/ch/state.yaml");
  });

  it("addresses a nested project's planning files from the repository root", async () => {
    // A project in a subdirectory: porcelain paths are repo-relative, so the
    // commit has to address them from the top of the repository.
    const sub = join(projectDir, "pkg");
    await put("pkg/.rex/changes/ch/state.yaml", "status: pending\n");
    await git("add", ".");
    await git("commit", "-m", "nested project");
    await put("pkg/.rex/changes/ch/state.yaml", "status: in_progress\n");

    const result = await performPreRunCommitGateIfNeeded({
      projectDir: sub,
      henchDir: join(sub, ".hench"),
      autonomous: true,
      deps: { isTTY: false },
    });

    expect(result).toBe("proceed");
    expect(await git("show", "--name-only", "--format=", "HEAD")).toBe("pkg/.rex/changes/ch/state.yaml");
    // No --task: selection has not picked one, so no item is named.
    expect(await git("log", "-1", "--format=%(trailers:key=N-DX-Item,valueonly)")).toBe("");
  });
});
