import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as fsPromises from "node:fs/promises";
import { initGitFixtureRepoSync } from "../helpers/index.js";
import { initConfig } from "../../src/store/config.js";
import type { DirectoryBaseline } from "../../src/agent/analysis/review.js";
import type { RunRecord } from "../../src/schema/index.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

const prompt = vi.hoisted(() => ({ answer: "y", questions: [] as string[] }));
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (answer: string) => void) => { prompt.questions.push(q); cb(prompt.answer); },
    close: () => {}, on: () => {}, removeListener: () => {},
  }),
}));

let root: string;
const originalTTY = process.stdin.isTTY;
function git(...args: string[]): string {
  // Identity, not spelling: Windows Git and Node may use different temp aliases.
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).trim();
  expect([statSync(top).dev, statSync(top).ino]).toEqual([statSync(root).dev, statSync(root).ino]);
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
function put(path: string, bytes = "agent\n"): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
}
async function finish(baselineUntracked: string[], baselineDirectories?: DirectoryBaseline): Promise<void> {
  const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
  const run: RunRecord = {
    id: "directory-rollback", taskId: "fixture", taskTitle: "Fixture", status: "failed",
    startedAt: new Date().toISOString(), turns: 1, tokenUsage: { input: 1, output: 1 },
    turnTokenUsage: [], toolCalls: [], model: "fixture",
  };
  await finalizeRun({ projectDir: root, henchDir: join(root, ".hench"), run, baselineUntracked, baselineDirectories });
}

beforeEach(async () => {
  // Keep Git redirection out of the disposable fixture; shared setup owns identity/hooks.
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) vi.stubEnv(key, undefined);
  root = mkdtempSync(join(tmpdir(), "hench-rollback-directories-"));
  initGitFixtureRepoSync(root);
  await initConfig(join(root, ".hench"));
  put(".gitignore", ".hench/\n.run-logs/\n");
  put("src.ts", "user source\n");
  git("add", "--", ".gitignore", "src.ts");
  git("commit", "-qm", "fixture baseline");
  prompt.answer = "y";
  prompt.questions.length = 0;
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true });
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  vi.unstubAllEnvs();
});

for (const layout of [".rex", ".ndx/rex"]) {
  it.each([false, true])(`removes nested new ${layout} change folders after confirmation (staged: %s), preserving baseline directories and files`, async (staged) => {
    const { captureBaselineUntracked, captureBaselineDirectories } = await import("../../src/agent/lifecycle/shared.js");
    const changes = `${layout}/changes`;
    mkdirSync(join(root, changes, "empty-before", "nested"), { recursive: true });
    put(`${changes}/user/scratch.md`, "user draft\n");
    const baselineUntracked = await captureBaselineUntracked(root);
    const baselineDirectories = await captureBaselineDirectories(root);
    for (const path of ["new-ch/index.md", "new-ch/state.yaml", "new-ch/t/index.md", "empty-before/nested/index.md", "user/new/t/index.md"]) put(`${changes}/${path}`);
    if (staged) git("add", "--", `${changes}/new-ch`);
    put("source-output/new.txt", "keep source work\n");
    await finish(baselineUntracked, baselineDirectories);
    expect(prompt.questions).toHaveLength(1);
    expect(existsSync(join(root, changes, "new-ch"))).toBe(false);
    expect(existsSync(join(root, changes, "user/new"))).toBe(false);
    expect(readdirSync(join(root, changes, "empty-before/nested"))).toEqual([]);
    expect(readFileSync(join(root, changes, "user/scratch.md"), "utf8")).toBe("user draft\n");
    expect(readFileSync(join(root, "source-output/new.txt"), "utf8")).toBe("keep source work\n");
    expect(readFileSync(join(root, "src.ts"), "utf8")).toBe("user source\n");
    expect(git("diff", "--cached", "--name-only")).toBe("");
    expect(git("ls-files", "--others", "--exclude-standard").trim().split("\n").sort()).toEqual([
      `${changes}/user/scratch.md`, "source-output/new.txt",
    ].sort());
  });
}

it("preserves directories when their baseline is unknown", async () => {
  put(".rex/changes/new-ch/t/index.md");
  await finish([]);
  expect(readdirSync(join(root, ".rex/changes/new-ch/t"))).toEqual([]);
});

it("does not visit unrelated or ignored subtrees, and preserves their empty directories if ignore rules change", async () => {
  const { captureBaselineUntracked, captureBaselineDirectories } = await import("../../src/agent/lifecycle/shared.js");
  const { revertChanges } = await import("../../src/agent/analysis/review.js");
  const excluded = ["node_modules", ".claude/worktrees", ".rex/.cache", "src", ".rex/changes/cache"];
  put(".gitignore", ".hench/\n.run-logs/\nnode_modules/\n.claude/worktrees/\n.rex/.cache/\n.rex/changes/cache/\n");
  git("add", "--", ".gitignore");
  git("commit", "-qm", "fixture exclusions");
  for (const path of excluded) mkdirSync(join(root, path, "empty-before"), { recursive: true });
  mkdirSync(join(root, ".rex/changes/empty-before/nested"), { recursive: true });
  put(".rex/changes/user/scratch.md", "user draft\n");
  const files = await captureBaselineUntracked(root);
  const read = vi.mocked(fsPromises.readdir).mockClear();
  const dirs = await captureBaselineDirectories(root);
  expect(dirs).toBeDefined();
  // Filesystem identity avoids macOS /var vs /private/var and Windows temp aliases.
  const visited = read.mock.calls.map(([path]) => {
    const stat = statSync(String(path));
    return [stat.dev, stat.ino];
  });
  for (const path of excluded) {
    const stat = statSync(join(root, path));
    expect(visited).not.toContainEqual([stat.dev, stat.ino]);
  }
  const necessary = statSync(join(root, ".rex/changes/empty-before/nested"));
  expect(visited).toContainEqual([necessary.dev, necessary.ino]);
  read.mockClear();

  // Make the ignored paths cleanable after capture: their old empty directories
  // must remain protected by the baseline, not by today's ignore rules.
  put(".gitignore", ".hench/\n.run-logs/\n");
  git("add", "--", ".gitignore");
  git("commit", "-qm", "fixture unignore");
  for (const path of excluded) put(`${path}/empty-before/agent.md`);
  put(".rex/changes/empty-before/nested/index.md");
  put(".rex/changes/new-ch/t/index.md");
  await revertChanges(root, { baselineUntracked: files, baselineDirectories: dirs });
  for (const path of excluded) expect(readdirSync(join(root, path, "empty-before"))).toEqual([]);
  expect(readdirSync(join(root, ".rex/changes/empty-before/nested"))).toEqual([]);
  expect(existsSync(join(root, ".rex/changes/new-ch"))).toBe(false);
  expect(readFileSync(join(root, ".rex/changes/user/scratch.md"), "utf8")).toBe("user draft\n");
  expect(git("ls-files", "--others", "--exclude-standard").trim()).toBe(".rex/changes/user/scratch.md");
  expect(git("diff", "HEAD")).toBe("");
});

it("preserves a pre-existing directory when Git precomposes its Unicode name", async () => {
  const { captureBaselineUntracked, captureBaselineDirectories } = await import("../../src/agent/lifecycle/shared.js");
  git("config", "core.precomposeunicode", "true");
  const directory = ".rex/changes/cafe\u0301";
  mkdirSync(join(root, directory), { recursive: true });
  const files = await captureBaselineUntracked(root);
  const dirs = await captureBaselineDirectories(root);
  expect(dirs?.directories).toContain(directory);
  put(`${directory}/index.md`);
  await finish(files, dirs);
  expect(prompt.questions).toHaveLength(1);
  expect(existsSync(join(root, directory))).toBe(true);
  expect(readdirSync(join(root, directory))).toEqual([]);
  expect(git("status", "--porcelain")).toBe("");
});

it("bounds nested-project scans to that project's PRD trees, including v1 and product folders", async () => {
  const { captureBaselineDirectories, revertChanges } = await import("../../src/agent/analysis/review.js");
  const project = "packages/app";
  const trees = [`${project}/.rex/prd_tree`, `${project}/.ndx/rex/product`];
  for (const tree of trees) mkdirSync(join(root, tree, "empty-before"), { recursive: true });
  mkdirSync(join(root, "packages/sibling/.rex/changes/empty-before"), { recursive: true });
  const read = vi.mocked(fsPromises.readdir).mockClear();
  const dirs = await captureBaselineDirectories(join(root, project));
  expect(dirs).toBeDefined();
  const sibling = statSync(join(root, "packages/sibling"));
  expect(read.mock.calls.map(([path]) => {
    const stat = statSync(String(path));
    return [stat.dev, stat.ino];
  })).not.toContainEqual([sibling.dev, sibling.ino]);
  for (const tree of trees) {
    put(`${tree}/empty-before/index.md`);
    put(`${tree}/new-parent/new-child/index.md`);
  }
  // The full-review rollback can reach files beyond this project; preserve
  // unread baseline folders there as well as folders we actually inventoried.
  put("packages/sibling/.rex/changes/empty-before/index.md");
  await revertChanges(root, { baselineUntracked: [], baselineDirectories: dirs });
  for (const tree of trees) {
    expect(readdirSync(join(root, tree, "empty-before"))).toEqual([]);
    expect(existsSync(join(root, tree, "new-parent"))).toBe(false);
  }
  expect(readdirSync(join(root, "packages/sibling/.rex/changes/empty-before"))).toEqual([]);
  expect(git("status", "--porcelain")).toBe("");
});

it("disables pruning after an incomplete baseline read", async () => {
  const { captureBaselineDirectories } = await import("../../src/agent/lifecycle/shared.js");
  mkdirSync(join(root, ".rex/changes/empty-before"), { recursive: true });
  vi.mocked(fsPromises.readdir).mockRejectedValueOnce(Object.assign(new Error("fixture read denied"), { code: "EACCES" }));
  const dirs = await captureBaselineDirectories(root);
  expect(dirs).toBeUndefined();
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Directory baseline unavailable"));
  put(".rex/changes/empty-before/index.md");
  await finish([], dirs);
  expect(prompt.questions).toHaveLength(1);
  expect(readdirSync(join(root, ".rex/changes/empty-before"))).toEqual([]);
  expect(git("status", "--porcelain")).toBe("");
});

it("preserves the nested change when confirmation is declined", async () => {
  const { captureBaselineUntracked, captureBaselineDirectories } = await import("../../src/agent/lifecycle/shared.js");
  const files = await captureBaselineUntracked(root);
  const dirs = await captureBaselineDirectories(root);
  put(".rex/changes/new-ch/t/index.md", "keep rejected rollback\n");
  const status = git("status", "--porcelain");
  prompt.answer = "n";
  await finish(files, dirs);
  expect(prompt.questions).toHaveLength(1);
  expect(readFileSync(join(root, ".rex/changes/new-ch/t/index.md"), "utf8")).toBe("keep rejected rollback\n");
  expect(git("status", "--porcelain")).toBe(status);
});

it("keeps new directories that still contain ignored files or unrelated empty children", async () => {
  const { captureBaselineUntracked, captureBaselineDirectories } = await import("../../src/agent/lifecycle/shared.js");
  put(".gitignore", ".hench/\n.run-logs/\n*.local\n");
  git("add", "--", ".gitignore");
  git("commit", "-qm", "fixture ignore rule");
  const files = await captureBaselineUntracked(root);
  const dirs = await captureBaselineDirectories(root);
  put(".rex/changes/ignored/index.md");
  put(".rex/changes/ignored/keep.local", "ignored bytes\n");
  put(".rex/changes/occupied/index.md");
  mkdirSync(join(root, ".rex/changes/occupied/empty-child"));
  await finish(files, dirs);
  expect(prompt.questions).toHaveLength(1);
  expect(readdirSync(join(root, ".rex/changes/ignored"))).toEqual(["keep.local"]);
  expect(readFileSync(join(root, ".rex/changes/ignored/keep.local"), "utf8")).toBe("ignored bytes\n");
  expect(readdirSync(join(root, ".rex/changes/occupied"))).toEqual(["empty-child"]);
  expect(readdirSync(join(root, ".rex/changes/occupied/empty-child"))).toEqual([]);
  expect(git("status", "--porcelain")).toBe("");
});

it("prunes newly created PRD ancestors up to the repository root", async () => {
  const { captureBaselineUntracked, captureBaselineDirectories } = await import("../../src/agent/lifecycle/shared.js");
  const files = await captureBaselineUntracked(root);
  const dirs = await captureBaselineDirectories(root);
  put(".ndx/rex/changes/new-ch/t/index.md");
  await finish(files, dirs);
  expect(prompt.questions).toHaveLength(1);
  expect(existsSync(join(root, ".ndx"))).toBe(false);
  expect(readFileSync(join(root, "src.ts"), "utf8")).toBe("user source\n");
  expect(git("status", "--porcelain")).toBe("");
});

it("preserves a staged cross-boundary rename and its edited bytes while pruning a sibling change", async () => {
  const { captureBaselineUntracked, captureBaselineDirectories } = await import("../../src/agent/lifecycle/shared.js");
  const files = await captureBaselineUntracked(root);
  const dirs = await captureBaselineDirectories(root);
  mkdirSync(join(root, ".rex/changes/protected"), { recursive: true });
  git("mv", "--", "src.ts", ".rex/changes/protected/source.md");
  put(".rex/changes/protected/source.md", "user source\npost-move bytes\n");
  put(".rex/changes/new-ch/t/index.md");
  const index = git("diff", "--cached", "--binary");
  expect(index).toContain("rename from src.ts");
  await finish(files, dirs);
  expect(prompt.questions).toHaveLength(1);
  expect(prompt.questions[0]).not.toContain("protected/source.md");
  expect(existsSync(join(root, ".rex/changes/new-ch"))).toBe(false);
  expect(readFileSync(join(root, ".rex/changes/protected/source.md"), "utf8")).toBe("user source\npost-move bytes\n");
  expect(existsSync(join(root, "src.ts"))).toBe(false);
  expect(git("diff", "--cached", "--binary")).toBe(index);
});
