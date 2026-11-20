import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { handleTokenUsageRoute, resetAggregationCache } from "../../src/server/routes-token-usage.js";

it("preserves Codex cache spend through dashboard and budget consumers without a listening socket", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "codex-rollup-"));
  const svDir = join(projectDir, ".sourcevision");
  const rexDir = join(projectDir, ".rex");
  try {
    await mkdir(svDir);
    await mkdir(rexDir);
    await writeFile(join(svDir, "manifest.json"), JSON.stringify({
      analyzedAt: new Date().toISOString(),
      tokenUsage: { calls: 1, inputTokens: 20, outputTokens: 5, cacheReadInputTokens: 80, vendor: "codex", model: "gpt-5.4" },
    }));
    await writeFile(join(rexDir, "config.json"), JSON.stringify({ budget: { tokens: 100 } }));
    resetAggregationCache();
    const request = new IncomingMessage(new Socket());
    request.url = "/api/token/budget";
    request.method = "GET";
    const response = new ServerResponse(request);
    let body = "";
    response.writeHead = () => response;
    response.end = ((chunk: string) => { body = chunk; return response; }) as typeof response.end;
    await handleTokenUsageRoute(request, response, { projectDir, svDir, rexDir, dev: false });
    const data = JSON.parse(body);
    expect(data.usage.packages.sv.cacheReadTokens).toBe(80);
    expect(data.usage.totalInputTokens + data.usage.totalOutputTokens + data.usage.totalCacheReadTokens).toBe(105);
    expect(JSON.stringify(data.budget)).toContain("exceeded");
    request.destroy();
  } finally {
    resetAggregationCache();
    await rm(projectDir, { recursive: true, force: true });
  }
});
