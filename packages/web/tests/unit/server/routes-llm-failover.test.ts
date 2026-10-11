/**
 * Unit tests for the `failover` block of `GET /api/llm/config` — whether and
 * how failover can fire for the active vendor and provider.
 *
 * Failover only applies to Claude + API provider. For all other combinations,
 * `applies` is false with an explanation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

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

async function failover(): Promise<{ applies: boolean; reason?: string; chain: string[] }> {
  const res = await fetch(`${baseUrl}/api/llm/config`);
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.failover;
}

describe("GET /api/llm/config — failover block", () => {
  it("applies=true with chain for Claude API", async () => {
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
    expect(info.applies).toBe(true);
    expect(info.reason).toBeUndefined();
    // Chain should have 4 entries: the effective model followed by 3 failover attempts
    expect(info.chain).toHaveLength(4);
    // First entry is the effective model (sonnet)
    expect(info.chain[0]).toBe("claude-3-5-sonnet-20241022");
    // Second entry should be the light model (haiku) from attempt 1
    expect(info.chain[1]).toContain("haiku");
    // Third entry should be codex standard from attempt 2
    expect(info.chain[2]).toContain("gpt-5");
    // Fourth entry should be codex light from attempt 3
    expect(info.chain[3]).toContain("gpt-5");
  });

  it("applies=false with reason for Claude CLI", async () => {
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
    expect(info.applies).toBe(false);
    expect(info.reason).toContain("API connection");
    expect(info.chain).toEqual([]);
  });

  it("applies=false with reason for Codex", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "codex",
        codex: { model: "gpt-5.5" },
      },
    });

    const info = await failover();
    expect(info.applies).toBe(false);
    expect(info.reason).toContain("Codex");
    expect(info.chain).toEqual([]);
  });

  it("applies=false with reason for Google", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "google",
        google: { model: "gemini-3.5-flash" },
      },
    });

    const info = await failover();
    expect(info.applies).toBe(false);
    expect(info.reason).toContain("Google");
    expect(info.chain).toEqual([]);
  });

  it("applies=false with reason for local", async () => {
    await writeNdxConfig({
      llm: {
        vendor: "local",
        local: { model: "llama2", host: "localhost", port: 1234 },
      },
    });

    const info = await failover();
    expect(info.applies).toBe(false);
    expect(info.reason).toContain("local");
    expect(info.chain).toEqual([]);
  });

  it("applies=false with reason when vendor defaults to claude without explicit provider", async () => {
    // No vendor or provider set — defaults to claude CLI
    await writeNdxConfig({});

    const info = await failover();
    expect(info.applies).toBe(false);
    // When vendor defaults to claude without API provider, the reason is about CLI
    expect(info.reason).toContain("API connection");
    expect(info.chain).toEqual([]);
  });
});
