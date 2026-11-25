/**
 * `ndx analyze` in a repository `ndx init` never touched.
 *
 * Analysis needs no init: it creates its output folder where init would put it
 * (`.ndx/sourcevision` on a project with no n-dx state) and writes nothing
 * outside it — no `.gitignore` edit (the cache is ignored by a `.gitignore`
 * inside the folder), no `claude_commands.log` at the root, and no "Project
 * setup incomplete" notice. The commands that do need init still refuse.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../packages/core/cli.js", import.meta.url));
const GITIGNORE = "node_modules/\n# keep\n";

let repo;

function git(...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: "pipe" });
}

function ndx(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: repo,
    encoding: "utf8",
    timeout: 110_000,
    env: { ...process.env, NDX_CLI_LOG_PATH: "", ...env },
  });
}

/** Every path git reports as changed or untracked, one per file. */
function changedPaths() {
  return git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ndx-analyze-fresh-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.js"), "export const a = 1;\n");
  writeFileSync(join(repo, "src", "b.js"), 'import { a } from "./a.js";\nconsole.log(a);\n');
  writeFileSync(join(repo, ".gitignore"), GITIGNORE);
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "init");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("ndx analyze in a repository ndx init never touched", () => {
  it("--fast analyses into .ndx/sourcevision and writes nothing outside it", () => {
    const result = ndx(["analyze", "--fast", "."]);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(repo, ".ndx", "sourcevision", "manifest.json"))).toBe(true);
    const changed = changedPaths();
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.filter((p) => !p.startsWith(".ndx/sourcevision/"))).toEqual([]);
    // The cache is machine-local and ignored from inside the folder.
    expect(changed.some((p) => p.startsWith(".ndx/sourcevision/.cache/"))).toBe(false);
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(GITIGNORE);
    expect(result.stderr).not.toContain("Project setup incomplete");
  });

  // The fake vendor CLI is a shebang script, which Windows cannot execute.
  it.skipIf(process.platform === "win32")("logs vendor-CLI calls inside the folder's cache, not at the root", () => {
    // A fake vendor CLI: the analysis degrades on its empty answers, which is
    // fine — the test is about where the invocation log goes.
    const fake = join(mkdtempSync(join(tmpdir(), "ndx-fake-claude-")), "claude");
    writeFileSync(fake, `#!${process.execPath}\nprocess.stdout.write("{}\\n");\n`);
    chmodSync(fake, 0o755);
    try {
      ndx(["analyze", "--wait", "."], { CLAUDE_CLI_PATH: fake });

      expect(existsSync(join(repo, ".ndx", "sourcevision", ".cache", "claude_commands.log"))).toBe(true);
      expect(existsSync(join(repo, "claude_commands.log"))).toBe(false);
      expect(changedPaths().filter((p) => !p.startsWith(".ndx/sourcevision/"))).toEqual([]);
      expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(GITIGNORE);
    } finally {
      rmSync(join(fake, ".."), { recursive: true, force: true });
    }
  });

  it("keeps a legacy project on its layout", () => {
    // Legacy state (a .rex folder) means a project init set up the old way:
    // analysis joins it at .sourcevision rather than starting .ndx/.
    mkdirSync(join(repo, ".rex"));

    const result = ndx(["analyze", "--fast", "."]);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(repo, ".sourcevision", "manifest.json"))).toBe(true);
    expect(existsSync(join(repo, ".ndx"))).toBe(false);
  });

  it("leaves the commands that need init refusing the analysed repository", () => {
    expect(ndx(["analyze", "--fast", "."]).status).toBe(0);

    for (const command of ["status", "work"]) {
      const result = ndx([command, "."]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("NDX_CLI_NOT_INITIALIZED");
    }
  });
});
