/**
 * Unit tests for packages/core/install-identity.js — the logic behind
 * `ndx which`.
 *
 * Every function takes its filesystem and git access by injection, so all three
 * install shapes (npm install, global link, workspace checkout) are exercised
 * here without creating real installs. The e2e counterpart
 * (tests/e2e/cli-which.test.js) covers the wiring against the real checkout.
 */

import { describe, it, expect } from "vitest";
import { join, resolve, sep } from "node:path";
import {
  INSTALL_KIND,
  INSTALL_KIND_LABELS,
  isUnderNodeModules,
  findWorkspaceRoot,
  classifyInstall,
  readGitIdentity,
  collectInstallIdentity,
  formatGitIdentity,
  formatInstallIdentity,
  formatBranchField,
  formatWorkIdentityLine,
  shouldPrintWorkIdentity,
} from "../../packages/core/install-identity.js";

/** Build an existsSync stub that reports exactly `paths` as present. */
function existsOnly(paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

// Fixture paths go through `resolve`/`join` so they come out in the host's
// native form. The module under test resolves every path it is given, and the
// `existsSync` stub below matches by exact string — a POSIX literal such as
// "/home/dev/n-dx/pnpm-workspace.yaml" never equals the "D:\\home\\dev\\…"
// that `join(resolve(…), …)` produces on Windows, which silently turned every
// checkout into an "unknown" install in CI there.

/** A workspace checkout laid out the way this monorepo is. */
const WORKSPACE_ROOT = resolve("/home/dev/n-dx");
const WORKSPACE_CLI = join(WORKSPACE_ROOT, "packages", "core", "cli.js");
const WORKSPACE_MARKER = join(WORKSPACE_ROOT, "pnpm-workspace.yaml");
/** A project the CLI is pointed at, distinct from the checkout it runs from. */
const PROJECT_DIR = resolve("/home/dev/app");
/** A global bin shim living outside the checkout (`pnpm link --global`). */
const GLOBAL_SHIM = resolve("/home/dev/.local/share/pnpm/ndx");

/** A global npm install, as produced by `npm i -g @n-dx/core`. */
const NPM_CLI = resolve("/usr/local/lib/node_modules/@n-dx/core/cli.js");

describe("isUnderNodeModules", () => {
  it("detects a node_modules path segment", () => {
    expect(isUnderNodeModules(NPM_CLI)).toBe(true);
    expect(isUnderNodeModules("/a/node_modules/b/c.js")).toBe(true);
  });

  it("is false for a plain checkout", () => {
    expect(isUnderNodeModules(WORKSPACE_CLI)).toBe(false);
  });

  it("matches whole segments, not substrings", () => {
    // A checkout that merely has "node_modules" inside a directory *name* is
    // not an install — matching on substring would misclassify it.
    expect(isUnderNodeModules("/src/node_modules-experiments/cli.js")).toBe(false);
    expect(isUnderNodeModules("/src/my_node_modules/cli.js")).toBe(false);
  });
});

describe("findWorkspaceRoot", () => {
  it("walks up to the directory holding pnpm-workspace.yaml", () => {
    const deps = { existsSync: existsOnly([WORKSPACE_MARKER]) };
    expect(findWorkspaceRoot(join(WORKSPACE_ROOT, "packages", "core"), deps)).toBe(WORKSPACE_ROOT);
  });

  it("returns the start directory when the marker is already there", () => {
    const deps = { existsSync: existsOnly([WORKSPACE_MARKER]) };
    expect(findWorkspaceRoot(WORKSPACE_ROOT, deps)).toBe(WORKSPACE_ROOT);
  });

  it("returns null when no marker exists anywhere above", () => {
    const deps = { existsSync: () => false };
    expect(findWorkspaceRoot(join(WORKSPACE_ROOT, "packages", "core"), deps)).toBeNull();
  });

  it("terminates at the filesystem root", () => {
    // Guards the walk loop: a bad termination check would hang the CLI.
    const deps = { existsSync: () => false };
    expect(findWorkspaceRoot(sep, deps)).toBeNull();
  });
});

describe("classifyInstall", () => {
  const deps = { existsSync: existsOnly([WORKSPACE_MARKER]) };

  it("classifies a node_modules path as an npm install", () => {
    const result = classifyInstall({ cliPath: NPM_CLI, argvPath: "/usr/local/bin/ndx" }, deps);
    expect(result.kind).toBe(INSTALL_KIND.NPM);
    expect(result.label).toBe("npm registry install");
    // An npm install has no workspace root to report.
    expect(result.root).toBeNull();
  });

  it("classifies a directly invoked checkout as a workspace", () => {
    const result = classifyInstall({ cliPath: WORKSPACE_CLI, argvPath: WORKSPACE_CLI }, deps);
    expect(result.kind).toBe(INSTALL_KIND.WORKSPACE);
    expect(result.label).toBe("workspace checkout");
    expect(result.root).toBe(WORKSPACE_ROOT);
  });

  it("classifies a checkout reached through an outside bin shim as a link", () => {
    // Node leaves argv[1] as the symlink but realpaths import.meta.url, so the
    // two disagreeing is the only signal that a global shim was used.
    const result = classifyInstall(
      { cliPath: WORKSPACE_CLI, argvPath: GLOBAL_SHIM },
      deps,
    );
    expect(result.kind).toBe(INSTALL_KIND.LINK);
    expect(result.label).toBe("pnpm global link");
    expect(result.root).toBe(WORKSPACE_ROOT);
  });

  it("treats a shim inside the checkout as a workspace, not a link", () => {
    // node_modules/.bin inside the repo is a local install artifact, not a
    // global link — it still runs the checkout you are standing in.
    const result = classifyInstall(
      { cliPath: WORKSPACE_CLI, argvPath: join(WORKSPACE_ROOT, "node_modules", ".bin", "ndx") },
      deps,
    );
    expect(result.kind).toBe(INSTALL_KIND.WORKSPACE);
  });

  it("falls back to workspace when argv[1] is unavailable", () => {
    const result = classifyInstall({ cliPath: WORKSPACE_CLI, argvPath: null }, deps);
    expect(result.kind).toBe(INSTALL_KIND.WORKSPACE);
  });

  it("reports unknown outside node_modules with no workspace above", () => {
    const result = classifyInstall(
      { cliPath: "/opt/ndx/cli.js", argvPath: "/opt/ndx/cli.js" },
      { existsSync: () => false },
    );
    expect(result.kind).toBe(INSTALL_KIND.UNKNOWN);
    expect(result.root).toBeNull();
  });

  it("gives every kind a label", () => {
    for (const kind of Object.values(INSTALL_KIND)) {
      expect(INSTALL_KIND_LABELS[kind]).toBeTruthy();
    }
  });
});

describe("readGitIdentity", () => {
  /** Stub git returning canned output per subcommand. */
  function gitStub(responses) {
    return {
      runGit: (args) => {
        const key = args.join(" ");
        const value = responses[key];
        if (value instanceof Error) throw value;
        if (value === undefined) throw new Error(`unexpected git call: ${key}`);
        return value;
      },
    };
  }

  it("reports branch and short sha on a branch", () => {
    const deps = gitStub({
      "rev-parse --short HEAD": "a1b2c3d",
      "rev-parse --abbrev-ref HEAD": "main",
    });
    expect(readGitIdentity("/repo", deps)).toEqual({
      branch: "main",
      sha: "a1b2c3d",
      detached: false,
    });
  });

  it("reports detached when abbrev-ref is HEAD", () => {
    const deps = gitStub({
      "rev-parse --short HEAD": "a1b2c3d",
      "rev-parse --abbrev-ref HEAD": "HEAD",
    });
    expect(readGitIdentity("/repo", deps)).toEqual({
      branch: null,
      sha: "a1b2c3d",
      detached: true,
    });
  });

  it("returns null when git is missing or the dir is not a repo", () => {
    const deps = gitStub({ "rev-parse --short HEAD": new Error("ENOENT") });
    expect(readGitIdentity("/repo", deps)).toBeNull();
  });

  it("returns null when HEAD has no commits", () => {
    const deps = gitStub({ "rev-parse --short HEAD": "" });
    expect(readGitIdentity("/repo", deps)).toBeNull();
  });

  it("falls back to detached when only abbrev-ref fails", () => {
    const deps = gitStub({
      "rev-parse --short HEAD": "a1b2c3d",
      "rev-parse --abbrev-ref HEAD": new Error("boom"),
    });
    expect(readGitIdentity("/repo", deps)).toEqual({
      branch: null,
      sha: "a1b2c3d",
      detached: true,
    });
  });
});

describe("collectInstallIdentity", () => {
  const base = {
    version: "1.2.3",
    cliPath: WORKSPACE_CLI,
    projectDir: PROJECT_DIR,
    argvPath: WORKSPACE_CLI,
  };
  const deps = {
    existsSync: existsOnly([WORKSPACE_MARKER]),
    runGit: (args) =>
      args.join(" ") === "rev-parse --short HEAD" ? "a1b2c3d" : "main",
  };

  it("produces the documented JSON shape", () => {
    expect(collectInstallIdentity(base, deps)).toEqual({
      version: "1.2.3",
      cliPath: WORKSPACE_CLI,
      install: {
        kind: "workspace",
        label: "workspace checkout",
        root: WORKSPACE_ROOT,
      },
      git: { branch: "main", sha: "a1b2c3d", detached: false },
      projectDir: PROJECT_DIR,
    });
  });

  it("has exactly the documented top-level keys", () => {
    // The --json shape is a contract; a silent addition or rename breaks
    // anything parsing it.
    expect(Object.keys(collectInstallIdentity(base, deps)).sort()).toEqual([
      "cliPath",
      "git",
      "install",
      "projectDir",
      "version",
    ]);
  });

  it("skips git entirely for an npm install", () => {
    // An unpacked tarball has no history, so spawning git would be pure cost.
    let called = false;
    const info = collectInstallIdentity(
      { ...base, cliPath: NPM_CLI, argvPath: "/usr/local/bin/ndx" },
      {
        existsSync: () => false,
        runGit: () => {
          called = true;
          return "";
        },
      },
    );
    expect(info.git).toBeNull();
    expect(called).toBe(false);
  });

  it("reports null git for a checkout that is not a working tree", () => {
    const info = collectInstallIdentity(base, {
      existsSync: existsOnly([WORKSPACE_MARKER]),
      runGit: () => {
        throw new Error("not a git repository");
      },
    });
    expect(info.git).toBeNull();
    expect(info.install.kind).toBe(INSTALL_KIND.WORKSPACE);
  });
});

describe("formatGitIdentity", () => {
  it("renders branch and sha", () => {
    expect(formatGitIdentity({ branch: "main", sha: "a1b2c3d", detached: false }))
      .toBe("main @ a1b2c3d");
  });

  it("renders detached@sha", () => {
    expect(formatGitIdentity({ branch: null, sha: "a1b2c3d", detached: true }))
      .toBe("detached@a1b2c3d");
  });

  it("explains a missing git identity rather than printing nothing", () => {
    expect(formatGitIdentity(null)).toBe("not a git working tree");
  });
});

describe("formatInstallIdentity", () => {
  const info = {
    version: "1.2.3",
    cliPath: WORKSPACE_CLI,
    install: { kind: "workspace", label: "workspace checkout", root: WORKSPACE_ROOT },
    git: { branch: "main", sha: "a1b2c3d", detached: false },
    projectDir: PROJECT_DIR,
  };

  it("prints all five fields", () => {
    const lines = formatInstallIdentity(info).split("\n");
    expect(lines[0]).toBe("n-dx 1.2.3");
    expect(lines[1]).toContain(WORKSPACE_CLI);
    expect(lines[2]).toContain("workspace checkout");
    expect(lines[2]).toContain(WORKSPACE_ROOT);
    expect(lines[3]).toContain("main @ a1b2c3d");
    expect(lines[4]).toContain(PROJECT_DIR);
    expect(lines).toHaveLength(5);
  });

  it("omits the parenthesised root when there is none", () => {
    const npm = {
      ...info,
      install: { kind: "npm", label: "npm registry install", root: null },
      git: null,
    };
    const out = formatInstallIdentity(npm);
    expect(out).toContain("install  npm registry install");
    expect(out).not.toContain("()");
  });
});

// ---------------------------------------------------------------------------
// The `ndx work` identity line
// ---------------------------------------------------------------------------

describe("formatBranchField", () => {
  it("names the branch, or the detached commit when there is none", () => {
    expect(formatBranchField({ branch: "main", sha: "a1b2c3d", detached: false })).toBe("main");
    expect(formatBranchField({ branch: null, sha: "a1b2c3d", detached: true })).toBe("detached@a1b2c3d");
  });

  it("is null outside a working tree, so the caller can drop the segment", () => {
    expect(formatBranchField(null)).toBeNull();
  });
});

describe("formatWorkIdentityLine", () => {
  const BASE = {
    version: "0.6.0",
    cliPath: WORKSPACE_CLI,
    projectDir: WORKSPACE_ROOT,
  };

  it("is one line: version, cli, project, branch", () => {
    const line = formatWorkIdentityLine({ ...BASE, git: { branch: "feature/x", sha: "a1b2c3d", detached: false } });
    expect(line).toBe(`ndx 0.6.0 \u00B7 ${WORKSPACE_CLI} \u00B7 ${WORKSPACE_ROOT} \u00B7 feature/x`);
    // One line is the contract — the dashboard shows the last line of stdout
    // as its live status hint.
    expect(line).not.toContain("\n");
  });

  it("drops the branch segment outside a working tree rather than filling it", () => {
    const line = formatWorkIdentityLine({ ...BASE, git: null });
    expect(line).toBe(`ndx 0.6.0 \u00B7 ${WORKSPACE_CLI} \u00B7 ${WORKSPACE_ROOT}`);
    expect(line).not.toMatch(/\u00B7\s*$/);
    // Omitting `git` entirely is the same case.
    expect(formatWorkIdentityLine(BASE)).toBe(line);
  });

  it("names a detached HEAD by its commit", () => {
    expect(formatWorkIdentityLine({ ...BASE, git: { branch: null, sha: "9f8e7d6", detached: true } }))
      .toContain("\u00B7 detached@9f8e7d6");
  });

  it("resolves the paths it is given", () => {
    const line = formatWorkIdentityLine({ version: "0.6.0", cliPath: "cli.js", projectDir: "." });
    expect(line).toContain(resolve("cli.js"));
    expect(line).toContain(resolve("."));
  });
});

describe("shouldPrintWorkIdentity", () => {
  it("prints for an ordinary run, and for a dry run — which is mostly about which n-dx would run", () => {
    expect(shouldPrintWorkIdentity([])).toBe(true);
    expect(shouldPrintWorkIdentity(["--auto", "."])).toBe(true);
    expect(shouldPrintWorkIdentity(["--dry-run", "."])).toBe(true);
  });

  it("stays silent where the output is parsed rather than read", () => {
    expect(shouldPrintWorkIdentity(["--format=json", "."])).toBe(false);
    expect(shouldPrintWorkIdentity(["--quiet", "."])).toBe(false);
    expect(shouldPrintWorkIdentity(["-q", "."])).toBe(false);
  });

  it("does not mistake another format, or a path that merely contains a flag name", () => {
    expect(shouldPrintWorkIdentity(["--format=text", "."])).toBe(true);
    expect(shouldPrintWorkIdentity(["/repos/--quiet-project"])).toBe(true);
  });
});
