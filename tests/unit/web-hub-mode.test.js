/**
 * Hub-mode helpers in packages/core/web.js: the pure pieces (porcelain parse,
 * slug, id derivation) and resolveRepo against a real repository with a
 * linked worktree — the case the hub exists for.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform, tmpdir } from "node:os";
import {
  deriveProjectId,
  ensureAuthTokenFile,
  hubAuthMismatchMessage,
  hubAuthState,
  hubDashboardUrl,
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


describe("hubAuthState", () => {
  /** A probe stub: `/api/hub/health` answers one way anonymously, another with the token. */
  const probe = (anonymous, credentialed) => (_port, _method, _path, _body, _timeout, opts = {}) =>
    Promise.resolve(opts.sendToken === false ? anonymous : credentialed);

  const ok = { status: 200, body: { ok: true } };
  const unauthorized = { status: 401, body: { error: "Unauthorized" } };
  const unreachable = { status: 0, body: null };

  it("calls a hub that answers an anonymous probe open", async () => {
    // It served health to a caller with no credential at all; every project it
    // takes on is served the same way.
    expect(await hubAuthState(3117, probe(ok, ok))).toBe("open");
  });

  it("calls a hub that refuses the anonymous probe but accepts ours a token hub", async () => {
    expect(await hubAuthState(3117, probe(unauthorized, ok))).toBe("token");
  });

  it("reports a mismatch when the hub wants a token but not the one we hold", async () => {
    // A hub started from another token file, or one rotated since. Reusing it
    // would fail at registration with a bare 401 and no explanation.
    expect(await hubAuthState(3117, probe(unauthorized, unauthorized))).toBe("mismatch");
  });

  it("reports absent when nothing answers", async () => {
    expect(await hubAuthState(3117, probe(unreachable, unreachable))).toBe("absent");
    // A 200 that is not the health payload is not a hub either.
    expect(await hubAuthState(3117, probe({ status: 200, body: null }, ok))).toBe("absent");
  });
});

describe("hubAuthMismatchMessage", () => {
  it("names the exposure when an open hub would serve an authenticated project", () => {
    const msg = hubAuthMismatchMessage("open", "token", 3117, "/home/u/.ndx/auth.token");
    expect(msg).toContain("without authentication");
    expect(msg).toContain("ndx hub stop");
    // The way out that does not require stopping anything is stated too.
    expect(msg).toContain("--no-auth");
  });

  it("explains the other direction without implying an exposure", () => {
    const msg = hubAuthMismatchMessage("token", "open", 3117, null);
    expect(msg).toContain("requires the per-user token");
    expect(msg).toContain("ndx hub stop");
    expect(msg).not.toContain("would serve this project unauthenticated");
  });

  it("names the token file when the hub holds a different one", () => {
    expect(hubAuthMismatchMessage("mismatch", "token", 3117, "/home/u/.ndx/auth.token"))
      .toContain("/home/u/.ndx/auth.token");
  });
});

describe("hubDashboardUrl", () => {
  it("carries the token so --open and the printed URL cannot diverge", () => {
    expect(hubDashboardUrl(3117, "my app", "tok/en")).toBe(
      "http://localhost:3117/p/my%20app/?ndx_token=tok%2Fen",
    );
  });

  it("is the plain URL when there is no token", () => {
    expect(hubDashboardUrl(3117, "alpha", null)).toBe("http://localhost:3117/p/alpha/");
  });
});

describe("ensureAuthTokenFile", () => {
  let home;
  beforeAll(() => { home = mkdtempSync(join(tmpdir(), "ndx-token-")); });
  afterAll(() => { rmSync(home, { recursive: true, force: true }); });

  it("creates the token once and never rotates it", () => {
    const path = join(home, "create.token");
    const first = ensureAuthTokenFile(path);
    expect(first).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(ensureAuthTokenFile(path)).toBe(first);
  });

  it.skipIf(platform() === "win32")("repairs the mode of a token that is readable by others", () => {
    // The exposure the token exists to prevent, left behind by an older n-dx,
    // an editor, or a restored backup. Creating the file 0600 does nothing for
    // one that already exists, so it stayed 0644 for good.
    const path = join(home, "loose.token");
    writeFileSync(path, "pre-existing-token\n");
    chmodSync(path, 0o644);

    expect(ensureAuthTokenFile(path)).toBe("pre-existing-token");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
