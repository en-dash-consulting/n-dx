/**
 * POST /api/llm/local-test — the Robot Wrangler "Test connection" button.
 * The result line names how many models the tested server lists, so the route
 * probes the same host and port the smoke test hits (unsaved edits included).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function post(path: string, body: unknown, method = "POST"): Promise<Response> {
  return fetch(`${dashboardUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function test(body: unknown) {
  const res = await post("/api/llm/local-test", body);
  return res.json() as Promise<Record<string, unknown>>;
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: string };
  return body.error ?? "";
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

  // The route splices host and port into `http://${host}:${port}/v1/…`, so a
  // host carrying a path, credentials or a second port would address a
  // different URL than the one it names. Refuse the shape; do not fetch.
  it.each([
    ["127.0.0.1/x?", "a path and query"],
    ["u@127.0.0.1", "credentials"],
    ["localhost:9999", "a second port"],
    ["a b", "whitespace"],
  ])("answers 400 and does not fetch for host %j (%s)", async (host) => {
    const res = await post("/api/llm/local-test", { host, port: llmPort });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("Invalid LLM host");
  });

  it.each([70000, 1.5, 0, -1, "1234"])("answers 400 for port %j", async (port) => {
    const res = await post("/api/llm/local-test", { host: "127.0.0.1", port });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("Invalid LLM port");
  });

  it.each(["localhost", "127.0.0.1", "[::1]", "gpu-box.lan"])(
    "accepts host %j and runs the test against it",
    async (host) => {
      // Only 127.0.0.1 has a server behind it here; the others may fail to
      // connect or resolve, which is a 200 with ok:false, never a refusal.
      const res = await post("/api/llm/local-test", { host, port: llmPort });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(typeof body.ok).toBe("boolean");
    },
  );

  it("refuses a saved host it would otherwise splice into the URL", async () => {
    await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { local: { host: "127.0.0.1/x?", port: llmPort } } }));
    const res = await post("/api/llm/local-test", {});
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("Invalid LLM host");
  });
});

describe("POST /api/llm/local-profiles", () => {
  it("answers 400 for a host that is not a plain hostname, and stores nothing", async () => {
    const res = await post("/api/llm/local-profiles", { name: "box", host: "u@127.0.0.1", port: 1234 });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("Invalid LLM host");
    const list = await fetch(`${dashboardUrl}/api/llm/local-profiles`);
    expect(await list.json()).toEqual({ profiles: [] });
  });

  it("answers 400 for a port outside TCP's range", async () => {
    const res = await post("/api/llm/local-profiles", { name: "box", host: "127.0.0.1", port: 70000 });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain("Invalid LLM port");
  });

  it("stores a plain host and port, defaulting the port when it is absent", async () => {
    const res = await post("/api/llm/local-profiles", { name: "box", host: "gpu-box.lan" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profiles: [{ name: "box", host: "gpu-box.lan", port: 1234, model: "" }] });
  });
});

describe("GET /api/llm/local-status", () => {
  it("reports a saved host that fails the shape check instead of probing it", async () => {
    await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { local: { host: "127.0.0.1/x?", port: llmPort } } }));
    const res = await fetch(`${dashboardUrl}/api/llm/local-status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, url: "", models: [] });
    expect(body.error).toContain("Invalid LLM host");
  });

  it("probes a saved host that passes it", async () => {
    await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { local: { host: "127.0.0.1", port: llmPort } } }));
    const res = await fetch(`${dashboardUrl}/api/llm/local-status`);
    expect(await res.json()).toMatchObject({ ok: true, models: ["a", "b", "c"] });
  });
});

describe("PUT /api/llm/config — llm.local.host", () => {
  it("refuses a host that is not a plain hostname", async () => {
    const res = await post("/api/llm/config", { changes: { "llm.local.host": "127.0.0.1/x?" } }, "PUT");
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain('"llm.local.host"');
  });

  it("saves a LAN hostname and still clears the key with an empty string", async () => {
    expect((await post("/api/llm/config", { changes: { "llm.local.host": "gpu-box.lan" } }, "PUT")).status).toBe(200);
    expect((await post("/api/llm/config", { changes: { "llm.local.host": "" } }, "PUT")).status).toBe(200);
  });
});
