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
import { handleGitRoute, parsePorcelainStatus, toGitignorePattern } from "../../../src/server/routes-git.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
  // core.autocrlf=true is the Git-for-Windows installer default (lands in
  // SYSTEM config, so it applies even without an explicit user setting):
  // a test writes LF, a later `git checkout`/`restore` hands it back as
  // CRLF, and byte-exact content assertions fail on content git restored
  // exactly as configured. Pin both off per-repo so those assertions are
  // deterministic across platforms. See packages/hench/tests/helpers/index.ts
  // GIT_FIXTURE_CONFIG for the same fix applied there.
  execSync("git config core.autocrlf false", { cwd: dir, stdio: "ignore" });
  execSync("git config core.eol lf", { cwd: dir, stdio: "ignore" });
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

describe("toGitignorePattern", () => {
  it("anchors the entry at the repository root", () => {
    expect(toGitignorePattern("src/scratch.txt")).toBe("/src/scratch.txt");
  });

  it("escapes glob metacharacters so the path is matched literally", () => {
    expect(toGitignorePattern("report[1].txt")).toBe("/report\\[1\\].txt");
    expect(toGitignorePattern("what?.log")).toBe("/what\\?.log");
    expect(toGitignorePattern("star*.tmp")).toBe("/star\\*.tmp");
  });

  it("escapes a trailing space, which git would otherwise strip", () => {
    expect(toGitignorePattern("trailing ")).toBe("/trailing\\ ");
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

  describe("POST /api/git/ignore", () => {
    async function postIgnore(file: unknown): Promise<Response> {
      return fetch(`http://127.0.0.1:${port}/api/git/ignore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
    }

    it("requires a file", async () => {
      initGitRepo(tmpDir);
      expect((await postIgnore("  ")).status).toBe(400);
    });

    it("rejects a path that escapes the project directory", async () => {
      initGitRepo(tmpDir);
      expect((await postIgnore("../../etc/passwd")).status).toBe(400);
    });

    it("refuses to ignore .gitignore itself", async () => {
      initGitRepo(tmpDir);
      expect((await postIgnore(".gitignore")).status).toBe(400);
    });

    it("creates .gitignore and drops the file out of the dirty list", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "README.md"), "hello\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "scratch.log"), "noise\n");

      const res = await postIgnore("scratch.log");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, pattern: "/scratch.log", added: true });

      expect(await readFile(join(tmpDir, ".gitignore"), "utf-8")).toBe("/scratch.log\n");

      // The file itself survives — only git's view of it changes.
      expect(await readFile(join(tmpDir, "scratch.log"), "utf-8")).toBe("noise\n");

      const status = await fetch(`http://127.0.0.1:${port}/api/git/status`);
      const paths = (await status.json()).files.map((f: { path: string }) => f.path);
      expect(paths).not.toContain("scratch.log");
      // .gitignore is itself new, so the tree stays dirty — correctly so.
      expect(paths).toContain(".gitignore");
    });

    it("ignores a path inside a subdirectory, anchored at the root", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "README.md"), "hello\n");
      commitAll(tmpDir, "init");
      await mkdir(join(tmpDir, "build"));
      await writeFile(join(tmpDir, "build", "out.js"), "x\n");

      const res = await postIgnore("build/out.js");
      expect(res.status).toBe(200);
      expect((await res.json()).pattern).toBe("/build/out.js");
      expect(await readFile(join(tmpDir, ".gitignore"), "utf-8")).toBe("/build/out.js\n");
    });

    it("appends to an existing .gitignore that has no trailing newline", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, ".gitignore"), "node_modules");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "scratch.log"), "noise\n");

      expect((await postIgnore("scratch.log")).status).toBe(200);
      expect(await readFile(join(tmpDir, ".gitignore"), "utf-8")).toBe("node_modules\n/scratch.log\n");
    });

    it("refuses a path that is already ignored", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, ".gitignore"), "# junk\nscratch.log\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "scratch.log"), "noise\n");

      // Already ignored, so git never reports it as untracked.
      expect((await postIgnore("scratch.log")).status).toBe(409);
      expect(await readFile(join(tmpDir, ".gitignore"), "utf-8")).toBe("# junk\nscratch.log\n");
    });

    it("does not duplicate an entry a human already wrote by hand", async () => {
      initGitRepo(tmpDir);
      // The negation makes the path untracked again, so the route runs —
      // and finds its own entry already there.
      await writeFile(join(tmpDir, ".gitignore"), "scratch.log\n!scratch.log\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "scratch.log"), "noise\n");

      const res = await postIgnore("scratch.log");
      expect(res.status).toBe(200);
      expect((await res.json()).added).toBe(false);
      expect(await readFile(join(tmpDir, ".gitignore"), "utf-8")).toBe("scratch.log\n!scratch.log\n");
    });

    it("refuses a tracked file, where .gitignore would do nothing", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "tracked.txt"), "v1\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "tracked.txt"), "v2\n");

      const res = await postIgnore("tracked.txt");
      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain("not untracked");
      await expect(readFile(join(tmpDir, ".gitignore"))).rejects.toThrow();
    });

    it("writes a literal entry for a path containing glob metacharacters", async () => {
      initGitRepo(tmpDir);
      await writeFile(join(tmpDir, "README.md"), "hello\n");
      commitAll(tmpDir, "init");
      await writeFile(join(tmpDir, "report[1].txt"), "noise\n");

      const res = await postIgnore("report[1].txt");
      expect(res.status).toBe(200);
      expect(await readFile(join(tmpDir, ".gitignore"), "utf-8")).toBe("/report\\[1\\].txt\n");

      const status = await fetch(`http://127.0.0.1:${port}/api/git/status`);
      const paths = (await status.json()).files.map((f: { path: string }) => f.path);
      expect(paths).not.toContain("report[1].txt");
    });
  });
});
