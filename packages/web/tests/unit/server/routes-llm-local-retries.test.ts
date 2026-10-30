/**
 * The llm.local retry settings on the LLM settings page: connection retries
 * (`maxRetries`, `retryBaseDelayMs`, `retryMaxDelayMs`) and malformed-output
 * resends (`maxFormatRetries`). GET reports them, PUT stores them as numbers,
 * 0 is accepted (it disables retrying) and a negative or fractional value is
 * refused — the same rule `ndx config` applies.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-local-retries-"));
  server = createServer((req, res) => {
    void handleLlmRoute(req, res, { projectDir } as never).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectDir, { recursive: true, force: true });
});

async function writeConfig(config: unknown): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8")) as Record<string, unknown>;
}

function put(changes: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/llm/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}

describe("llm.local retry settings", () => {
  it("GET reports them, null when unset", async () => {
    await writeConfig({ llm: { vendor: "local", local: { maxRetries: 10, maxFormatRetries: 0 } } });
    const body = await (await fetch(`${baseUrl}/api/llm/config`)).json() as { local: Record<string, unknown> };
    expect(body.local).toMatchObject({
      maxRetries: 10,
      retryBaseDelayMs: null,
      retryMaxDelayMs: null,
      maxFormatRetries: 0,
    });
  });

  it("PUT stores them as numbers, 0 included", async () => {
    await writeConfig({ llm: { vendor: "local" } });
    const res = await put({
      "llm.local.maxRetries": "10",
      "llm.local.retryBaseDelayMs": "3000",
      "llm.local.retryMaxDelayMs": "90000",
      "llm.local.maxFormatRetries": "0",
    });
    expect(res.status).toBe(200);
    expect((await readConfig())["llm"]).toMatchObject({
      local: { maxRetries: 10, retryBaseDelayMs: 3000, retryMaxDelayMs: 90000, maxFormatRetries: 0 },
    });
  });

  it.each(["-1", "1.5", "lots"])("PUT refuses %j", async (value) => {
    await writeConfig({ llm: { vendor: "local" } });
    const res = await put({ "llm.local.maxFormatRetries": value });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("non-negative integer");
  });
});
