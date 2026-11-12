import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  deletedAmong, findUncommittedWork, formatAppliedCompletionKept, formatLoopRefusal,
  formatRecordCommitPending, formatResetDeferredCommitSkipped,
  formatReviewRepairsUncommittedRefusal, formatUncommittedWorkRefusal,
  PRD_COMMIT_PATHS, prepareRecoveryPathspecs,
} from "../../src/agent/lifecycle/uncommitted-work-gate.js";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";

// Real disposable Git and copied shell commands, scripted fixtures only.
// No live human CLI/browser or claim about other Git versions/operating systems.
const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("../../src/process/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/process/exec.js")>();
  return { ...actual, execStdout: async (...args: Parameters<typeof actual.execStdout>) => {
    assertFixture(args[2]?.cwd as string);
    return actual.execStdout(...args);
  } };
});
function rawGit(args: string[]): string {
  return execFileSync("git", args, { cwd: fixture.root, encoding: "utf8" });
}
function assertFixture(cwd: string): void {
  expect(realpathSync(cwd)).toBe(fixture.root);
  expect(realpathSync(rawGit(["rev-parse", "--show-toplevel"]).trim())).toBe(fixture.root);
  expect(realpathSync(rawGit(["rev-parse", "--absolute-git-dir"]).trim())).toBe(join(fixture.root, ".git"));
}
function git(...args: string[]): string { assertFixture(fixture.root); return rawGit(args); }
function put(path: string, bytes: string): void {
  assertFixture(fixture.root);
  const target = resolve(fixture.root, path);
  expect(target.startsWith(fixture.root + sep)).toBe(true);
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
}
function commands(message: string): string[] {
  return message.split("\n").map((s) => s.trim()).filter((s) => s.startsWith("git "));
}
function snapshot(): string[] {
  return [git("rev-parse", "HEAD"), git("diff", "--cached", "--binary"), git("diff", "--binary"),
    git("status", "--porcelain", "--untracked-files=all"), git("stash", "list")];
}
beforeEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  fixture.root = realpathSync(mkdtempSync(join(tmpdir(), "hench-recovery-renames-")));
  const config = join(fixture.root, "isolated-gitconfig"); writeFileSync(config, "");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1"); vi.stubEnv("GIT_CONFIG_GLOBAL", config);
  rawGit(["init", "--quiet", "--template="]);
  git("config", "user.name", "Recovery Fixture"); git("config", "user.email", "recovery@example.invalid");
  git("config", "core.hooksPath", join(fixture.root, "no-hooks")); git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  put(".gitignore", ".hench/\n.ndx/hench/\n.run-logs/\nisolated-gitconfig\n");
});
afterEach(() => {
  assertFixture(fixture.root); rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3 });
  vi.restoreAllMocks(); process.exitCode = undefined;
  vi.unstubAllEnvs();
});
const names = process.platform === "win32" ? ["app.ts", "two spaces.ts"]
  : ["app.ts", 'literal "quote".ts', "source -> arrow.ts"];
for (const layout of [".rex", ".ndx/rex"]) for (const state of ["R", "RM"]) for (const name of names) {
  it(`withholds partial recovery for ${state} into ${layout}: ${name}`, async () => {
    const source = `src/${name}`, target = `${layout}/changes/ch/${name}`;
    put(source, "original\n".repeat(20)); put(`${layout}/changes/ch/state.yaml`, "pending\n");
    put("unrelated.ts", "original unrelated\n");
    git("add", "--", "."); git("commit", "-qm", "baseline");
    put("baseline-untracked.ts", "user scratch\n");
    git("mv", "--", source, target);
    if (state === "RM") put(target, "original\n".repeat(20) + "unstaged post-move bytes\n");
    put("unrelated.ts", "staged unrelated\n"); git("add", "--", "unrelated.ts");
    put("unrelated.ts", "unstaged unrelated\n");
    expect(git("status", "--porcelain")).toMatch(state === "RM" ? /^RM /m : /^R  /m);
    const before = snapshot();
    const found = await findUncommittedWork({ projectDir: fixture.root, discountPaths: PRD_COMMIT_PATHS });
    expect(found.paths).toContain(source);
    expect(found.renames).toEqual([{ source, target }]);
    // The path-only callers (record/reset and baseline-filtered completion)
    // must also discover the pair even if only one endpoint was handed on.
    for (const paths of [[source], [target], found.paths]) {
      const deleted = deletedAmong(fixture.root, paths);
      const files = await prepareRecoveryPathspecs(fixture.root, paths, deleted);
      const messages = [
        formatUncommittedWorkRefusal(paths, deleted, files), formatLoopRefusal(paths, deleted, files),
        formatRecordCommitPending(paths, "task", "failure", files),
        formatResetDeferredCommitSkipped(paths, deleted, files),
        formatReviewRepairsUncommittedRefusal(paths, "failure", "task", deleted, files),
        formatAppliedCompletionKept({ cause: "failure", changeId: "change", taskId: "task", paths, deleted, files }),
      ];
      for (const message of messages) {
        expect(message).toContain("Automatic recovery commands are unavailable");
        expect(message).toContain(JSON.stringify(source)); expect(message).toContain(JSON.stringify(target));
        expect(commands(message)).toEqual([]);
      }
    }
    expect(snapshot()).toEqual(before);
    expect(readFileSync(join(fixture.root, "baseline-untracked.ts"), "utf8")).toBe("user scratch\n");
  });
}

for (const state of ["R", "RM"]) {
  it(`preserves ${state} through completion and the fail-forward loop refusal`, async () => {
    const source = "src/app.ts", target = ".rex/changes/ch/app.ts";
    const henchDir = join(fixture.root, ".hench");
    await initConfig(henchDir);
    put(source, "original\n".repeat(20)); put(".rex/changes/ch/state.yaml", "pending\n");
    put(".n-dx.json", JSON.stringify({ features: { git: { failForward: true } } }));
    git("add", "--", "."); git("commit", "-qm", "baseline");
    git("mv", "--", source, target);
    if (state === "RM") put(target, "original\n".repeat(20) + "unstaged\n");
    const before = snapshot();
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const { shouldStopForUncommittedWork } = await import("../../src/cli/commands/run.js");
    expect(await shouldStopForUncommittedWork(fixture.root, true)).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(output.mock.calls.flat().join("\n")).toContain("Automatic recovery commands are unavailable");
    expect(snapshot()).toEqual(before);
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const run: RunRecord = {
      id: "recovery-fixture", taskId: "task", taskTitle: "Recovery fixture", status: "completed",
      startedAt: new Date().toISOString(), turns: 1, tokenUsage: { input: 1, output: 1 },
      turnTokenUsage: [], toolCalls: [], model: "fixture",
    };
    // Scripted lifecycle fixture; no model, reviewer or test-gate invocation.
    await finalizeRun({ projectDir: fixture.root, henchDir, run, autoCommit: true, autonomous: true, skipFullTestGate: true });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Automatic recovery commands are unavailable");
    expect(run.error).toContain(JSON.stringify(source)); expect(run.error).toContain(JSON.stringify(target));
    expect(commands(run.error!)).toEqual([]);
    expect(snapshot()).toEqual(before);
  });
}

for (const layout of [".rex", ".ndx/rex"]) for (const state of ["R", "RM"]) {
  it(`retains the discounted source of an outgoing ${state} rename from ${layout}`, async () => {
    const source = `${layout}/changes/ch/old.ts`, target = "src/new.ts";
    put(source, "original\n".repeat(20)); put("src/kept.ts", "unrelated\n");
    git("add", "--", "."); git("commit", "-qm", "baseline");
    git("mv", "--", source, target);
    if (state === "RM") put(target, "original\n".repeat(20) + "unstaged\n");
    const before = snapshot();
    const found = await findUncommittedWork({ projectDir: fixture.root, discountPaths: PRD_COMMIT_PATHS });
    expect(found.paths).toEqual([target]); expect(found.renames).toEqual([{ source, target }]);
    const files = await prepareRecoveryPathspecs(fixture.root, found.paths, new Set(), found.renames);
    const message = formatLoopRefusal(found.paths, new Set(), files);
    expect(message).toContain(JSON.stringify(source)); expect(message).toContain(JSON.stringify(target));
    expect(message).toContain("Automatic recovery commands are unavailable");
    expect(commands(message)).toEqual([]); expect(snapshot()).toEqual(before);
  });
}

it.skipIf(process.platform === "win32")("executes ordinary quoted recovery without including unrelated staged, dirty or untracked work", async () => {
  const path = "src/it's ordinary.ts";
  put(path, "before\n"); put("unrelated.ts", "before\n");
  git("add", "--", "."); git("commit", "-qm", "baseline");
  put(path, "task work\n"); put("unrelated.ts", "staged user work\n"); git("add", "--", "unrelated.ts");
  put("unrelated.ts", "unstaged user work\n"); put("baseline-untracked.ts", "user scratch\n");
  const unrelatedIndex = git("show", ":unrelated.ts");
  const files = await prepareRecoveryPathspecs(fixture.root, [path]);
  const message = formatAppliedCompletionKept({ cause: "failure", changeId: "change", taskId: "task", paths: [path], files });
  function run(command: string): void {
    assertFixture(fixture.root);
    execFileSync("sh", ["-eu", "-c", command], { cwd: fixture.root });
  }
  for (const command of commands(message)) run(command);
  expect(git("show", `HEAD:${path}`)).toBe("task work\n");
  expect(git("show", "HEAD:unrelated.ts")).toBe("before\n");
  put(path, "more task work\n");
  const stash = commands(formatUncommittedWorkRefusal([path], new Set(), files)).find((s) => s.startsWith("git stash"));
  expect(stash).toBeDefined(); run(stash!);
  expect(readFileSync(join(fixture.root, path), "utf8")).toBe("task work\n");
  expect(git("show", `stash@{0}:${path}`)).toBe("more task work\n");
  expect(git("show", ":unrelated.ts")).toBe(unrelatedIndex);
  expect(readFileSync(join(fixture.root, "unrelated.ts"), "utf8")).toBe("unstaged user work\n");
  expect(readFileSync(join(fixture.root, "baseline-untracked.ts"), "utf8")).toBe("user scratch\n");
});
