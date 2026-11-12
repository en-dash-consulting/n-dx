import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";

// Scripted confirmation, real lifecycle and Git. No live CLI/model/browser.
// Git 2.43.2 reproduced target loss with the former broad PRD rollback:
// reset made the renamed target untracked, then clean deleted its post-move
// bytes. Separate source-only stash diagnostics did NOT reproduce duplication
// (exit 1, unchanged R/RM); recovery actions belong to the next task.
const fixture = vi.hoisted(() => ({ root: "", questions: [] as string[] }));
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (s: string) => void) => { fixture.questions.push(q); cb(""); },
    close: () => {}, on: () => {}, removeListener: () => {},
  }),
}));
vi.mock("../../src/process/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/process/exec.js")>();
  return {
    ...actual,
    execStdout: async (...args: Parameters<typeof actual.execStdout>) => {
      // Guard every production Git call, including reset/checkout/clean.
      assertFixture(args[2]?.cwd as string);
      return actual.execStdout(...args);
    },
  };
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
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}
function read(path: string): string { return readFileSync(join(fixture.root, path), "utf8"); }
// Windows cannot create filenames containing >; exercise Git-quoted spaces
// there and both quoted spaces and literal arrows on supporting filesystems.
const separator = process.platform === "win32" ? " quoted " : " -> ";
const originalTTY = process.stdin.isTTY;
let henchDir: string;

beforeEach(async () => {
  // Git redirection, config injection and external hooks must not escape the fixture.
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  fixture.root = realpathSync(mkdtempSync(join(tmpdir(), "hench-rollback-renames-")));
  fixture.questions.length = 0;
  const config = join(fixture.root, "isolated-gitconfig");
  writeFileSync(config, "");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_CONFIG_GLOBAL", config);
  // init is the only command before a Git directory exists; cwd is our new empty directory.
  rawGit(["init", "--quiet", "--template="]);
  git("config", "user.name", "Rollback Fixture");
  git("config", "user.email", "rollback@example.invalid");
  git("config", "core.autocrlf", "false");
  git("config", "core.hooksPath", join(fixture.root, "no-hooks"));
  git("config", "commit.gpgsign", "false");
  henchDir = join(fixture.root, ".hench");
  await initConfig(henchDir);
  put(".gitignore", ".hench/\n.run-logs/\nisolated-gitconfig\n");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true });
  vi.restoreAllMocks();
  assertFixture(fixture.root);
  rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3 });
  vi.unstubAllEnvs();
});

async function finish(baselineUntracked: string[] | undefined, options: { yes?: boolean; autonomous?: boolean } = {}): Promise<void> {
  const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
  const run: RunRecord = {
    id: "rollback-fixture", taskId: "task", taskTitle: "Rollback fixture", status: "failed",
    startedAt: new Date().toISOString(), turns: 1, tokenUsage: { input: 1, output: 1 },
    turnTokenUsage: [], toolCalls: [], model: "fixture",
  };
  assertFixture(fixture.root);
  await finalizeRun({ projectDir: fixture.root, henchDir, run, baselineUntracked, ...options });
}

for (const layout of [".rex", ".ndx/rex"]) {
  for (const state of ["R", "RM"]) {
    for (const name of ["app.ts", `source${separator}quoted name.ts`, process.platform === "win32" ? "two  spaces.ts" : 'literal "quote".ts']) {
      it(`preserves ${state} src-to-${layout} rename (${name}) while reverting PRD`, async () => {
        const source = `src/${name}`;
        const target = `${layout}/changes/ch/target${separator}${name}`;
        const prd = `${layout}/changes/ch/state.yaml`;
        put(source, "original\n".repeat(20));
        put(prd, "status: pending\n");
        put("unrelated.ts", "original unrelated\n");
        git("add", "--", "."); git("commit", "-qm", "fixture baseline");
        const scratch = `${layout}/changes/scratch/pre-existing.md`;
        put(scratch, "baseline user work\n");
        const { captureBaselineUntracked } = await import("../../src/agent/lifecycle/shared.js");
        const baseline = await captureBaselineUntracked(fixture.root);
        git("mv", "--", source, target);
        put(target, read(target) + "staged post-move bytes\n");
        git("add", "--", target);
        if (state === "RM") put(target, read(target) + "unstaged post-move bytes\n");
        put(prd, "status: failed\n");
        put("unrelated.ts", "staged unrelated\n"); git("add", "--", "unrelated.ts");
        put("unrelated.ts", "unstaged unrelated\n");
        put(`${layout}/changes/scratch/new.md`, "agent scratch\n");
        const beforeIndex = git("diff", "--cached", "--binary");
        const targetBytes = read(target);
        expect(git("status", "--porcelain")).toMatch(state === "RM" ? /^RM /m : /^R  /m);
        await finish(baseline);
        expect(existsSync(join(fixture.root, target))).toBe(true);
        expect(read(target)).toBe(targetBytes);
        expect(git("diff", "--cached", "--binary")).toBe(beforeIndex);
        expect(existsSync(join(fixture.root, source))).toBe(false);
        expect(read("unrelated.ts")).toBe("unstaged unrelated\n");
        expect(read(scratch)).toBe("baseline user work\n");
        expect(read(prd)).toBe("status: pending\n");
        expect(existsSync(join(fixture.root, `${layout}/changes/scratch/new.md`))).toBe(false);
        expect(fixture.questions).toHaveLength(1);
        expect(fixture.questions[0]).toContain(prd);
        expect(fixture.questions[0]).not.toContain(target);
        expect(fixture.questions[0]).toContain("hench leaves those alone");
      });
    }
  }
}

for (const mode of ["no-tty", "yes", "autonomous"]) {
  it(`preserves the entire rename and PRD state in ${mode} mode`, async () => {
    const prd = ".rex/changes/ch/state.yaml";
    const target = ".rex/changes/ch/app.ts";
    put("src/app.ts", "source\n"); put(prd, "pending\n");
    git("add", "--", "."); git("commit", "-qm", "fixture baseline");
    git("mv", "--", "src/app.ts", target);
    put(target, "source\nunstaged\n"); put(prd, "failed\n");
    const before = git("diff", "HEAD", "--binary");
    const index = git("diff", "--cached", "--binary");
    if (mode === "no-tty") Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await finish([], { yes: mode === "yes", autonomous: mode === "autonomous" });
    expect(git("diff", "HEAD", "--binary")).toBe(before);
    expect(git("diff", "--cached", "--binary")).toBe(index);
    expect(fixture.questions).toEqual([]);
  });
}

for (const layout of [".rex", ".ndx/rex"]) {
  it(`restores ordinary ${layout} modifications, deletions and internal renames`, async () => {
    const base = `${layout}/changes/ch`;
    const original = `${base}/old name.md`;
    const moved = `${base}/new${separator}name.md`;
    const deleted = `${base}/deleted.md`;
    const state = `${base}/state.yaml`;
    put(original, "original intent\n"); put(deleted, "deleted intent\n"); put(state, "pending\n");
    git("add", "--", "."); git("commit", "-qm", "fixture baseline");
    git("mv", "--", original, moved);
    git("rm", "--", deleted);
    put(`${base}/added.md`, "new intent\n"); git("add", "--", `${base}/added.md`);
    put(state, "failed\n");
    await finish([]);
    expect(read(original)).toBe("original intent\n");
    expect(read(deleted)).toBe("deleted intent\n");
    expect(read(state)).toBe("pending\n");
    expect(existsSync(join(fixture.root, moved))).toBe(false);
    expect(existsSync(join(fixture.root, `${base}/added.md`))).toBe(false);
    expect(git("status", "--porcelain")).toBe("");
    expect(fixture.questions[0]).toContain(original);
    expect(fixture.questions[0]).toContain(moved);
  });

  it(`preserves ${layout}-to-source renames and treats bracket paths literally`, async () => {
    const base = `${layout}/changes/ch`;
    // Without literal pathspecs a[1].md would match the protected target a1.md.
    const prd = `${base}/a[1].md`;
    const incoming = `${base}/a1.md`;
    const outgoing = `${base}/out.md`;
    put(prd, "pending\n"); put(outgoing, "outgoing original\n"); put("src/app.ts", "incoming original\n");
    git("add", "--", "."); git("commit", "-qm", "fixture baseline");
    git("mv", "--", outgoing, "src/moved.ts");
    git("mv", "--", "src/app.ts", incoming);
    put("src/moved.ts", "outgoing original\npost-move bytes\n");
    put(incoming, "incoming original\npost-move bytes\n");
    put(prd, "failed\n");
    const staged = git("diff", "--cached", "--binary");
    await finish([]);
    expect(read(prd)).toBe("pending\n");
    expect(read("src/moved.ts")).toBe("outgoing original\npost-move bytes\n");
    expect(read(incoming)).toBe("incoming original\npost-move bytes\n");
    expect(git("diff", "--cached", "--binary")).toBe(staged);
  });
}

it("preserves all untracked work without a baseline while still restoring tracked PRD", async () => {
  const prd = ".rex/changes/ch/state.yaml";
  put(prd, "pending\n"); git("add", "--", "."); git("commit", "-qm", "fixture baseline");
  put(prd, "failed\n"); put(".rex/changes/ch/scratch.md", "unknown ownership\n");
  await finish(undefined);
  expect(read(prd)).toBe("pending\n");
  expect(read(".rex/changes/ch/scratch.md")).toBe("unknown ownership\n");
});

it.skipIf(process.platform === "win32")("preserves files outside the PRD whose names contain literal backslashes", async () => {
  const prd = ".rex/changes/ch/state.yaml";
  const outside = ".rex\\changes\\operator.md";
  const source = ".rex\\changes\\source.md";
  const target = ".rex/changes/ch/target.md";
  put(prd, "pending\n"); put(outside, "original operator\n"); put(source, "source\n");
  git("add", "--", "."); git("commit", "-qm", "fixture baseline");
  put(outside, "unstaged operator bytes\n");
  git("mv", "--", source, target);
  put(target, "source\npost-move bytes\n");
  put(prd, "failed\n");
  const staged = git("diff", "--cached", "--binary");
  await finish([]);
  expect(read(outside)).toBe("unstaged operator bytes\n");
  expect(read(target)).toBe("source\npost-move bytes\n");
  expect(existsSync(join(fixture.root, source))).toBe(false);
  expect(git("diff", "--cached", "--binary")).toBe(staged);
  expect(read(prd)).toBe("pending\n");
  expect(fixture.questions[0]).not.toContain(outside);
  expect(fixture.questions[0]).not.toContain(target);
});

for (const layout of [".rex", ".ndx/rex"]) {
  for (const name of process.platform === "win32" ? ["café.md"] : ["café.md", 'literal "quote".md', "line\nbreak.md", "back\\slash.md"]) {
    it(`rolls back Git-escaped PRD paths in ${layout}: ${JSON.stringify(name)}`, async () => {
      const base = `${layout}/changes/ch`;
      const tracked = `${base}/${name}`;
      const source = `${base}/old-${name}`;
      const target = `${base}/new-${name}`;
      const scratch = `${base}/scratch-${name}`;
      put(tracked, "pending\n"); put(source, "original intent\n");
      git("add", "--", "."); git("commit", "-qm", "fixture baseline");
      put(tracked, "failed\n"); git("add", "--", tracked);
      git("mv", "--", source, target);
      put(scratch, "agent scratch\n");
      expect(git("status", "--porcelain")).toContain('"');
      await finish([]);
      expect(read(tracked)).toBe("pending\n");
      expect(read(source)).toBe("original intent\n");
      expect(existsSync(join(fixture.root, target))).toBe(false);
      expect(existsSync(join(fixture.root, scratch))).toBe(false);
      expect(git("status", "--porcelain")).toBe("");
    });
  }
}

for (const layout of [".rex", ".ndx/rex"]) {
  for (const operation of ["delete", "rename"]) {
    it.each([false, true])(`preserves a cross-boundary rename beneath a ${operation}d ${layout} file path (case alias: %s)`, async (caseAlias) => {
      const parent = `${layout}/changes/ch/node.md`;
      const targetParent = caseAlias ? `${layout}/changes/ch/NODE.md` : parent;
      const target = `${targetParent}/target.md`;
      const movedParent = `${layout}/changes/ch/renamed.md`;
      const state = `${layout}/changes/ch/state.yaml`;
      put(parent, "old leaf\n"); put(state, "pending\n"); put("src/app.ts", "source\n");
      git("add", "--", "."); git("commit", "-qm", "fixture baseline");
      if (operation === "delete") git("rm", "--", parent);
      else git("mv", "--", parent, movedParent);
      mkdirSync(join(fixture.root, targetParent));
      git("mv", "--", "src/app.ts", target);
      put(target, "source\nunstaged post-move bytes\n");
      put(state, "failed\n");
      const index = git("diff", "--cached", "--binary");
      expect(git("status", "--porcelain")).toMatch(/^RM /m);
      await finish([]);
      expect(read(target)).toBe("source\nunstaged post-move bytes\n");
      expect(git("diff", "--cached", "--binary")).toBe(index);
      expect(read(state)).toBe("pending\n");
      expect(fixture.questions[0]).not.toContain(parent);
      expect(fixture.questions[0]).not.toContain(movedParent);
    });
  }
}
