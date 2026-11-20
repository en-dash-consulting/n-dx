import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createCodexCliClient } from "@n-dx/llm-client";
import { writeFakeCli } from "../../../llm-client/tests/helpers/fake-cli.js";
import { setProjectDir, setLLMConfig, setClaudeClient, spawnClaude, getUsageScope } from "../../../rex/src/analyze/llm-bridge.js";
import { emptyAnalyzeTokenUsage, accumulateTokenUsage } from "../../../rex/src/analyze/analyze-shared.js";
import { ensureRexDir } from "../../../rex/src/store/file-adapter.js";
import { resolveStore } from "../../../rex/src/store/index.js";
import { readTokenUsageLog } from "../../../rex/src/core/token-store.js";
import { extractRexTokenUsage, extractRexTokenEvents, aggregateTokenUsage, estimateCost,
  estimateCostFromTotals, groupByCommand, groupByTimePeriod } from "../../../rex/src/core/token-usage.js";
import { cmdUsage } from "../../../rex/src/cli/commands/usage.js";
import { handleTokenUsageRoute, resetAggregationCache } from "../../src/server/routes-token-usage.js";
import type { ServerContext } from "../../src/server/types.js";

const completed = (input = 100, cached = 80, output = 5) => JSON.stringify({
  type: "turn.completed", usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
});
const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetAggregationCache();
  setLLMConfig({});
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const projectDir = await mkdtemp(join(tmpdir(), "rex-completion-report-"));
  dirs.push(projectDir);
  const rexDir = join(projectDir, ".rex");
  await ensureRexDir(rexDir);
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "fixture", adapter: "file" }));
  return { projectDir, rexDir, svDir: join(projectDir, ".sourcevision"), dev: false };
}

async function complete(ctx: ServerContext, stream: string, failed: boolean, ownerTime?: string) {
  const cli = writeFakeCli(ctx.projectDir, { name: "codex", codexConfigRead: {}, script: `
    import fs from 'node:fs';
    for await (const chunk of process.stdin) { /* drain prompt */ }
    process.stdout.write(${JSON.stringify(stream)});
    if (${failed}) { process.stderr.write('stream disconnected'); process.exitCode = 1; }
    else {
      const args = process.argv.slice(2);
      fs.writeFileSync(args[args.indexOf('-o') + 1], 'fixture answer');
    }
  ` });
  setLLMConfig({ vendor: "codex" });
  setProjectDir(ctx.projectDir, "analyze");
  setClaudeClient(createCodexCliClient({ codexConfig: { cli_path: cli }, maxRetries: 0 }));
  const completion = spawnClaude("disposable fixture", "gpt-5.4");
  if (failed) {
    await expect(completion).rejects.toThrow("stream disconnected");
  } else {
    const result = await completion;
    // The real command accumulator owns successful counts/tokens. Its log is
    // separate from the bridge's diagnostic; reading both must not bill twice.
    const usage = emptyAnalyzeTokenUsage();
    accumulateTokenUsage(usage, result.tokenUsage);
    const store = await resolveStore(ctx.rexDir);
    await store.appendLog({ timestamp: ownerTime ?? new Date().toISOString(), event: "analyze_token_usage",
      detail: JSON.stringify({ ...usage, usageScope: getUsageScope(), vendor: "codex", model: "gpt-5.4" }) });
  }
}

async function route(ctx: ServerContext, path: string) {
  resetAggregationCache();
  const req = new IncomingMessage(new Socket());
  req.url = `/api/token/${path}`;
  req.method = "GET";
  const res = new ServerResponse(req);
  let body = "";
  res.writeHead = () => res;
  res.end = ((chunk: string) => { body = chunk; return res; }) as typeof res.end;
  try {
    expect(await handleTokenUsageRoute(req, res, ctx)).toBe(true);
    return JSON.parse(body);
  } finally { req.destroy(); }
}

describe("Codex completion → Rex log → CLI/dashboard measurement provenance", () => {
  it("keeps a completion diagnostic with its command-owned total in filtered dashboard reports", async () => {
    const ctx = await fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T23:59:59Z"));
    await complete(ctx, "", false, "2026-11-19T00:00:01.000Z");
    const summary = await route(ctx, "summary?since=2026-11-19");
    expect(summary.usage.totalCalls).toBe(1);
    expect(summary.cost).toMatchObject({ measurementComplete: false, total: "Unknown (usage unavailable)" });
    const periods = await route(ctx, "by-period?period=day");
    expect(periods.buckets).toHaveLength(1);
    expect(periods.buckets[0]).toMatchObject({ period: "2026-11-19", estimatedCost: { measurementComplete: false } });
  });

  for (const failed of [false, true]) {
    it.each([
      { status: "unavailable", stream: "", tokens: 0 },
      { status: "malformed", stream: "{", tokens: 0 },
      { status: "partial", stream: `${completed()}\n{`, tokens: 105 },
      { status: "complete", stream: completed(0, 0, 0), tokens: 0 },
    ])(`preserves $status (failed: ${failed}) without counting diagnostics as calls`, async ({ status, stream, tokens }) => {
      const ctx = await fixture();
      await complete(ctx, stream, failed);
      const logs = await readTokenUsageLog(ctx.rexDir);
      expect(logs).toHaveLength(failed ? 1 : 2);
      const usage = extractRexTokenUsage(logs);
      expect(usage).toMatchObject({ calls: 1, diagnosticStatus: status });
      expect(usage.inputTokens + usage.outputTokens + usage.cacheReadTokens).toBe(tokens);
      expect(usage.byModel?.["gpt-5.4"]).toMatchObject({ diagnosticStatus: status });
      const events = extractRexTokenEvents(logs);
      expect(events.reduce((sum, event) => sum + event.calls, 0)).toBe(1);
      expect(groupByCommand(events)).toMatchObject([{ command: "analyze", calls: 1, diagnosticStatus: status }]);
      const cost = estimateCostFromTotals(usage, usage.byModel);
      expect(cost).toMatchObject({ measurementStatus: status, measurementComplete: status === "complete", fullyAttributed: true });
      expect(cost.total).toBe(status === "complete" ? "$0.00" : tokens ? "$0.00 recorded (usage partial)" : `Unknown (usage ${status})`);
      for (const period of ["day", "week", "month"] as const) {
        const [bucket] = groupByTimePeriod(events, period);
        expect(bucket.usage).toMatchObject({ totalCalls: 1, diagnosticStatus: status });
        expect(bucket.estimatedCost).toEqual(cost);
      }
      const summary = await route(ctx, "summary");
      expect(summary.cost).toEqual(cost);
      const { byModel, ...counts } = usage;
      expect(summary.usage.packages.rex).toEqual(counts);
      expect(summary.usage.byModel).toEqual(byModel);
      const utilization = await route(ctx, "utilization");
      expect(utilization.byVendorModel).toMatchObject([{ calls: 1, diagnosticStatus: status }]);
      expect(utilization.commands).toMatchObject([{ command: "analyze", calls: 1, diagnosticStatus: status }]);
      expect(utilization.trend[0].estimatedCost).toEqual(cost);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmdUsage(ctx.projectDir, { format: "json", group: "day" });
      const json = JSON.parse(log.mock.calls.map(args => args.join(" ")).join("\n"));
      expect(json.estimatedCost.measurementComplete).toBe(status === "complete");
      expect(json.commands[0].diagnosticStatus).toBe(status);
      expect(json.periods[0].estimatedCost.measurementStatus).toBe(status);
      log.mockClear();
      await cmdUsage(ctx.projectDir, { group: "day" });
      expect(log.mock.calls.flat().join("\n")).toContain(cost.total);
    });
  }

  it("keeps known measured spend in mixed records and leaves legacy logs readable", async () => {
    const ctx = await fixture();
    await complete(ctx, completed(100_000, 80_000, 5_000), false);
    const measured = estimateCost(await aggregateTokenUsage(await readTokenUsageLog(ctx.rexDir), ctx.projectDir));
    await complete(ctx, "", true);
    const logs = await readTokenUsageLog(ctx.rexDir);
    const cost = estimateCost(await aggregateTokenUsage(logs, ctx.projectDir));
    expect(cost.totalRaw).toBe(measured.totalRaw);
    expect(cost.totalRaw).toBeGreaterThan(0);
    expect(cost).toMatchObject({ fullyAttributed: true, measurementComplete: false, measurementStatus: "unavailable" });
    expect(cost.total).toContain("recorded");
    const dashboard = await route(ctx, "summary");
    expect(dashboard.usage.totalCalls).toBe(2);
    expect(dashboard.cost).toEqual(cost);
    expect(extractRexTokenUsage(logs, { until: "2000-01-01" }).calls).toBe(0);
    expect((await route(ctx, "summary?until=2000-01-01")).usage.totalCalls).toBe(0);

    const legacy = [{ timestamp: "2020-01-01", event: "smart_add_token_usage", detail: JSON.stringify({
      calls: 2, inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 30, cacheReadInputTokens: 200,
    }) }];
    const usage = extractRexTokenUsage(legacy);
    expect(usage).toMatchObject({ calls: 2, inputTokens: 100, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 200 });
    expect(usage.diagnosticStatus).toBeUndefined();
    expect(estimateCostFromTotals(usage).measurementComplete).toBeUndefined();
    expect(extractRexTokenEvents(legacy)[0].command).toBe("smart-add");
  });
});
