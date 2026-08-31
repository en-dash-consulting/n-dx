/**
 * Unit tests for task-routing config in the /api/llm/config route.
 *
 * The routing keys are parameterized — `llm.tiers.<vendor>.<tier>`,
 * `llm.routes.<class>`, `llm.effort.<class>` — so they cannot live in the
 * route's exact-match path allowlist. Two things have to hold: the dashboard
 * can write them at all, and a class name containing dots lands as one flat
 * key rather than nested objects. Nested config is silently ignored by the
 * flat-map extractor in `loadLLMConfig`, so a nesting bug would look like a
 * successful write that changes nothing.
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
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-routing-"));
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
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectDir, { recursive: true, force: true });
});

async function writeConfig(config: unknown): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function readConfig(): Promise<Record<string, never>> {
  return JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8"));
}

function put(changes: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/llm/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}

describe("PUT /api/llm/config — tier map", () => {
  beforeEach(async () => {
    await writeConfig({ llm: { vendor: "claude" } });
  });

  it("accepts a per-vendor tier model", async () => {
    const res = await put({ "llm.tiers.claude.light": "claude-haiku-4-5" });
    expect(res.status).toBe(200);

    const config = await readConfig();
    expect((config.llm as never as Record<string, never>).tiers).toEqual({
      claude: { light: "claude-haiku-4-5" },
    });
  });

  it("accepts the free tier, which has no built-in model", async () => {
    const res = await put({ "llm.tiers.local.free": "qwen2.5-coder-14b" });
    expect(res.status).toBe(200);
  });

  it("rejects an unknown vendor", async () => {
    const res = await put({ "llm.tiers.notavendor.light": "m" });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/vendor/i);
  });

  it("rejects an unknown tier", async () => {
    const res = await put({ "llm.tiers.claude.turbo": "m" });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/tier/i);
  });

  it("rejects a malformed tier path", async () => {
    const res = await put({ "llm.tiers.claude": "m" });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/llm/config — routes and effort", () => {
  beforeEach(async () => {
    await writeConfig({ llm: { vendor: "claude" } });
  });

  it("stores a dotted task class as one flat key, not nested objects", async () => {
    const res = await put({ "llm.routes.agent.execute": "heavy" });
    expect(res.status).toBe(200);

    const config = await readConfig();
    const llm = config.llm as never as Record<string, Record<string, unknown>>;
    expect(llm.routes).toEqual({ "agent.execute": "heavy" });
    // The nesting bug would produce { agent: { execute: "heavy" } }.
    expect(llm.routes.agent).toBeUndefined();
  });

  it("accepts a glob route key", async () => {
    const res = await put({ "llm.routes.prd.*": "standard" });
    expect(res.status).toBe(200);

    const config = await readConfig();
    const llm = config.llm as never as Record<string, Record<string, unknown>>;
    expect(llm.routes["prd.*"]).toBe("standard");
  });

  it("rejects a route value that is not a tier", async () => {
    const res = await put({ "llm.routes.prd.rename": "haiku" });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/light/);
  });

  it("stores an effort level per class", async () => {
    const res = await put({ "llm.effort.agent.execute": "high" });
    expect(res.status).toBe(200);

    const config = await readConfig();
    const llm = config.llm as never as Record<string, Record<string, unknown>>;
    expect(llm.effort).toEqual({ "agent.execute": "high" });
  });

  it("rejects an unknown effort level", async () => {
    const res = await put({ "llm.effort.agent.execute": "turbo" });
    expect(res.status).toBe(400);
  });

  it("deletes a flat-map entry without disturbing its siblings", async () => {
    await writeConfig({
      llm: { vendor: "claude", routes: { "agent.execute": "heavy", "prd.rename": "light" } },
    });

    const res = await put({ "llm.routes.agent.execute": null });
    expect(res.status).toBe(200);

    const config = await readConfig();
    const llm = config.llm as never as Record<string, Record<string, unknown>>;
    expect(llm.routes).toEqual({ "prd.rename": "light" });
  });
});

describe("PUT /api/llm/config — escalation and the model shorthand", () => {
  beforeEach(async () => {
    await writeConfig({ llm: { vendor: "claude" } });
  });

  it("accepts llm.model, the standard-tier shorthand", async () => {
    const res = await put({ "llm.model": "claude-opus-5" });
    expect(res.status).toBe(200);

    const config = await readConfig();
    expect((config.llm as never as Record<string, unknown>).model).toBe("claude-opus-5");
  });

  it("accepts escalation.enabled as a boolean", async () => {
    const res = await put({ "llm.escalation.enabled": true });
    expect(res.status).toBe(200);

    const config = await readConfig();
    const llm = config.llm as never as Record<string, Record<string, unknown>>;
    expect(llm.escalation.enabled).toBe(true);
  });

  it("stores escalation.maxSteps as a number", async () => {
    const res = await put({ "llm.escalation.maxSteps": "2" });
    expect(res.status).toBe(200);

    const config = await readConfig();
    const llm = config.llm as never as Record<string, Record<string, unknown>>;
    expect(llm.escalation.maxSteps).toBe(2);
  });

  it("accepts maxSteps of 0, which disables escalation without clearing config", async () => {
    const res = await put({ "llm.escalation.maxSteps": 0 });
    expect(res.status).toBe(200);
  });

  it("rejects a negative maxSteps", async () => {
    const res = await put({ "llm.escalation.maxSteps": -1 });
    expect(res.status).toBe(400);
  });

  it("still rejects an unknown path", async () => {
    const res = await put({ "llm.nonsense.key": "x" });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Unknown LLM config path/);
  });
});
