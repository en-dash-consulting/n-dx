import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { resolveWorkspaceFromRoots } from "../../src/workspace-roots.js";

/**
 * resolveWorkspaceFromRoots against real repositories: whether two
 * directories are worktrees of one repository is git's answer, so no mock
 * can stand in for it (see git-worktree-helpers.test.ts).
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

const uri = (path: string) => pathToFileURL(path).href;

let tmpRoot: string;
/** Main checkout, with `.rex/`. */
let main: string;
/** Linked worktree with `.rex/`. */
let served: string;
/** Linked worktree on the new layout (`.ndx/rex/`). */
let ndxLayout: string;
/** Linked worktree without `.rex/`. */
let bare: string;
/** Unrelated repository without `.rex/`. */
let other: string;

beforeAll(() => {
  tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-workspace-roots-")));
  main = join(tmpRoot, "main");
  mkdirSync(main);
  git(main, "init", "--quiet", "--initial-branch=main");
  git(main, "commit", "--allow-empty", "--quiet", "-m", "root");
  mkdirSync(join(main, ".rex"));

  served = join(tmpRoot, "served");
  git(main, "worktree", "add", "--quiet", "-b", "served", served);
  mkdirSync(join(served, ".rex"));
  mkdirSync(join(served, "src", "deep"), { recursive: true });

  ndxLayout = join(tmpRoot, "ndx-layout");
  git(main, "worktree", "add", "--quiet", "-b", "ndx-layout", ndxLayout);
  mkdirSync(join(ndxLayout, ".ndx", "rex"), { recursive: true });

  bare = join(tmpRoot, "bare");
  git(main, "worktree", "add", "--quiet", "-b", "bare", bare);

  other = join(tmpRoot, "other");
  mkdirSync(other);
  git(other, "init", "--quiet", "--initial-branch=main");
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

const resolveFor = (...roots: string[]) =>
  resolveWorkspaceFromRoots({ roots: roots.map((u) => ({ uri: u })), startupDir: main, marker: "rexDir" });

describe("resolveWorkspaceFromRoots", () => {
  it("serves a worktree root that has the marker", () => {
    expect(resolveFor(uri(served))).toEqual({ dir: served, source: "roots" });
  });

  it("serves a worktree on the .ndx/ layout", () => {
    expect(resolveFor(uri(ndxLayout))).toEqual({ dir: ndxLayout, source: "roots" });
  });

  it("widens a subdirectory root to its worktree's toplevel", () => {
    expect(resolveFor(uri(join(served, "src", "deep")))).toEqual({ dir: served, source: "roots" });
  });

  it("ignores non-file URIs", () => {
    expect(resolveFor("https://example.com/repo", uri(served))).toEqual({ dir: served, source: "roots" });
    expect(resolveFor("https://example.com/repo")).toEqual({ dir: main, source: "startup" });
  });

  it("ignores roots that do not exist", () => {
    expect(resolveFor(uri(join(tmpRoot, "missing")))).toEqual({ dir: main, source: "startup" });
  });

  it("ignores an unrelated repository without the marker", () => {
    expect(resolveFor(uri(other))).toEqual({ dir: main, source: "startup" });
  });

  it("refuses a same-repository worktree without the marker, naming both paths", () => {
    const result = resolveFor(uri(bare));
    expect(result.dir).toBe(main);
    expect(result.source).toBe("startup");
    expect(result.refused).toContain(bare);
    expect(result.refused).toContain(main);
  });

  it("keeps the startup dir when the root is the startup dir", () => {
    expect(resolveFor(uri(main))).toEqual({ dir: main, source: "startup" });
  });

  it("lets the first decisive root win", () => {
    expect(resolveFor(uri(main), uri(served))).toEqual({ dir: main, source: "startup" });
    expect(resolveFor(uri(other), uri(served))).toEqual({ dir: served, source: "roots" });
  });

  it("keeps the startup dir with no roots", () => {
    expect(resolveFor()).toEqual({ dir: main, source: "startup" });
  });
});
