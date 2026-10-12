/**
 * The dashboard's tuners propose token budgets in the units the budget is
 * enforced in, and never below the cost a run pays to arrive.
 *
 * Driven through the HTTP routes rather than against the analysis functions,
 * because the routes are what the dashboard calls and what an operator's
 * Apply button ultimately writes to `hench.tokenBudget`. The engines are
 * module-private, so the route is also the only surface a test can reach.
 *
 * The run profiles are prompt-cached: `tokenUsage.input` holds only the
 * uncached slice, with the bulk in `cacheCreationInput`. That is the shape
 * the old `input + output` count got wrong by roughly 12x, and it is the
 * shape every real run of this repository has.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleWorkflowRoute } from "../../../src/server/routes-workflow.js";
import { handleAdaptiveRoute } from "../../../src/server/routes-adaptive.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "hench/v1",
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: ".rex",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    loopPauseMs: 2000,
    maxFailedAttempts: 3,
    guard: {
      blockedPaths: [".hench/**", ".rex/**", ".git/**"],
      allowedCommands: ["npm", "git", "tsc"],
      commandTimeout: 30000,
      maxFileSize: 1048576,
    },
    retry: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000 },
    ...overrides,
  };
}

let runSeq = 0;

function makeRun(
  status: string,
  startedAt: string,
  tokenUsage: Record<string, number>,
): Record<string, unknown> {
  runSeq += 1;
  return {
    id: `run-${String(runSeq).padStart(4, "0")}`,
    taskId: `task-${runSeq}`,
    taskTitle: `Task ${runSeq}`,
    startedAt,
    finishedAt: startedAt,
    status,
    turns: 20,
    tokenUsage,
    toolCalls: [],
    model: "sonnet",
  };
}

/**
 * Prompt-cached runs shaped after this repository's own `.hench/runs/`: a few
 * hundred uncached input tokens against hundreds of thousands of cache
 * writes. Counted correctly each run is ~190K–940K; counted as input + output
 * each is ~50K, which is where a proposal below the arrival cost came from.
 */
function promptCachedRuns(): Record<string, unknown>[] {
  return [
    makeRun("completed", "2026-09-01T00:00:00Z", { input: 534, output: 50_000, cacheCreationInput: 876_000, cacheReadInput: 40_000_000 }),
    makeRun("completed", "2026-09-02T00:00:00Z", { input: 1_200, output: 60_000, cacheCreationInput: 184_000, cacheReadInput: 12_000_000 }),
    makeRun("completed", "2026-09-03T00:00:00Z", { input: 900, output: 45_000, cacheCreationInput: 240_000, cacheReadInput: 9_000_000 }),
    makeRun("completed", "2026-09-04T00:00:00Z", { input: 1_100, output: 52_000, cacheCreationInput: 310_000, cacheReadInput: 15_000_000 }),
  ];
}

/** The cheapest completed cached run above: 1,200 + 184,000 + 60,000. */
const ARRIVAL_COST = 245_200;

function budgetsIn(objects: ({ tokenBudget?: number } | undefined | null)[]): number[] {
  return objects
    .map((o) => o?.tokenBudget)
    .filter((v): v is number => typeof v === "number");
}

describe("dashboard tuners propose budgets in the enforced units", () => {
  let tmpDir: string;
  let henchDir: string;
  let runsDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    runSeq = 0;
    tmpDir = await mkdtemp(join(tmpdir(), "tuner-units-"));
    henchDir = join(tmpDir, ".hench");
    runsDir = join(henchDir, "runs");
    await mkdir(runsDir, { recursive: true });

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };

    server = createServer(async (req, res) => {
      if (await handleWorkflowRoute(req, res, ctx)) return;
      if (await handleAdaptiveRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end("Not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeRuns(runs: Record<string, unknown>[], config = makeConfig()): Promise<void> {
    await writeFile(join(henchDir, "config.json"), JSON.stringify(config, null, 2) + "\n");
    for (const run of runs) {
      await writeFile(join(runsDir, `${run["id"]}.json`), JSON.stringify(run, null, 2) + "\n");
    }
  }

  it("workflow: reports an average that counts cache writes", async () => {
    await writeRuns(promptCachedRuns());

    const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/workflow/analysis`)).json();

    // input + output alone would put this near 52K. Counting cache writes
    // puts it above 400K, which is the number a budget has to be compared to.
    expect(body.stats.avgTokensPerRun).toBeGreaterThan(400_000);
    expect(body.stats.contextWriteFloor).toBe(ARRIVAL_COST);
    expect(body.stats.promptCached).toBe(true);
  });

  it("workflow: proposes no budget below the arrival cost", async () => {
    await writeRuns(promptCachedRuns());

    const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/workflow/analysis`)).json();
    const budgets = budgetsIn(body.suggestions.map((s: { configChanges?: { tokenBudget?: number } }) => s.configChanges));

    expect(budgets.length).toBeGreaterThan(0);
    for (const b of budgets) expect(b).toBeGreaterThanOrEqual(ARRIVAL_COST);
  });

  it("workflow: does not call a prompt-cached project high-consumption below 1.2M", async () => {
    // Four healthy cached runs average ~450K. Against the old fixed 100,000
    // that was "high token consumption", on a project doing nothing wrong.
    await writeRuns(promptCachedRuns());

    const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/workflow/analysis`)).json();
    expect(body.stats.avgTokensPerRun).toBeLessThan(1_200_000);
    expect(
      body.suggestions.find(
        (s: { category: string; priority: string }) =>
          s.category === "token-efficiency" && s.priority === "high",
      ),
    ).toBeUndefined();
  });

  it("workflow: still flags an uncached project above 100K", async () => {
    // The rescale must not silence the suggestion for a project that never
    // got the inflation.
    await writeRuns([
      makeRun("failed", "2026-09-01T00:00:00Z", { input: 50_000, output: 100_000 }),
      makeRun("failed", "2026-09-02T00:00:00Z", { input: 60_000, output: 90_000 }),
      makeRun("completed", "2026-09-03T00:00:00Z", { input: 40_000, output: 110_000 }),
    ]);

    const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/workflow/analysis`)).json();
    expect(body.stats.promptCached).toBe(false);
    expect(
      body.suggestions.find(
        (s: { category: string; priority: string }) =>
          s.category === "token-efficiency" && s.priority === "high",
      ),
    ).toBeDefined();
  });

  it("adaptive: reports the floor and proposes nothing below it", async () => {
    await writeRuns(promptCachedRuns(), makeConfig({ tokenBudget: 600_000 }));

    const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/adaptive/analysis`)).json();

    expect(body.metrics.recentAvgTokens).toBeGreaterThan(400_000);
    expect(body.metrics.contextWriteFloor).toBe(ARRIVAL_COST);

    const budgets = budgetsIn(
      body.adjustments.map((a: { configChanges?: { tokenBudget?: number } }) => a.configChanges),
    );
    for (const b of budgets) expect(b).toBeGreaterThanOrEqual(ARRIVAL_COST);
  });

  it("adaptive: labels every proposal as a recommendation, never auto-applied", async () => {
    // Nothing in the server writes the config; only the Apply button does.
    // Labelling a proposal "auto-applied" because adaptive mode is on — the
    // default — presented an unapplied number as already in force.
    await writeRuns(promptCachedRuns(), makeConfig({ tokenBudget: 600_000 }));

    const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/adaptive/analysis`)).json();

    expect(body.settings.enabled).toBe(true);
    for (const n of body.notifications as { type: string }[]) {
      expect(n.type).toBe("recommended");
    }
  });
});
