/**
 * Unit tests for the `failover` block of `GET /api/llm/config` — whether and
 * how failover can fire for the active vendor and provider.
 *
 * Failover applies to Claude API and supported Codex API configurations,
 * independently of the toggle. Other combinations retain their resolver chain
 * with an explanation of why failover cannot fire.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { getNextFailoverAttempt, parseLLMConfig } from "@n-dx/llm-client";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";
import type { LlmConfigResponse } from "../../../src/server/routes-llm.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-failover-"));
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

async function writeNdxConfig(config: unknown): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function writeHenchConfig(config: unknown): Promise<void> {
  await mkdir(join(projectDir, ".hench"), { recursive: true });
  await writeFile(
    join(projectDir, ".hench", "config.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

async function config(): Promise<LlmConfigResponse> {
  const res = await fetch(`${baseUrl}/api/llm/config`);
  expect(res.status).toBe(200);
  return res.json();
}

async function failover(): Promise<LlmConfigResponse["failover"]> {
  return (await config()).failover;
}

function codexChain(model: string, ndx: Record<string, unknown>): string[] {
  const llm = parseLLMConfig(ndx);
  const chain = [model];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const next = getNextFailoverAttempt(attempt, "codex", llm);
    if (next.isExhausted || !next.model) break;
    chain.push(next.model);
  }
  expect(getNextFailoverAttempt(4, "codex", llm).isExhausted).toBe(true);
  return chain;
}

describe("GET /api/llm/config — failover block", () => {
  it("enabled=false by default; applies=true with chain for Claude API", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "claude",
        claude: { model: "claude-3-5-sonnet-20241022" },
      },
    });
    await writeHenchConfig({
      provider: "api",
    });

    const info = await failover();
    expect(info.enabled).toBe(false);
    expect(info.applies).toBe(true);
    expect(info.reason).toBeUndefined();
    // Chain should have 4 entries: the effective model followed by 3 failover attempts
    expect(info.chain).toHaveLength(4);
    // First entry is the effective model (sonnet)
    expect(info.chain[0]).toBe("claude-3-5-sonnet-20241022");
    // Second entry should be the light model (haiku) from attempt 1
    expect(info.chain[1]).toContain("haiku");
    // Third entry should be codex standard from attempt 2
    expect(info.chain[2]).toBe("gpt-6.1-sol");
    // Fourth entry should be codex light from attempt 3
    expect(info.chain[3]).toBe("gpt-6-luna");
  });

  it("enabled=true when autoFailover is set; applies=true for Claude API", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "claude",
        autoFailover: true,
        claude: { model: "claude-3-5-sonnet-20241022" },
      },
    });
    await writeHenchConfig({
      provider: "api",
    });

    const info = await failover();
    expect(info.enabled).toBe(true);
    expect(info.applies).toBe(true);
    expect(info.reason).toBeUndefined();
    expect(info.chain).toHaveLength(4);
  });

  it("applies=false with reason and full chain for Claude CLI", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "claude",
        claude: { model: "claude-3-5-sonnet-20241022" },
      },
    });
    await writeHenchConfig({
      provider: "cli",
    });

    const info = await failover();
    expect(info.enabled).toBe(false);
    expect(info.applies).toBe(false);
    expect(info.reason).toContain("Claude CLI");
    expect(info.reason).toContain("API connection");
    // Chain should still have 4 entries even though failover cannot fire
    expect(info.chain).toHaveLength(4);
    expect(info.chain[0]).toBe("claude-3-5-sonnet-20241022");
    expect(info.chain[1]).toContain("haiku");
  });

  it("applies=false with reason and full chain for Codex CLI by default", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "codex",
        codex: { model: "gpt-5.5" },
      },
    });

    const info = await failover();
    expect(info.enabled).toBe(false);
    expect(info.applies).toBe(false);
    expect(info.reason).toContain("Codex CLI");
    expect(info.reason).toContain("API connection");
    // Chain should have entries for codex failover
    expect(info.chain).toHaveLength(4);
    expect(info.chain[0]).toBe("gpt-5.5");
    // Attempt 1: codex light
    expect(info.chain[1]).toBe("gpt-6-luna");
    // Attempt 2: claude standard
    expect(info.chain[2]).toContain("claude");
  });

  describe.each(["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-sol-2026-11-01", "gpt-6-astra-2026-11-01"])("Codex API model %s", (model) => {
    it.each([false, true])("applies independently of autoFailover=%s", async (enabled) => {
      const ndx = { llm: { vendor: "codex", autoFailover: enabled, codex: { model, auth: "api" } } };
      await writeNdxConfig(ndx);
      await writeHenchConfig({ provider: "api" });

      const result = await config();
      expect(result.effective).toMatchObject({ vendor: "codex", provider: "api", model });
      expect(result.effectiveProblems).toEqual([]);
      expect(result.failover).toEqual({ enabled, applies: true, chain: codexChain(model, ndx) });
    });
  });

  it.each([false, true])("Codex CLI with API authentication still cannot fail over (enabled=%s)", async (enabled) => {
    const ndx = { llm: { vendor: "codex", autoFailover: enabled, codex: { model: "gpt-6-astra", auth: "api" } } };
    await writeNdxConfig(ndx);
    await writeHenchConfig({ provider: "cli" });

    const result = await config();
    expect(result.effective.provider).toBe("cli");
    expect(result.failover).toMatchObject({ enabled, applies: false, chain: codexChain("gpt-6-astra", ndx) });
    expect(result.failover.reason).toContain("Codex CLI");
    expect(result.failover.reason).toContain("API connection");
  });

  it.each([false, true])("Codex API with an explicit CLI login cannot fail over (enabled=%s)", async (enabled) => {
    const ndx = { llm: { vendor: "codex", autoFailover: enabled, codex: { model: "gpt-6-astra", auth: "cli" } } };
    await writeNdxConfig(ndx);
    await writeHenchConfig({ provider: "api" });

    const result = await config();
    expect(result.effectiveProblems).toEqual([{ field: "provider", message: expect.stringContaining('llm.codex.auth is "cli"') }]);
    expect(result.failover).toEqual({
      enabled, applies: false, reason: expect.stringContaining(result.effectiveProblems[0].message),
      chain: codexChain("gpt-6-astra", ndx),
    });
  });

  it.each(["gpt-6-luna", "gpt-6.2-astra", "claude-sonnet-5"])("does not advertise unsupported Codex API model %s as executable", async (model) => {
    await writeNdxConfig({ llm: { vendor: "codex", autoFailover: true, codex: { model } } });
    await writeHenchConfig({ provider: "api" });

    const result = await config();
    expect(result.effective.model).toBe(model);
    expect(result.effectiveProblems).toEqual([{ field: "model", message: expect.stringContaining(model) }]);
    expect(result.failover).toMatchObject({ enabled: true, applies: false });
    expect(result.failover.reason).toContain(result.effectiveProblems[0].message);
    expect(result.failover.chain[0]).toBe(model);
  });

  it("starts with the effective hench model and preserves the resolver's configured standard/light models", async () => {
    const ndx = {
      llm: {
        vendor: "codex", autoFailover: true,
        codex: { model: "gpt-6.1-sol", lightModel: "gpt-6.1-sol" },
        claude: { model: "claude-opus-5", lightModel: "claude-haiku-4-5-20251001" },
        // The preview follows getNextFailoverAttempt even when task tiers differ.
        tiers: { codex: { light: "gpt-6-luna" }, claude: { standard: "claude-sonnet-4-6" } },
      },
    };
    await writeNdxConfig(ndx);
    await writeHenchConfig({ provider: "api", models: { codex: "gpt-6-astra" } });

    const result = await config();
    expect(result.effective).toMatchObject({ model: "gpt-6-astra", modelSource: "hench-override" });
    expect(result.failover).toEqual({ enabled: true, applies: true, chain: codexChain("gpt-6-astra", ndx) });
    expect(result.failover.chain).toEqual(["gpt-6-astra", "gpt-6.1-sol", "claude-opus-5", "claude-haiku-4-5-20251001"]);
  });

  it("applies=false with reason and full chain for Google", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "google",
        google: { model: "gemini-3.5-flash" },
      },
    });

    const info = await failover();
    expect(info.enabled).toBe(false);
    expect(info.applies).toBe(false);
    expect(info.reason).toContain("Google Gemini");
    expect(info.reason).toContain("API connection");
    // Chain should have entries for google failover
    expect(info.chain).toHaveLength(4);
    expect(info.chain[0]).toBe("gemini-3.5-flash");
    // Attempt 1: google light
    expect(info.chain[1]).toContain("gemini");
    // Attempt 2: claude standard
    expect(info.chain[2]).toContain("claude");
  });

  it("applies=false with reason and empty chain for local", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "local",
        local: { model: "llama2", host: "localhost", port: 1234 },
      },
    });

    const info = await failover();
    expect(info.enabled).toBe(false);
    expect(info.applies).toBe(false);
    expect(info.reason).toContain("local");
    expect(info.reason).toContain("API connection");
    expect(info.chain).toEqual([]);
  });

  it("applies=false with reason when vendor defaults to claude without explicit provider", async () => {
    // No vendor or provider set — defaults to claude CLI
    await writeNdxConfig({});

    const info = await failover();
    expect(info.enabled).toBe(false);
    expect(info.applies).toBe(false);
    // When vendor defaults to claude without API provider, the reason is about CLI
    expect(info.reason).toContain("Claude CLI");
    expect(info.reason).toContain("API connection");
    // Chain should still be populated for claude
    expect(info.chain).toHaveLength(4);
  });

  it("enabled=true with autoFailover for Claude CLI (still applies=false)", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "claude",
        autoFailover: true,
        claude: { model: "claude-3-5-sonnet-20241022" },
      },
    });
    await writeHenchConfig({
      provider: "cli",
    });

    const info = await failover();
    expect(info.enabled).toBe(true);
    expect(info.applies).toBe(false);
    expect(info.reason).toContain("Claude CLI");
    expect(info.chain).toHaveLength(4);
  });
});
