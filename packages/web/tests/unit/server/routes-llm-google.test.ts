/**
 * Unit tests for Gemini (`google`) support in the /api/llm/config route.
 *
 * The dashboard's LLM Provider view previously offered only claude / codex /
 * local, even though the CLI has supported the `google` vendor for some time.
 * A user who ran `ndx config llm.vendor google` could not see or edit that
 * vendor's model settings in the dashboard, and `llm.google.*` values were
 * silently absent from the config response.
 *
 * These tests pin the three things that made google invisible:
 *   1. GET returns a `google` section reflecting `llm.google.*`
 *   2. PUT accepts `llm.google.model` / `llm.google.lightModel`
 *   3. PUT accepts `google` as a value for `llm.vendor`
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
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-google-"));
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

describe("GET /api/llm/config — google vendor", () => {
  it("returns a google section even when llm.google is absent", async () => {
    await writeConfig({ llm: { vendor: "claude" } });
    const res = await fetch(`${baseUrl}/api/llm/config`);
    const body = await res.json();
    expect(body.google).toEqual({ model: null, lightModel: null });
  });

  it("reflects configured llm.google.model and lightModel", async () => {
    await writeConfig({
      llm: {
        vendor: "google",
        google: { model: "gemini-2.5-pro", lightModel: "gemini-3.5-flash-lite" },
      },
    });
    const res = await fetch(`${baseUrl}/api/llm/config`);
    const body = await res.json();
    expect(body.vendor).toBe("google");
    expect(body.google).toEqual({
      model: "gemini-2.5-pro",
      lightModel: "gemini-3.5-flash-lite",
    });
  });

  it("does not leak the google API key into the response", async () => {
    await writeConfig({
      llm: { google: { model: "gemini-2.5-pro", api_key: "AIza-secret" } },
    });
    const res = await fetch(`${baseUrl}/api/llm/config`);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("AIza-secret");
  });
});

describe("PUT /api/llm/config — google vendor", () => {
  it("persists llm.google.model and llm.google.lightModel", async () => {
    await writeConfig({ llm: { vendor: "google" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.google.model": "gemini-3.7-flash",
          "llm.google.lightModel": "gemini-3.5-flash-lite",
        },
      }),
    });
    expect(res.status).toBe(200);
    const config = await readConfig();
    expect(config).toMatchObject({
      llm: {
        google: { model: "gemini-3.7-flash", lightModel: "gemini-3.5-flash-lite" },
      },
    });
  });

  it("accepts google as an llm.vendor value", async () => {
    await writeConfig({ llm: { vendor: "claude" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { "llm.vendor": "google" } }),
    });
    expect(res.status).toBe(200);
    const config = await readConfig();
    expect(config.llm).toMatchObject({ vendor: "google" });
  });

  it("still rejects an unknown vendor", async () => {
    await writeConfig({ llm: { vendor: "claude" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { "llm.vendor": "not-a-vendor" } }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("still rejects writes to the google api_key (auth fields are excluded)", async () => {
    await writeConfig({ llm: { vendor: "google" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { "llm.google.api_key": "AIza-injected" } }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const config = await readConfig();
    expect(JSON.stringify(config)).not.toContain("AIza-injected");
  });
});
