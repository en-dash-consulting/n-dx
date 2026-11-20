import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleAgentPromptRoute } from "../../../src/server/routes-agent-prompt.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (await handleAgentPromptRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

describe("agent prompt API routes", () => {
  let tmpDir: string;
  let server: Server;
  let port: number;
  const url = () => `http://127.0.0.1:${port}/api/agent-prompt`;
  const put = (body: unknown) => fetch(url(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agent-prompt-api-"));
    // The .ndx/ layout: the default file is .ndx/agent-prompt.md.
    await mkdir(join(tmpDir, ".ndx", "rex"), { recursive: true });
    const ctx: ServerContext = { projectDir: tmpDir, svDir: join(tmpDir, ".ndx", "sourcevision"), rexDir: join(tmpDir, ".ndx", "rex"), dev: false };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET answers an absent file as empty", async () => {
    const res = await fetch(url());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: ".ndx/agent-prompt.md",
      content: "",
      exists: false,
      bytes: 0,
      maxBytes: 32 * 1024,
      truncated: false,
      configured: false,
      warnings: [],
    });
  });

  it("GET serves the file and ignores a cache-busting query", async () => {
    await writeFile(join(tmpDir, ".ndx", "agent-prompt.md"), "Use pnpm.\n");
    const body = await (await fetch(`${url()}?_=1`)).json();
    expect(body).toMatchObject({ content: "Use pnpm.\n", exists: true, bytes: 10 });
  });

  it("PUT writes the file and answers the GET shape", async () => {
    const res = await put({ content: "Never edit dist/." });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ path: ".ndx/agent-prompt.md", content: "Never edit dist/.", exists: true });
    expect(await readFile(join(tmpDir, ".ndx", "agent-prompt.md"), "utf-8")).toBe("Never edit dist/.");
  });

  it("PUT writes where agent.promptFile points", async () => {
    await writeFile(join(tmpDir, ".ndx", "config.json"), JSON.stringify({ agent: { promptFile: "docs/agents.md" } }));
    const body = await (await put({ content: "x" })).json();
    expect(body).toMatchObject({ path: "docs/agents.md", configured: true });
    expect(existsSync(join(tmpDir, "docs", "agents.md"))).toBe(true);
  });

  it("PUT refuses content over the cap, a non-string, and a path outside the project", async () => {
    const tooLong = await put({ content: "x".repeat(32 * 1024 + 1) });
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toContain("limit is 32 KB");

    expect((await put({ content: 7 })).status).toBe(400);

    await writeFile(join(tmpDir, ".ndx", "config.json"), JSON.stringify({ agent: { promptFile: "../escape.md" } }));
    const escape = await put({ content: "x" });
    expect(escape.status).toBe(400);
    expect((await escape.json()).error).toContain("outside the project");
    expect(existsSync(join(tmpDir, "..", "escape.md"))).toBe(false);
  });

  it("answers 405 for another method and passes other paths on", async () => {
    expect((await fetch(url(), { method: "DELETE" })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${port}/api/agent-prompts`)).status).toBe(404);
  });
});
