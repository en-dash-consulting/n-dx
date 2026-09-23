/**
 * The dashboard and `ndx usage` must quote the same dollar figure for the
 * same runs — per model, not merely from the same rate table.
 *
 * Reuses rex's regression fixture (runs across two models, plus rex log and
 * sourcevision tokens that carry no model) as the dashboard test fixture, and
 * computes the CLI side through rex's own public rollup so the comparison is
 * between the two real surfaces rather than between two copies of the
 * arithmetic. See tests/unit/token-pricing-parity.test.js for the source-level
 * guard that the dashboard holds no pricing loop of its own.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, appendFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import {
  handleTokenUsageRoute,
  resetAggregationCache,
} from "../../../src/server/routes-token-usage.js";
import {
  aggregateTokenUsage,
  estimateCost,
  estimateCostFromTotals,
  type CostEstimate,
  type ModelCostLine,
} from "@n-dx/rex";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const FIXTURE_PATH = join(
  import.meta.dirname,
  "../../../../rex/tests/fixtures/token-usage-regression.json",
);

interface RegressionFixture {
  aggregation: {
    logEntries: Array<{ timestamp: string; event: string; detail?: string; [key: string]: unknown }>;
    henchRuns: Array<Record<string, unknown>>;
    svManifest: Record<string, unknown>;
  };
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as RegressionFixture;

interface SummaryResponse {
  usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    byModel?: Record<string, {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
    }>;
  };
  cost: CostEstimate & { byModel: ModelCostLine[] };
}

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (await handleTokenUsageRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("dashboard per-model cost parity with ndx usage", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  async function fetchSummary(): Promise<SummaryResponse> {
    const res = await fetch(`http://127.0.0.1:${port}/api/token/summary`);
    expect(res.ok).toBe(true);
    return (await res.json()) as SummaryResponse;
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "token-parity-"));
    const rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    const henchRunsDir = join(tmpDir, ".hench", "runs");
    await mkdir(rexDir, { recursive: true });
    await mkdir(svDir, { recursive: true });
    await mkdir(henchRunsDir, { recursive: true });

    for (const run of fixture.aggregation.henchRuns) {
      const id = String(run.id ?? "run");
      await writeFile(join(henchRunsDir, `${id}.json`), JSON.stringify(run));
    }
    await writeFile(
      join(rexDir, "execution-log.jsonl"),
      fixture.aggregation.logEntries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(fixture.aggregation.svManifest));

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    resetAggregationCache();
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    resetAggregationCache();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("quotes the same total as the rex rollup, to the cent, across two models", async () => {
    const rexSide = estimateCost(
      await aggregateTokenUsage(fixture.aggregation.logEntries, tmpDir),
    );
    const webSide = await fetchSummary();

    expect(webSide.cost.totalRaw).toBeCloseTo(rexSide.totalRaw, 10);
    expect(webSide.cost.total).toBe(rexSide.total);

    // Two real models priced at their own rates, not one fallback rate.
    const known = webSide.cost.byModel.filter((l) => l.known && !l.unattributed);
    expect(known.map((l) => l.model).sort()).toEqual([
      "claude-haiku-4-5",
      "claude-opus-5",
    ]);
  });

  it("splits usage by model the way rex does", async () => {
    const rexUsage = await aggregateTokenUsage(fixture.aggregation.logEntries, tmpDir);
    const webSide = await fetchSummary();

    expect(webSide.usage.byModel).toEqual(rexUsage.byModel);
  });

  it("labels tokens without a model as an unattributed line priced at the named fallback", async () => {
    // The fixture's rex log entries and sv manifest carry no model, so both
    // surfaces must price them on a labelled fallback line — not silently
    // spread them over the models that happen to be present.
    const webSide = await fetchSummary();
    const residual = webSide.cost.byModel.find((l) => l.unattributed);

    expect(residual).toBeDefined();
    expect(residual!.known).toBe(false);
    expect(residual!.pricedAs).toBe("claude-sonnet-5");
    expect(webSide.cost.fullyAttributed).toBe(false);
  });

  it("labels an unknown model id as priced-as fallback rather than dropping or defaulting it", async () => {
    await writeFile(
      join(tmpDir, ".hench", "runs", "run-unknown-model.json"),
      JSON.stringify({
        id: "run-unknown-model",
        startedAt: "2026-02-06T12:00:00.000Z",
        status: "completed",
        model: "some-unreleased-model",
        tokenUsage: { input: 1_000_000, output: 0 },
      }),
    );
    resetAggregationCache();

    const webSide = await fetchSummary();
    const line = webSide.cost.byModel.find((l) => l.model === "some-unreleased-model");

    expect(line).toBeDefined();
    expect(line!).toMatchObject({ known: false, pricedAs: "claude-sonnet-5" });
    expect(line!.totalRaw).toBeGreaterThan(0);
    expect(webSide.cost.fullyAttributed).toBe(false);
  });

  it("attributes the dashboard's own Ask spend to the model the ledger recorded", async () => {
    const askTokens = {
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    await appendFile(
      join(tmpDir, ".n-dx-web-usage.jsonl"),
      JSON.stringify({
        timestamp: "2026-02-06T13:00:00.000Z",
        command: "ask",
        vendor: "claude",
        model: "claude-sonnet-5",
        inputTokens: askTokens.inputTokens,
        outputTokens: askTokens.outputTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        calls: 1,
        outcome: "success",
      }) + "\n",
    );
    resetAggregationCache();

    const rexSide = estimateCost(
      await aggregateTokenUsage(fixture.aggregation.logEntries, tmpDir),
    );
    // The ask spend priced alone, at Sonnet's own (known) rates.
    const askCost = estimateCostFromTotals(askTokens, { "claude-sonnet-5": askTokens });
    const webSide = await fetchSummary();

    expect(webSide.usage.byModel?.["claude-sonnet-5"]).toEqual(askTokens);
    expect(webSide.cost.totalRaw).toBeCloseTo(rexSide.totalRaw + askCost.totalRaw, 10);
    const line = webSide.cost.byModel.find((l) => l.model === "claude-sonnet-5");
    expect(line).toMatchObject({ known: true, unattributed: false });
  });
});
