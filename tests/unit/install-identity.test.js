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
import { sep } from "node:path";
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
} from "../../packages/core/install-identity.js";

/** Build an existsSync stub that reports exactly `paths` as present. */
function existsOnly(paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

/** A workspace checkout laid out the way this monorepo is. */
const WORKSPACE_ROOT = "/home/dev/n-dx";
const WORKSPACE_CLI = `${WORKSPACE_ROOT}/packages/core/cli.js`;
const WORKSPACE_MARKER = `${WORKSPACE_ROOT}/pnpm-workspace.yaml`;

/** A global npm install, as produced by `npm i -g @n-dx/core`. */
const NPM_CLI = "/usr/local/lib/node_modules/@n-dx/core/cli.js";

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
    expect(findWorkspaceRoot(`${WORKSPACE_ROOT}/packages/core`, deps)).toBe(WORKSPACE_ROOT);
  });

  it("returns the start directory when the marker is already there", () => {
    const deps = { existsSync: existsOnly([WORKSPACE_MARKER]) };
    expect(findWorkspaceRoot(WORKSPACE_ROOT, deps)).toBe(WORKSPACE_ROOT);
  });

  it("returns null when no marker exists anywhere above", () => {
    const deps = { existsSync: () => false };
    expect(findWorkspaceRoot(`${WORKSPACE_ROOT}/packages/core`, deps)).toBeNull();
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
      { cliPath: WORKSPACE_CLI, argvPath: "/home/dev/.local/share/pnpm/ndx" },
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
      { cliPath: WORKSPACE_CLI, argvPath: `${WORKSPACE_ROOT}/node_modules/.bin/ndx` },
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
    projectDir: "/home/dev/app",
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
      projectDir: "/home/dev/app",
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
    projectDir: "/home/dev/app",
  };

  it("prints all five fields", () => {
    const lines = formatInstallIdentity(info).split("\n");
    expect(lines[0]).toBe("n-dx 1.2.3");
    expect(lines[1]).toContain(WORKSPACE_CLI);
    expect(lines[2]).toContain("workspace checkout");
    expect(lines[2]).toContain(WORKSPACE_ROOT);
    expect(lines[3]).toContain("main @ a1b2c3d");
    expect(lines[4]).toContain("/home/dev/app");
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
