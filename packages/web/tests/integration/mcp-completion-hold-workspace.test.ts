/**
 * The completion hold reaches the dashboard's HTTP MCP server, and only for
 * the workspace a request addressed (0.7.1 PR C2).
 *
 * An agent can reach rex over the dashboard's streamable-HTTP `/mcp/rex`
 * instead of stdio. That server lives in the `ndx start` process and inherits
 * nothing from the hench run, so the hold has to come from the run's claim in
 * the shared claims file. And the dashboard serves several worktrees from one
 * process, so a claim held by a run in worktree B must hold a completion asked
 * for through B's workspace, and not one asked for through the anchor's.
 *
 * This drives the real route (`handleMcpRoute`) with the same factory
 * `start.ts` wires, `(rctx) => createRexMcpServer(rctx.projectDir)`, over real
 * HTTP, against a real repository with a linked worktree. Resolving
 * `/w/<key>/` to the workspace's ctx is `workspace-slot-dispatch.test.ts`'s
 * subject; here each worktree's ctx is handed to its own route server, which is
 * what that resolution produces.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serializeFolderTree, SLUG_RULE_VERSION, TREE_META_FILENAME } from "@n-dx/rex";
import {
  createRexMcpServer,
  openClaimsStore,
  resolveClaimHolder,
  resolveStore,
  PRD_TREE_DIRNAME,
} from "../../src/server/rex-gateway.js";
import type { PRDItem } from "../../src/server/rex-gateway.js";
import type { ServerContext } from "../../src/server/types.js";
import { handleMcpRoute, closeAllMcpSessions, initMcpRoutes } from "../../src/server/routes-mcp.js";
import { closeRouteTestServer } from "../helpers/server-route-test-support.js";

const TASK = "task-held";
const ITEMS = [
  {
    id: "epic-1", title: "Epic", level: "epic", status: "in_progress",
    children: [{ id: TASK, title: "Held task", level: "task", status: "in_progress" }],
  },
] as PRDItem[];

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function ctxFor(dir: string): ServerContext {
  return { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir: join(dir, ".rex"), dev: false };
}

function startRouteServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (await handleMcpRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

async function completeOver(port: number): Promise<Record<string, unknown>> {
  const client = new Client({ name: "agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/rex`)));
  try {
    const result = await client.callTool({
      name: "update_task_status",
      arguments: { id: TASK, status: "completed", resolutionType: "code-change", resolutionDetail: "over HTTP" },
    });
    const [first] = result.content as Array<{ type: string; text: string }>;
    return JSON.parse(first.text);
  } finally {
    await client.close();
  }
}

async function statusIn(worktree: string): Promise<string | undefined> {
  return (await (await resolveStore(join(worktree, ".rex"))).getItem(TASK))?.status;
}

let root: string;
let anchor: string;
let branch: string;
let run: ChildProcess;
const servers: Server[] = [];

beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "web-mcp-hold-")));
  anchor = join(root, "app");
  mkdirSync(anchor);
  git(anchor, "init", "--quiet", "--initial-branch=main");
  await serializeFolderTree(ITEMS, join(anchor, ".rex", PRD_TREE_DIRNAME));
  writeFileSync(
    join(anchor, ".rex", TREE_META_FILENAME),
    JSON.stringify({ title: "Hold", schema: "rex/v1", slugRule: SLUG_RULE_VERSION }),
  );
  writeFileSync(join(anchor, ".rex", "config.json"), JSON.stringify({ schema: "rex/v1", project: "hold", adapter: "file" }));
  git(anchor, "add", "-A");
  git(anchor, "commit", "--quiet", "-m", "prd");
  branch = join(root, "app-feature");
  git(anchor, "worktree", "add", "--quiet", "-b", "feature", branch);

  // A hench run working the task in the linked worktree: a live pid holding
  // a completion-holding claim, exactly what TaskClaims writes.
  run = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  const claimed = await openClaimsStore(branch).claim(TASK, {
    worktreeRoot: resolveClaimHolder(branch).worktreeRoot,
    pid: run.pid!,
    holdsCompletion: true,
  });
  expect(claimed.ok).toBe(true);

  initMcpRoutes({
    rex: (rctx) => createRexMcpServer(rctx.projectDir),
    sv: () => new McpServer({ name: "sv-stub", version: "0.0.0" }),
  });
});

afterAll(async () => {
  await closeAllMcpSessions();
  for (const s of servers) await closeRouteTestServer(s);
  run?.kill();
  rmSync(root, { recursive: true, force: true });
});

describe("completion hold over the dashboard's HTTP MCP", () => {
  it("holds a completion asked for through the run's own workspace", async () => {
    const { server, port } = await startRouteServer(ctxFor(branch));
    servers.push(server);

    const body = await completeOver(port);

    expect(body.completionHeld).toBe(true);
    expect(await statusIn(branch)).toBe("in_progress");
    const [claim] = await openClaimsStore(branch).readClaims();
    expect(claim).toMatchObject({ pid: run.pid, pendingCompletion: { resolutionDetail: "over HTTP" } });
  });

  it("does not hold one asked for through another workspace — the claim's worktree must match", async () => {
    const { server, port } = await startRouteServer(ctxFor(anchor));
    servers.push(server);

    const body = await completeOver(port);

    expect(body.completionHeld).toBeUndefined();
    expect(body.newStatus).toBe("completed");
    expect(await statusIn(anchor)).toBe("completed");
    // The run's worktree is untouched.
    expect(await statusIn(branch)).toBe("in_progress");
  });
});
