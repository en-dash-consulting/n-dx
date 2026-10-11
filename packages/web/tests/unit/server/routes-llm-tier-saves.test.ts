/**
 * Unit tests for Heavy and Free tier model saves in PUT /api/llm/config.
 *
 * The task requires:
 * - Saving a heavy model for claude writes `llm.tiers.claude.heavy` to .n-dx.json
 * - A Codex model id for the claude heavy tier is rejected with a message
 * - Saving an empty value removes the key
 * - GET reports the saved tier with its source
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
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-tier-saves-"));
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

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8")) as Record<string, unknown>;
}

describe("PUT /api/llm/config — tier saves", () => {
  it("saves a heavy model for claude", async () => {
    await writeConfig({ llm: { vendor: "claude" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.tiers.claude.heavy": "claude-opus-4-1",
        },
      }),
    });
    expect(res.status).toBe(200);
    const config = await readConfig();
    expect(config).toMatchObject({
      llm: {
        vendor: "claude",
        tiers: {
          claude: { heavy: "claude-opus-4-1" },
        },
      },
    });
  });

  it("saves a free model for claude", async () => {
    await writeConfig({ llm: { vendor: "claude" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.tiers.claude.free": "claude-3-5-haiku",
        },
      }),
    });
    expect(res.status).toBe(200);
    const config = await readConfig();
    expect(config).toMatchObject({
      llm: {
        tiers: {
          claude: { free: "claude-3-5-haiku" },
        },
      },
    });
  });

  it("rejects a non-claude model id for claude heavy tier", async () => {
    await writeConfig({ llm: { vendor: "claude" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.tiers.claude.heavy": "gpt-4-turbo",
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    expect(text).toContain("not a claude model");
  });

  it("removes the key when given empty value", async () => {
    await writeConfig({
      llm: {
        vendor: "claude",
        tiers: { claude: { heavy: "claude-opus-4-1" } },
      },
    });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.tiers.claude.heavy": "",
        },
      }),
    });
    expect(res.status).toBe(200);
    const config = await readConfig();
    const llm = config.llm as Record<string, unknown> | undefined;
    const tiers = llm?.tiers as Record<string, unknown> | undefined;
    const claude = tiers?.claude as Record<string, unknown> | undefined;
    expect(claude?.heavy).toBeUndefined();
  });

  it("removes the key when given null value", async () => {
    await writeConfig({
      llm: {
        vendor: "claude",
        tiers: { claude: { heavy: "claude-opus-4-1" } },
      },
    });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.tiers.claude.heavy": null,
        },
      }),
    });
    expect(res.status).toBe(200);
    const config = await readConfig();
    const llm = config.llm as Record<string, unknown> | undefined;
    const tiers = llm?.tiers as Record<string, unknown> | undefined;
    const claude = tiers?.claude as Record<string, unknown> | undefined;
    expect(claude?.heavy).toBeUndefined();
  });

  it("GET reports the saved heavy tier with its source", async () => {
    await writeConfig({
      llm: {
        vendor: "claude",
        tiers: { claude: { heavy: "claude-opus-4-1" } },
      },
    });
    const res = await fetch(`${baseUrl}/api/llm/config`);
    const data = await res.json() as { tiers?: Array<{ tier?: string; source?: string; model?: string }> };
    expect(res.status).toBe(200);
    expect(data.tiers).toBeDefined();
    const heavyTier = data.tiers?.find((row) => row.tier === "heavy");
    expect(heavyTier).toBeDefined();
    expect(heavyTier?.source).toBe("llm.tiers.claude.heavy");
    expect(heavyTier?.model).toBe("claude-opus-4-1");
  });

  it("accepts any model id for local vendor", async () => {
    await writeConfig({ llm: { vendor: "local" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.tiers.local.heavy": "my-local-model-xyz",
        },
      }),
    });
    expect(res.status).toBe(200);
    const config = await readConfig();
    expect(config).toMatchObject({
      llm: {
        tiers: {
          local: { heavy: "my-local-model-xyz" },
        },
      },
    });
  });

  it("accepts valid codex model for codex vendor", async () => {
    await writeConfig({ llm: { vendor: "codex" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.tiers.codex.heavy": "gpt-4-turbo",
        },
      }),
    });
    expect(res.status).toBe(200);
    const config = await readConfig();
    expect(config).toMatchObject({
      llm: {
        tiers: {
          codex: { heavy: "gpt-4-turbo" },
        },
      },
    });
  });

  it("rejects invalid model for codex vendor", async () => {
    await writeConfig({ llm: { vendor: "codex" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.tiers.codex.heavy": "claude-opus-4-1",
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("allows saving multiple tiers at once", async () => {
    await writeConfig({ llm: { vendor: "claude" } });
    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: {
          "llm.tiers.claude.heavy": "claude-opus-4-1",
          "llm.tiers.claude.free": "claude-3-5-haiku",
        },
      }),
    });
    expect(res.status).toBe(200);
    const config = await readConfig();
    const llm = config.llm as Record<string, unknown> | undefined;
    const tiers = llm?.tiers as Record<string, unknown> | undefined;
    const claude = tiers?.claude as Record<string, unknown> | undefined;
    expect(claude).toMatchObject({
      heavy: "claude-opus-4-1",
      free: "claude-3-5-haiku",
    });
  });
});
