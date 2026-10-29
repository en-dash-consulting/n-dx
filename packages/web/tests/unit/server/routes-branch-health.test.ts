/**
 * `GET /api/branch-health` reads local facts unless asked with `?github=1`,
 * so the Workspaces board can open without a gh call per worktree.
 *
 * git runs for real in a temp repo; gh is a recording stub.
 *
 * @see packages/web/src/server/routes-branch-health.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec, type ExecOptions, type ExecResult } from "@n-dx/llm-client";
import type { ServerContext } from "../../../src/server/types.js";
import { handleBranchHealthRoute } from "../../../src/server/routes-branch-health.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

describe("GET /api/branch-health", () => {
  let dir: string;
  let started: RouteTestServer;
  let ghCalls: string[][];
  /** What `gh pr view` prints; null answers "no pull requests found". */
  let prJson: string | null;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "branch-health-route-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "a.txt"), "a\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    git("checkout", "-q", "-b", "feat");
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ web: { sidecarGithubReads: true } }));

    ghCalls = [];
    prJson = null;
    const run = async (cmd: string, args: string[], opts: ExecOptions): Promise<ExecResult> => {
      if (cmd !== "gh") return exec(cmd, args, opts);
      ghCalls.push(args);
      return prJson
        ? { stdout: prJson, stderr: "", exitCode: 0, error: null, launched: true }
        : { stdout: "", stderr: "no pull requests found", exitCode: 1, error: null, launched: true };
    };
    const ctx: ServerContext = { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir: join(dir, ".rex"), dev: false };
    started = await startRouteTestServer((req, res) => handleBranchHealthRoute(req, res, ctx, { exec: run }));
  });

  afterEach(async () => {
    await started.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers local facts with no gh call, and says GitHub facts are deferred", async () => {
    const res = await fetch(`${started.baseUrl}/api/branch-health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(ghCalls).toEqual([]);
    expect(body).toMatchObject({ branch: "feat", github: null, githubDeferred: true });
  });

  it("does not answer a target whose path only parses to /api/branch-health", async () => {
    // The route gate matches the raw path before `?`; `//x/api/branch-health`
    // is ungated there, so the route must not claim it either.
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: started.port, path: "//x/api/branch-health" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });

    expect(status).not.toBe(200);
    expect(ghCalls).toEqual([]);
  });

  it("reads GitHub facts when asked with ?github=1", async () => {
    const res = await fetch(`${started.baseUrl}/api/branch-health?github=1`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(ghCalls[0]?.slice(0, 2)).toEqual(["pr", "view"]);
    expect(body).toMatchObject({ githubDeferred: false });
    expect(body.githubReason).toContain("no pull requests found");
  });

  it("reuses the PR base a GitHub read found in later local-only answers", async () => {
    prJson = JSON.stringify({ number: 1, url: "u", baseRefName: "main", statusCheckRollup: [] });
    const read = await (await fetch(`${started.baseUrl}/api/branch-health?github=1`)).json();
    expect(read).toMatchObject({ base: "main", baseSource: "pr" });

    ghCalls = [];
    const local = await (await fetch(`${started.baseUrl}/api/branch-health`)).json();
    expect(ghCalls).toEqual([]);
    expect(local).toMatchObject({ base: "main", baseSource: "pr-cached", baseNote: null, githubDeferred: true });
  });
});
