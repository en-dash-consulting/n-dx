/** Real ledger finalization → production Rex readers and dashboard routes. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { finalizeTokenUsage } from "../../packages/sourcevision/dist/cli/commands/analyze.js";
import { setLLMConfig } from "../../packages/sourcevision/dist/analyzers/claude-client.js";
import { recordLLMCall, startRunLedger } from "../../packages/sourcevision/dist/analyzers/run-ledger.js";
import { aggregateTokenUsage, extractHenchTokenEvents, extractSvTokenEvents, estimateCost, groupByCommand } from "../../packages/rex/dist/core/token-usage.js";
import { handleTokenUsageRoute, resetAggregationCache } from "../../packages/web/dist/server/routes-token-usage.js";

let projectDir;
let ctx;
const timestamp = "2026-11-19T12:00:00.000Z";
const model = "gpt-6.1-sol";
beforeEach(() => {
  projectDir = mkdtempSync(join(import.meta.dirname, "../../.tmp-pr6-"));
  ctx = { projectDir, rexDir: join(projectDir, ".rex"), svDir: join(projectDir, ".sourcevision"), dev: false };
  for (const dir of [ctx.rexDir, ctx.svDir, join(projectDir, ".hench/runs")]) mkdirSync(dir, { recursive: true });
  setLLMConfig({ vendor: "codex", codex: { model } });
  startRunLedger();
  resetAggregationCache();
});
afterEach(() => {
  setLLMConfig({});
  startRunLedger();
  resetAggregationCache();
  rmSync(projectDir, { recursive: true, force: true });
});
async function route(path) {
  let body;
  const res = { writeHead(status) { expect(status).toBe(200); }, end(value) { body = JSON.parse(value); } };
  expect(await handleTokenUsageRoute({ method: "GET", url: `/api/token/${path}` }, res, ctx)).toBe(true);
  return body;
}
function manifest(tokenUsage) {
  writeFileSync(join(ctx.svDir, "manifest.json"), JSON.stringify({
    schemaVersion: "1.0.0", toolVersion: "1.0.0", analyzedAt: timestamp, targetPath: projectDir, modules: {}, tokenUsage,
  }));
}
async function assertReports(pkg, status, input, output, calls, eventCount = calls) {
  const rex = await aggregateTokenUsage([], projectDir);
  expect(rex.packages[pkg]).toMatchObject({ inputTokens: input, outputTokens: output, calls });
  expect(rex.diagnosticStatus).toBe(status);
  const rexCost = estimateCost(rex);
  for (const endpoint of ["summary", "budget", "utilization"]) {
    const web = await route(endpoint);
    expect(web.usage).toMatchObject({ totalInputTokens: input, totalOutputTokens: output, totalCalls: calls });
    expect(web.usage.diagnosticStatus).toBe(status);
    expect(web.usage.packages[pkg].diagnosticStatus).toBe(status);
    expect(web.usage.byModel).toEqual(rex.byModel);
    expect(web.cost.measurementComplete).toBe(status ? status === "complete" : undefined);
    expect(web.cost.measurementStatus).toBe(rexCost.measurementStatus);
    expect(web.cost.totalRaw).toBe(rexCost.totalRaw);
    if (endpoint === "utilization") {
      for (const bucket of web.byVendorModel) {
        if (bucket.model === "unknown") {
          expect(bucket).toMatchObject({ calls: 0, inputTokens: 0, outputTokens: 0, diagnosticStatus: status });
        } else {
          expect(bucket.diagnosticStatus).toBe(rex.byModel?.[bucket.model]?.diagnosticStatus);
        }
      }
      expect(web.commands[0].diagnosticStatus).toBe(status);
      expect(web.trend[0].estimatedCost.measurementStatus).toBe(status);
    }
  }
  const events = (await route("events")).events;
  expect(events).toHaveLength(eventCount);
  expect((await route("by-command")).commands[0].diagnosticStatus).toBe(status);
  expect((await route("by-period")).buckets[0].usage.diagnosticStatus).toBe(status);
  expect((await route("summary?since=2026-11-20")).eventCount).toBe(0);
}

describe("Hench measurement provenance", () => {
  it.each([
    ["unavailable", undefined], ["partial", undefined], ["complete", undefined],
    [undefined, "unavailable"], [undefined, "partial"], [undefined, "complete"],
    ["partial", "complete"], ["unavailable", "complete"],
  ])("retains run %s and turn %s without extra counts", async (runStatus, turnStatus) => {
    const status = runStatus ?? turnStatus;
    const input = status === "partial" ? 20 : 0;
    writeFileSync(join(projectDir, ".hench/runs/run.json"), JSON.stringify({
      id: "run", startedAt: timestamp, model,
      tokenUsage: { input, output: 0 },
      diagnostics: { tokenDiagnosticStatus: runStatus },
      ...(turnStatus ? { turnTokenUsage: [{ input, output: 0, model, diagnosticStatus: turnStatus }] } : {}),
    }));
    const events = await extractHenchTokenEvents(projectDir);
    const annotatedRun = turnStatus === "complete" && runStatus && runStatus !== "complete";
    expect(events).toHaveLength(annotatedRun ? 2 : 1);
    expect(events[0].diagnosticStatus).toBe(turnStatus ?? runStatus);
    expect(groupByCommand(events)[0]).toMatchObject({ calls: 1, runs: 1, diagnosticStatus: status });
    if (annotatedRun) {
      expect(events[1]).toMatchObject({ diagnosticStatus: runStatus, calls: 0, inputTokens: 0, outputTokens: 0 });
      expect(events[1].model).toBeUndefined();
    }
    await assertReports("hench", status, input, 0, 1, annotatedRun ? 2 : 1);
  });
  it("keeps a mixed-model run's measured tokens and diagnostic turns exactly once", async () => {
    writeFileSync(join(projectDir, ".hench/runs/run.json"), JSON.stringify({
      startedAt: timestamp, model, tokenUsage: { input: 20, output: 5, cacheCreationInput: 10, cacheReadInput: 80 },
      diagnostics: { tokenDiagnosticStatus: "unavailable" },
      turnTokenUsage: [
        { input: 20, output: 5, cacheCreationInput: 10, cacheReadInput: 80, model, diagnosticStatus: "complete" },
        { input: 0, output: 0, model: "gpt-5.4", diagnosticStatus: "unavailable" },
      ],
    }));
    await assertReports("hench", "unavailable", 20, 5, 2);
    const summary = await route("summary");
    expect(summary.usage).toMatchObject({ totalCacheCreationTokens: 10, totalCacheReadTokens: 80 });
    expect(summary.usage.byModel[model].diagnosticStatus).toBe("complete");
    expect(summary.cost.byModel.find(line => line.model === model).measurementComplete).toBe(true);
    expect((await extractHenchTokenEvents(projectDir)).map(event => event.diagnosticStatus)).toEqual(["complete", "unavailable"]);
    expect(summary.usage.byModel["gpt-5.4"].diagnosticStatus).toBe("unavailable");
  });
});

describe("Sourcevision finalization and downstream readers", () => {
  it.each([
    ["missing", [{ usageStatus: "unavailable" }], "unavailable", 0, 0],
    ["malformed", [{ usageStatus: "malformed" }], "unavailable", 0, 0],
    ["partial counts", [{ usageStatus: "partial", tokenUsage: { input: 20, output: 0 } }], "partial", 20, 0],
    ["mixed", [{ usageStatus: "measured", tokenUsage: { input: 20, output: 5 } }, { usageStatus: "unavailable" }], "partial", 20, 5],
    ["measured zero", [{ usageStatus: "measured", tokenUsage: { input: 0, output: 0 } }], "complete", 0, 0],
    ["mixed zero", [{ usageStatus: "measured", tokenUsage: { input: 0, output: 0 } }, { usageStatus: "unavailable" }], "partial", 0, 0],
    ["measured cache only", [{ usageStatus: "measured", tokenUsage: { input: 0, output: 0, cacheCreationInput: 10, cacheReadInput: 80 } }], "complete", 0, 0],
    ["partial cache only", [{ usageStatus: "partial", tokenUsage: { input: 0, output: 0, cacheReadInput: 80 } }], "partial", 0, 0],
  ])("persists %s through the real ledger and readers", async (_name, records, status, input, output) => {
    manifest();
    records.forEach((rec, i) => recordLLMCall({ taskClass: `zone.test-${i}`, vendor: "codex", model, durationMs: 1, ...rec }));
    finalizeTokenUsage({ absDir: projectDir, svDir: ctx.svDir, tokenUsage: { calls: 0, inputTokens: 0, outputTokens: 0 } }, { vendor: "codex", codex: { model } });
    const saved = JSON.parse(readFileSync(join(ctx.svDir, "manifest.json"), "utf8"));
    expect(saved.tokenUsage.diagnosticStatus).toBe(status);
    const cacheWrites = records.reduce((sum, rec) => sum + (rec.tokenUsage?.cacheCreationInput ?? 0), 0);
    const cacheReads = records.reduce((sum, rec) => sum + (rec.tokenUsage?.cacheReadInput ?? 0), 0);
    expect(saved.tokenUsage.cacheCreationInputTokens).toBe(cacheWrites);
    expect(saved.tokenUsage.cacheReadInputTokens).toBe(cacheReads);
    expect(saved.lastAnalysis.llm.costUsd !== undefined).toBe(status === "complete");
    expect((await extractSvTokenEvents(projectDir))[0].diagnosticStatus).toBe(status);
    await assertReports("sv", status, input, output, records.length, 1);
    const summary = await route("summary");
    expect(summary.usage.totalCacheCreationTokens).toBe(cacheWrites);
    expect(summary.usage.totalCacheReadTokens).toBe(cacheReads);
  });
  it("keeps complete measurement distinct from unknown pricing", async () => {
    manifest({ calls: 1, model: "custom-unpriced", inputTokens: 10, outputTokens: 5, diagnosticStatus: "complete" });
    const summary = await route("summary");
    expect(summary.cost.measurementComplete).toBe(true);
    expect(summary.cost.fullyAttributed).toBe(false);
    expect(summary.usage.totalInputTokens).toBe(10);
  });
  it.each(["unavailable", "partial", "complete", undefined])("reads new and legacy manifests (%s)", async status => {
    manifest({ calls: 1, model, inputTokens: 0, outputTokens: 0, ...(status ? { diagnosticStatus: status } : {}) });
    expect((await extractSvTokenEvents(projectDir))[0].diagnosticStatus).toBe(status);
    await assertReports("sv", status, 0, 0, 1);
  });
});
