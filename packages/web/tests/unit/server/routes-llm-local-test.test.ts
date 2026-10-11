/**
 * POST /api/llm/local-test — the Robot Wrangler "Test connection" button.
 * The result line names how many models the tested server lists, so the route
 * probes the same host and port the smoke test hits (unsaved edits included).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

let projectDir: string;
let dashboard: Server;
let fakeLlm: Server;
let dashboardUrl: string;
let llmPort: number;
let modelsStatus = 200;

function portOf(server: Server): number {
  const addr = server.address();
  return typeof addr === "object" && addr ? addr.port : 0;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

beforeEach(async () => {
  modelsStatus = 200;
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-local-test-"));
  fakeLlm = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") {
      res.writeHead(modelsStatus);
      res.end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }, { id: "c" }] }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }], usage: { completion_tokens: 2 } }));
  });
  dashboard = createServer((req, res) => {
    void handleLlmRoute(req, res, { projectDir } as never).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await Promise.all([listen(fakeLlm), listen(dashboard)]);
  llmPort = portOf(fakeLlm);
  dashboardUrl = `http://127.0.0.1:${portOf(dashboard)}`;
});

afterEach(async () => {
  await Promise.all([fakeLlm, dashboard].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  await rm(projectDir, { recursive: true, force: true });
});

async function test(body: unknown) {
  const res = await fetch(`${dashboardUrl}/api/llm/local-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/llm/local-test", () => {
  it("reports how many models the tested server lists", async () => {
    const result = await test({ host: "127.0.0.1", port: llmPort });
    expect(result).toMatchObject({ ok: true, reply: "OK", modelCount: 3 });
  });

  it("leaves the count null when the model list cannot be read", async () => {
    modelsStatus = 500;
    const result = await test({ host: "127.0.0.1", port: llmPort });
    expect(result).toMatchObject({ ok: true, modelCount: null });
  });

  it("reports the error and no count for an unreachable server", async () => {
    const closed = createServer();
    await listen(closed);
    const port = portOf(closed);
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const result = await test({ host: "127.0.0.1", port });
    expect(result).toMatchObject({ ok: false, modelCount: null });
    expect(typeof result.error).toBe("string");
  });
});
