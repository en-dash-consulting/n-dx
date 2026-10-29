/**
 * Repository hooks run by hench's own git commands are confined, not skipped.
 *
 * The unit half drives `prepareConfinedHooks` with an injected backend, so it
 * runs everywhere and checks what wrapper git is handed. The live half runs a
 * real commit through `execGitMutation` on a host whose sandbox backend works;
 * it skips inside a harness that is itself sandboxed (Seatbelt cannot nest).
 */

import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prepareConfinedHooks } from "../../../src/guard/git-hooks.js";
import { detectSandboxBackend } from "../../../src/prd/llm-gateway.js";
import { initGitFixtureRepoSync } from "../../helpers/index.js";

const seatbelt = { name: "seatbelt" as const, available: true };
const missing = { name: "bwrap" as const, available: false, reason: "bwrap is not on PATH" };
const on = { mode: "on" as const, toolNetwork: "none" as const, source: "default" as const };
const off = { mode: "off" as const, toolNetwork: "none" as const, source: "local-config" as const };

const made: string[] = [];
function tempDir(prefix = "hench-hooks-test-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

/** A repository whose hooks directory holds `hooks` (name → body), opted in via core.hooksPath. */
function repoWithHooks(hooks: Record<string, string>, hooksRel = ".husky"): string {
  const project = tempDir();
  initGitFixtureRepoSync(project);
  const dir = join(project, hooksRel);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(hooks)) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  git(project, "config", "core.hooksPath", hooksRel);
  return project;
}

describe("prepareConfinedHooks", () => {
  it("confines nothing when the sandbox is off or unavailable", async () => {
    const project = repoWithHooks({ "pre-commit": "#!/bin/sh\nexit 0\n" });
    expect(await prepareConfinedHooks(project, { setting: off, backend: seatbelt })).toBeNull();
    expect(await prepareConfinedHooks(project, { setting: on, backend: missing })).toBeNull();
  });

  it("confines nothing when the repository has no executable hook", async () => {
    const project = repoWithHooks({});
    writeFileSync(join(project, ".husky", "pre-commit.sample"), "#!/bin/sh\n");
    chmodSync(join(project, ".husky", "pre-commit.sample"), 0o755);
    writeFileSync(join(project, ".husky", "commit-msg"), "#!/bin/sh\n"); // not executable: git skips it too
    expect(await prepareConfinedHooks(project, { setting: on, backend: seatbelt })).toBeNull();
  });

  it("wraps each executable hook so it re-executes inside the sandbox", async () => {
    const project = repoWithHooks({ "pre-commit": "#!/bin/sh\nexit 0\n", "commit-msg": "#!/bin/sh\nexit 0\n" });
    const hooks = (await prepareConfinedHooks(project, { setting: on, backend: seatbelt, env: {} }))!;
    try {
      expect([...hooks.hooks].sort()).toEqual(["commit-msg", "pre-commit"]);
      const wrapper = readFileSync(join(hooks.hooksPath, "pre-commit"), "utf-8");
      expect(wrapper.startsWith("#!/bin/sh\n")).toBe(true);
      expect(wrapper).toContain("exec '/usr/bin/sandbox-exec' '-p' '(version 1)");
      expect(wrapper).toContain(`'${join(project, ".husky", "pre-commit")}' "$@"`);
      // Nested git in the hook sees the repository's own hooks path again.
      expect(wrapper).toContain("unset GIT_CONFIG_PARAMETERS");
      // hench's state is read-only to the hook; the PRD is not masked.
      expect(wrapper).toContain(`(deny file-write* (subpath "${join(project, ".hench")}")`);
      expect(wrapper).not.toContain(`(subpath "${join(project, ".rex")}")`);
      expect(statSync(join(hooks.hooksPath, "pre-commit")).mode & 0o100).toBeTruthy();
    } finally {
      hooks.dispose();
    }
    expect(existsSync(hooks.hooksPath)).toBe(false);
  });

  it("keeps the wrappers outside every directory the hook may write", async () => {
    const project = repoWithHooks({ "pre-commit": "#!/bin/sh\nexit 0\n" });
    const hooks = (await prepareConfinedHooks(project, { setting: on, backend: seatbelt, env: {} }))!;
    try {
      const wrapper = readFileSync(join(hooks.hooksPath, "pre-commit"), "utf-8");
      const grant = wrapper.split("\n").find((l) => l.startsWith("(allow file-read* file-write* (subpath"))!;
      expect(grant).toBeDefined();
      expect(grant).not.toContain(hooks.hooksPath);
      expect(hooks.hooksPath.startsWith(project)).toBe(false);
    } finally {
      hooks.dispose();
    }
  });

  it("restores a caller's own GIT_CONFIG_PARAMETERS for the hook", async () => {
    const project = repoWithHooks({ "pre-commit": "#!/bin/sh\nexit 0\n" });
    const hooks = (await prepareConfinedHooks(project, {
      setting: on, backend: seatbelt, env: { GIT_CONFIG_PARAMETERS: "'user.name'='it''s me'" },
    }))!;
    try {
      const wrapper = readFileSync(join(hooks.hooksPath, "pre-commit"), "utf-8");
      expect(wrapper).toContain(`GIT_CONFIG_PARAMETERS=''\\''user.name'\\''='\\''it'\\'''\\''s me'\\'''; export GIT_CONFIG_PARAMETERS`);
    } finally {
      hooks.dispose();
    }
  });

  it("follows the default .git/hooks directory and grants a hooks path outside the project read-only", async () => {
    const project = tempDir();
    initGitFixtureRepoSync(project);
    const external = tempDir("hench-ext-hooks-");
    writeFileSync(join(external, "pre-commit"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(external, "pre-commit"), 0o755);
    git(project, "config", "core.hooksPath", external);
    const hooks = (await prepareConfinedHooks(project, { setting: on, backend: seatbelt, env: {} }))!;
    try {
      const wrapper = readFileSync(join(hooks.hooksPath, "pre-commit"), "utf-8");
      expect(wrapper).toMatch(new RegExp(`\\(allow file-read\\* [^\\n]*\\(subpath "${external.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`));
    } finally {
      hooks.dispose();
    }
  });
});

const live = detectSandboxBackend();
describe.skipIf(!live.available)(`live ${live.name}: lifecycle commit hooks`, () => {
  async function commitThroughHench(project: string): Promise<void> {
    const { execGitMutation } = await import("../../../src/process/git-mutation.js");
    const before = process.env.NDX_SANDBOX;
    process.env.NDX_SANDBOX = "on";
    try {
      writeFileSync(join(project, "work.txt"), "work\n");
      await execGitMutation(project, ["add", "work.txt"], 15_000);
      await execGitMutation(project, ["commit", "-q", "-m", "hench commit"], 30_000);
    } finally {
      if (before === undefined) delete process.env.NDX_SANDBOX;
      else process.env.NDX_SANDBOX = before;
    }
  }

  it("runs the pre-commit hook, which can write in the project but not outside it or into hench's state", async () => {
    const outside = tempDir("hench-outside-");
    const project = repoWithHooks({
      "pre-commit": [
        "#!/bin/sh",
        "echo ran > hook-ran.txt",
        `echo escaped > '${join(outside, "escaped")}' 2>/dev/null`,
        "echo TAMPERED > .hench/config.json 2>/dev/null",
        "exit 0",
        "",
      ].join("\n"),
    });
    mkdirSync(join(project, ".hench"));
    writeFileSync(join(project, ".hench", "config.json"), "original");

    await commitThroughHench(project);

    expect(git(project, "log", "-1", "--format=%s").trim()).toBe("hench commit");
    expect(readFileSync(join(project, "hook-ran.txt"), "utf-8").trim()).toBe("ran");
    expect(existsSync(join(outside, "escaped"))).toBe(false);
    expect(readFileSync(join(project, ".hench", "config.json"), "utf-8")).toBe("original");
  });

  it("still lets a failing hook reject the commit", async () => {
    const project = repoWithHooks({ "pre-commit": "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n" });
    await expect(commitThroughHench(project)).rejects.toThrow(/lint failed/);
  });
});
