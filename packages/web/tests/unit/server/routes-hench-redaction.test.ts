import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, closeWorktreeRunWatchers } from "../../../src/server/routes-hench.js";
import { startRouteTestServer, closeRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

const GITHUB = "ghp_" + "r".repeat(36);

let projectDir: string;
let server: RouteTestServer;

beforeAll(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "hench-route-redact-"));
  const runsDir = join(projectDir, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  mkdirSync(join(projectDir, ".rex"), { recursive: true });
  // A record written by an older hench, before save-time scrubbing existed.
  writeFileSync(join(runsDir, "run-old.json"), JSON.stringify({
    id: "run-old",
    taskId: "task-1",
    taskTitle: "Old run",
    startedAt: "2026-09-01T10:00:00.000Z",
    finishedAt: "2026-09-01T10:01:00.000Z",
    status: "completed",
    turns: 1,
    tokenUsage: { input: 10, output: 20 },
    toolCalls: [{ turn: 1, tool: "run_command", input: { command: "env" }, output: `GH_TOKEN=${GITHUB}\nHOME=/home/x`, durationMs: 1 }],
    model: "sonnet",
    summary: "printed the environment",
  }));
  const ctx: ServerContext = { projectDir, svDir: join(projectDir, ".sourcevision"), rexDir: join(projectDir, ".rex"), dev: false };
  server = await startRouteTestServer((req, res) => handleHenchRoute(req, res, ctx, (() => {}) as never));
});

afterAll(async () => {
  closeWorktreeRunWatchers();
  await closeRouteTestServer(server.server);
  rmSync(projectDir, { recursive: true, force: true });
});

describe("run detail route", () => {
  it("scrubs credential-shaped text from records written before save-time redaction", async () => {
    const res = await fetch(`${server.baseUrl}/api/hench/runs/run-old`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(GITHUB);
    expect(text).toContain("GH_TOKEN=[redacted:token]");
    expect(text).toContain("HOME=/home/x");
  });
});
