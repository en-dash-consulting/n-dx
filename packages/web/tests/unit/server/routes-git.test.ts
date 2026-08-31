/**
 * Unit tests for the /api/git/{status,diff,commit} routes — the dashboard's
 * "don't leave the browser to commit" panel. Uses a real temporary git repo
 * (not a mocked `exec`) since the whole point of this route is correctly
 * shelling out to real git and parsing its real output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, execFileSync } from "node:child_process";
import type { Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleGitRoute, parsePorcelainStatus } from "../../../src/server/routes-git.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
  // Some environments default to "main"/"master" inconsistently — pin it so
  // --abbrev-ref HEAD assertions are stable across machines.
  execSync("git checkout -b main", { cwd: dir, stdio: "ignore" });
}

function commitAll(dir: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", message], { cwd: dir, stdio: "ignore" });
}

describe("parsePorcelainStatus", () => {
  it("classifies modified, added, deleted, untracked, and renamed entries", () => {
    const files = parsePorcelainStatus(
      [
        " M modified.txt",
        "A  added.txt",
        " D deleted.txt",
        "?? untracked.txt",
        "R  old.txt -> new.txt",
      ].join("\n"),
    );
    expect(files).toEqual([
      { path: "modified.txt", code: " M", status: "modified" },
      { path: "added.txt", code: "A ", status: "added" },
      { path: "deleted.txt", code: " D", status: "deleted" },
      { path: "untracked.txt", code: "??", status: "untracked" },
      { path: "new.txt", code: "R ", status: "renamed" },
    ]);
  });

  it("returns an empty array for empty output", () => {
    expect(parsePorcelainStatus("")).toEqual([]);
  });
});

describe("/api/git routes", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "git-routes-"));
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) => handleGitRoute(req, res, ctx));
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("GET /api/git/status", () => {
    it("reports isRepo: false outside a git repository", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/git/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ isRepo: false, branch: null, dirty: false, files: [] });
    });

    it("reports a clean tree after an initial commit", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "README.md"), "hello\n");
      commitAll(tmpDir, "init");

      const res = await fetch(`http://127.0.0.1:${port}/api/git/status`);
      const body = await res.json();
      expect(body.isRepo).toBe(true);
      expect(body.branch).toBe("main");
      expect(body.dirty).toBe(false);
      expect(body.files).toEqual([]);
    });

    it("lists dirty files: modified, new, and deleted", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "keep.txt"), "v1\n");
      await writeFile(join(tmpDir, "remove.txt"), "bye\n");
      commitAll(tmpDir, "init");

      await writeFile(join(tmpDir, "keep.txt"), "v2\n");
      await writeFile(join(tmpDir, "new.txt"), "new file\n");
      await rm(join(tmpDir, "remove.txt"));

      const res = await fetch(`http://127.0.0.1:${port}/api/git/status`);
      const body = await res.json();
      expect(body.dirty).toBe(true);
      const byPath = Object.fromEntries(body.files.map((f: { path: string; status: string }) => [f.path, f.status]));
      expect(byPath["keep.txt"]).toBe("modified");
      expect(byPath["new.txt"]).toBe("untracked");
      expect(byPath["remove.txt"]).toBe("deleted");
    });
  });

  describe("GET /api/git/diff", () => {
    it("requires a file query param", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/git/diff`);
      expect(res.status).toBe(400);
    });

    it("rejects a file path that escapes the project directory", async () => {
      initGitRepo(tmpDir);
      const res = await fetch(`http://127.0.0.1:${port}/api/git/diff?file=${encodeURIComponent("../../etc/passwd")}`);
      expect(res.status).toBe(400);
    });

    it("returns a real diff for a modified tracked file", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "a.txt"), "line1\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "a.txt"), "line1\nline2\n");

      const res = await fetch(`http://127.0.0.1:${port}/api/git/diff?file=a.txt`);
      const body = await res.json();
      expect(body.newFile).toBe(false);
      expect(body.diff).toContain("+line2");
    });

    it("returns a raw content preview for an untracked file", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "README.md"), "hello\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "brand-new.txt"), "fresh content\n");

      const res = await fetch(`http://127.0.0.1:${port}/api/git/diff?file=brand-new.txt`);
      const body = await res.json();
      expect(body.newFile).toBe(true);
      expect(body.preview).toBe("fresh content\n");
    });
  });

  describe("POST /api/git/commit", () => {
    it("requires a non-empty message", async () => {
      initGitRepo(tmpDir);
      const res = await fetch(`http://127.0.0.1:${port}/api/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "  " }),
      });
      expect(res.status).toBe(400);
    });

    it("stages everything dirty and commits, leaving the tree clean", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "a.txt"), "v1\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "a.txt"), "v2\n");
      await writeFile(join(tmpDir, "b.txt"), "new\n");

      const res = await fetch(`http://127.0.0.1:${port}/api/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Uncommitted changes before autonomous run" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.dirty).toBe(false);

      const log = execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: tmpDir, encoding: "utf-8" });
      expect(log.trim()).toBe("Uncommitted changes before autonomous run");

      const statusRes = await fetch(`http://127.0.0.1:${port}/api/git/status`);
      const statusBody = await statusRes.json();
      expect(statusBody.dirty).toBe(false);
    });

    it("returns 500 with no dirty files to commit", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "a.txt"), "v1\n");
      commitAll(tmpDir, "init");

      const res = await fetch(`http://127.0.0.1:${port}/api/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "nothing to commit" }),
      });
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/git/discard", () => {
    it("requires confirmCount", async () => {
      initGitRepo(tmpDir);
      const res = await fetch(`http://127.0.0.1:${port}/api/git/discard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("rejects a stale confirmCount that no longer matches the tree", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "a.txt"), "v1\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "a.txt"), "v2\n");
      await writeFile(join(tmpDir, "new.txt"), "new\n");

      const res = await fetch(`http://127.0.0.1:${port}/api/git/discard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCount: 1 }),
      });
      expect(res.status).toBe(409);

      // Nothing should have been touched.
      const content = await readFile(join(tmpDir, "a.txt"), "utf-8");
      expect(content).toBe("v2\n");
    });

    it("reverts modified tracked files and deletes untracked ones", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "keep.txt"), "v1\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "keep.txt"), "v2\n");
      await writeFile(join(tmpDir, "scratch.txt"), "scratch\n");
      await mkdir(join(tmpDir, "scratch-dir"));
      await writeFile(join(tmpDir, "scratch-dir", "inner.txt"), "inner\n");

      const res = await fetch(`http://127.0.0.1:${port}/api/git/discard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCount: 3 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.discarded).toBe(3);
      expect(body.dirty).toBe(false);

      const content = await readFile(join(tmpDir, "keep.txt"), "utf-8");
      expect(content).toBe("v1\n");
      await expect(readFile(join(tmpDir, "scratch.txt"))).rejects.toThrow();
      await expect(readFile(join(tmpDir, "scratch-dir", "inner.txt"))).rejects.toThrow();
    });

    it("reports discarded: 0 when the tree is already clean", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "a.txt"), "v1\n");
      commitAll(tmpDir, "init");

      const res = await fetch(`http://127.0.0.1:${port}/api/git/discard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCount: 0 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, discarded: 0, dirty: false });
    });

    it("does not touch gitignored files", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, ".gitignore"), "ignored.txt\n");
      await writeFile(join(tmpDir, "a.txt"), "v1\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "ignored.txt"), "secret\n");
      await writeFile(join(tmpDir, "a.txt"), "v2\n");

      const res = await fetch(`http://127.0.0.1:${port}/api/git/discard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCount: 1 }),
      });
      expect(res.status).toBe(200);

      const ignored = await readFile(join(tmpDir, "ignored.txt"), "utf-8");
      expect(ignored).toBe("secret\n");
    });
  });
});
