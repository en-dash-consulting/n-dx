/**
 * e2e tests for `ndx which`.
 *
 * These run the real CLI against this checkout, so they cover the wiring that
 * the unit tests (tests/unit/install-identity.test.js) deliberately stub out:
 * that `import.meta.url` resolves to the right cli.js, that a bin shim outside
 * the checkout is recognised as a link, and that the --json contract survives a
 * real process boundary.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { run, runResult, CLI_PATH, DEFAULT_TIMEOUT } from "./e2e-helpers.js";
import { canCreateSymlinks } from "../helpers/symlink-support.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const CORE_PKG = JSON.parse(
  readFileSync(join(REPO_ROOT, "packages/core/package.json"), "utf-8"),
);

/** Temp dirs created by link tests, removed in afterEach. */
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

/** Parse `ndx which --json` output. */
function whichJson(args = []) {
  const result = runResult(["which", "--json", "--quiet", ...args]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout);
}

describe("ndx which", () => {
  it("exits 0", () => {
    expect(runResult(["which", "--quiet"]).code).toBe(0);
  });

  it("prints version, cli, install, git and project lines", () => {
    const stdout = run(["which", "--quiet"]);
    expect(stdout).toContain(`n-dx ${CORE_PKG.version}`);
    for (const field of ["cli", "install", "git", "project"]) {
      expect(stdout).toMatch(new RegExp(`^\\s+${field}\\s+\\S`, "m"));
    }
  });

  it("reports the cli.js path of the checkout it was invoked from", () => {
    // The acceptance criterion: invoking this worktree's cli.js must report
    // this worktree, regardless of what a globally installed ndx would say.
    expect(whichJson().cliPath).toBe(CLI_PATH);
  });

  it("resolves the project dir from a trailing positional argument", () => {
    const dir = mkdtempSync(join(tmpdir(), "ndx-which-proj-"));
    tempDirs.push(dir);
    // The temp dir may be behind a symlink (/var → /private/var on macOS);
    // compare against what the CLI resolves rather than the raw path.
    expect(whichJson([dir]).projectDir).toBe(resolve(dir));
  });

  it("defaults the project dir to the working directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ndx-which-cwd-"));
    tempDirs.push(dir);
    const result = runResult(["which", "--json", "--quiet"], { cwd: dir });
    expect(result.code).toBe(0);
    // Compare against the realpath: the child's process.cwd() is already
    // resolved, so on macOS it reports /private/var where mkdtemp said /var.
    expect(JSON.parse(result.stdout).projectDir).toBe(realpathSync(dir));
  });
});

describe("ndx which --json", () => {
  it("emits exactly one object with the documented keys", () => {
    const info = whichJson();
    expect(Object.keys(info).sort()).toEqual([
      "cliPath",
      "git",
      "install",
      "projectDir",
      "version",
    ]);
    expect(Object.keys(info.install).sort()).toEqual(["kind", "label", "root"]);
  });

  it("reports the version from packages/core/package.json", () => {
    expect(whichJson().version).toBe(CORE_PKG.version);
  });

  it("classifies this checkout as a workspace and reports git identity", () => {
    const info = whichJson();
    expect(info.install.kind).toBe("workspace");
    expect(info.install.root).toBe(REPO_ROOT);
    // This repo is a git working tree, so the identity must be populated.
    expect(info.git).not.toBeNull();
    expect(info.git.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(typeof info.git.detached).toBe("boolean");
  });
});

describe("ndx which — install kind", () => {
  // Skipped where the environment cannot create symlinks (Windows without
  // Developer Mode/elevation) — the shim shape under test needs a real link.
  it.skipIf(!canCreateSymlinks())("reports a link when reached through a bin shim outside the checkout", () => {
    // Node leaves argv[1] as the symlink path but realpaths import.meta.url.
    // A global `pnpm link` shim is exactly this shape, and it is the case that
    // makes a bare `ndx` run code from a checkout the user is not standing in.
    const dir = mkdtempSync(join(tmpdir(), "ndx-which-link-"));
    tempDirs.push(dir);
    const shim = join(dir, "ndx");
    symlinkSync(CLI_PATH, shim);

    const stdout = execFileSync(process.execPath, [shim, "which", "--json", "--quiet"], {
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
      stdio: "pipe",
      cwd: dir,
    });
    const info = JSON.parse(stdout);

    expect(info.install.kind).toBe("link");
    expect(info.install.label).toBe("pnpm global link");
    // The reported cli path is still the real checkout, not the shim.
    expect(info.cliPath).toBe(CLI_PATH);
    expect(info.cliPath).not.toBe(shim);
  });
});

describe("ndx --version --verbose", () => {
  it("prints the same report as ndx which", () => {
    const viaVersion = run(["--version", "--verbose", "--quiet"]);
    const viaWhich = run(["which", "--quiet"]);
    expect(viaVersion).toBe(viaWhich);
  });

  it("leaves bare --version printing only the version", () => {
    // Guards the back-compat contract: scripts parse this output.
    expect(run(["--version", "--quiet"]).trim()).toBe(CORE_PKG.version);
  });
});

describe("ndx which — help registration", () => {
  it("is listed in the main help output", () => {
    expect(run([])).toMatch(/^\s+which\b/m);
  });

  it("has its own command help", () => {
    const help = run(["which", "--help", "--quiet"]);
    expect(help).toContain("ndx which");
    expect(help).toContain("--json");
  });
});
