/**
 * Hub-mode helpers in packages/core/web.js: the pure pieces (porcelain parse,
 * slug, id derivation) and resolveRepo against a real repository with a
 * linked worktree — the case the hub exists for.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deriveProjectId,
  loadHubPort,
  parseMainWorktree,
  readHubRegistry,
  resolveRepo,
  slugifyProjectId,
} from "../../packages/core/web.js";

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

describe("parseMainWorktree", () => {
  it("returns the first worktree entry — git lists the main one first", () => {
    const out = "worktree /repos/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /repos/side\nHEAD def\ndetached\n";
    expect(parseMainWorktree(out)).toBe("/repos/main");
    expect(parseMainWorktree("")).toBeNull();
    expect(parseMainWorktree("HEAD abc\n")).toBeNull();
  });
});

describe("slugifyProjectId", () => {
  it("lowercases, replaces unsafe runs with one dash, trims edges, never empty", () => {
    expect(slugifyProjectId("My App")).toBe("my-app");
    expect(slugifyProjectId("  @scope/pkg!!name  ")).toBe("scope-pkg-name");
    expect(slugifyProjectId("v1.2.3_rc")).toBe("v1.2.3_rc");
    expect(slugifyProjectId("---")).toBe("project");
    expect(slugifyProjectId(undefined)).toBe("project");
  });
});

describe("deriveProjectId", () => {
  const registry = { app: { id: "app", repoRoot: "/repos/other-app" } };

  it("uses the bare slug when the registry is empty or holds the same repository", () => {
    expect(deriveProjectId("App", { repoRoot: "/repos/app", remoteUrl: null, registryProjects: {} })).toBe("app");
    expect(deriveProjectId("App", { repoRoot: "/repos/other-app", remoteUrl: null, registryProjects: registry })).toBe("app");
  });

  it("appends a 6-hex hash only when the slug is taken by a different repository", () => {
    const id = deriveProjectId("App", { repoRoot: "/repos/app", remoteUrl: "git@host:org/app.git", registryProjects: registry });
    expect(id).toMatch(/^app-[0-9a-f]{6}$/);
    // Deterministic — the same remote yields the same id next time.
    expect(deriveProjectId("App", { repoRoot: "/repos/app", remoteUrl: "git@host:org/app.git", registryProjects: registry })).toBe(id);
    // Without a remote the path stands in.
    expect(deriveProjectId("App", { repoRoot: "/repos/app", remoteUrl: null, registryProjects: registry })).toMatch(/^app-[0-9a-f]{6}$/);
  });
});

describe("hub home files", () => {
  let home;
  beforeAll(() => { home = mkdtempSync(join(tmpdir(), "ndx-hub-home-unit-")); });
  afterAll(() => { rmSync(home, { recursive: true, force: true }); });

  it("loadHubPort defaults to 3117 and honours config.json hub.port", async () => {
    expect(await loadHubPort(home)).toBe(3117);
    writeFileSync(join(home, "config.json"), JSON.stringify({ hub: { port: 4242 } }));
    expect(await loadHubPort(home)).toBe(4242);
    writeFileSync(join(home, "config.json"), "{ nope");
    expect(await loadHubPort(home)).toBe(3117);
  });

  it("readHubRegistry is empty when absent and returns the projects map otherwise", async () => {
    expect(await readHubRegistry(home)).toEqual({});
    writeFileSync(join(home, "hub.json"), JSON.stringify({ version: 1, projects: { a: { id: "a", repoRoot: "/r" } } }));
    expect(await readHubRegistry(home)).toEqual({ a: { id: "a", repoRoot: "/r" } });
  });
});

describe("resolveRepo", () => {
  let tmpRoot;
  let repo;
  let linked;
  let plain;

  beforeAll(() => {
    tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-resolve-repo-")));
    repo = join(tmpRoot, "main");
    mkdirSync(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
    git(repo, "commit", "--allow-empty", "--quiet", "-m", "root");
    git(repo, "remote", "add", "origin", "git@example.test:org/main.git");
    linked = join(tmpRoot, "linked");
    git(repo, "worktree", "add", "--quiet", "-b", "side", linked);
    plain = join(tmpRoot, "plain");
    mkdirSync(plain);
  });

  afterAll(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

  it("from the main checkout: repoRoot and worktree coincide", () => {
    expect(resolveRepo(repo)).toEqual({
      repoRoot: repo, worktree: repo, branch: "main", remoteUrl: "git@example.test:org/main.git", isRepo: true,
    });
  });

  it("from a linked worktree: repoRoot is the main checkout, worktree is the linked one", () => {
    const nested = join(linked, "a", "b");
    mkdirSync(nested, { recursive: true });
    for (const dir of [linked, nested]) {
      const resolved = resolveRepo(dir);
      expect(resolved.repoRoot).toBe(repo);
      expect(resolved.worktree).toBe(linked);
      expect(resolved.branch).toBe("side");
    }
  });

  it("outside a repository: the directory stands for itself", () => {
    expect(resolveRepo(plain)).toEqual({ repoRoot: plain, worktree: plain, branch: null, remoteUrl: null, isRepo: false });
  });
});
