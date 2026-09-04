/**
 * Dashboard spend accounting: an Ask call's tokens reach the utilization
 * rollup, attributed to the vendor and model that served it.
 *
 * The two halves are tested together on purpose. A ledger that records
 * perfectly and an aggregator that reads a different shape would both pass in
 * isolation while the dashboard's spend stayed invisible — which is the exact
 * defect this feature exists to fix. So the assertions here run a real ask
 * through the route and then read the answer back out of
 * `GET /api/token/utilization`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { ClaudeClientError } from "@n-dx/llm-client";
import type { CompletionResult, LLMClient } from "@n-dx/llm-client";
import type { ServerContext } from "../../../src/server/types.js";
import {
  handleSourcevisionAskRoute,
  type HandleSourcevisionAskOptions,
} from "../../../src/server/routes-sourcevision-ask.js";
import {
  handleTokenUsageRoute,
  resetAggregationCache,
} from "../../../src/server/routes-token-usage.js";
import {
  DASHBOARD_USAGE_FILE,
  readDashboardUsage,
  recordDashboardUsage,
  type DashboardUsageRecord,
} from "../../../src/server/dashboard-usage.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

// ---------------------------------------------------------------------------
// Minimal analysis fixture — enough for assembleAskContext to report available
// ---------------------------------------------------------------------------

const MANIFEST = {
  schemaVersion: "1",
  toolVersion: "0.5.1",
  analyzedAt: "2026-02-02T00:00:00.000Z",
  targetPath: "/repo/usage-fixture",
  language: "typescript",
  languages: ["typescript"],
  modules: {},
};

const ZONES = {
  zones: [
    {
      id: "core",
      name: "Core",
      description: "The only zone.",
      files: ["src/core.ts"],
      entryPoints: ["src/core.ts"],
      cohesion: 0.9,
      coupling: 0.1,
    },
  ],
  crossings: [],
  unzoned: [],
  insights: [],
  findings: [],
};

/** A record with every field set, so field-level assertions can vary one. */
function usageRecord(overrides: Partial<DashboardUsageRecord> = {}): DashboardUsageRecord {
  return {
    timestamp: "2026-03-01T12:00:00.000Z",
    command: "ask",
    vendor: "claude",
    model: "claude-opus-5",
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationTokens: 8,
    cacheReadTokens: 4,
    calls: 1,
    outcome: "success",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ledger unit behaviour
// ---------------------------------------------------------------------------

describe("dashboard usage ledger", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dash-usage-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("round-trips a record through the ledger file", () => {
    expect(recordDashboardUsage(tmpDir, usageRecord())).toBe(true);
    expect(readDashboardUsage(tmpDir)).toEqual([usageRecord()]);
  });

  it("appends rather than replacing, so a second ask cannot lose the first", () => {
    recordDashboardUsage(tmpDir, usageRecord({ inputTokens: 1 }));
    recordDashboardUsage(tmpDir, usageRecord({ inputTokens: 2 }));

    expect(readDashboardUsage(tmpDir).map((r) => r.inputTokens)).toEqual([1, 2]);
  });

  it("treats a missing ledger as no spend rather than an error", () => {
    expect(readDashboardUsage(tmpDir)).toEqual([]);
  });

  it("skips a torn line without losing the records around it", async () => {
    recordDashboardUsage(tmpDir, usageRecord({ inputTokens: 1 }));
    await writeFile(
      join(tmpDir, DASHBOARD_USAGE_FILE),
      `${JSON.stringify(usageRecord({ inputTokens: 1 }))}\n{"timestamp":"2026-03\n${JSON.stringify(usageRecord({ inputTokens: 3 }))}\n`,
      "utf-8",
    );

    expect(readDashboardUsage(tmpDir).map((r) => r.inputTokens)).toEqual([1, 3]);
  });

  it("drops a record with no timestamp instead of dating it to now", async () => {
    // Defaulting the timestamp would file historical spend into today's
    // since/until bucket, which reads as a spike that never happened.
    await writeFile(
      join(tmpDir, DASHBOARD_USAGE_FILE),
      `{"command":"ask","inputTokens":500}\n`,
      "utf-8",
    );

    expect(readDashboardUsage(tmpDir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ask route → ledger → utilization rollup
// ---------------------------------------------------------------------------

describe("Ask spend in the utilization rollup", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let askServer: Server;
  let askUrl: string;
  let tokenServer: Server;
  let tokenUrl: string;
  let routeOptions: HandleSourcevisionAskOptions;

  /** Build an injected client whose `complete` runs `respond`. */
  function stub(respond: () => Promise<CompletionResult>): HandleSourcevisionAskOptions {
    return {
      createClient: () => {
        const client: LLMClient = { mode: "api", complete: () => respond() };
        return client;
      },
    };
  }

  function ask(prompt: string): Promise<Response> {
    return fetch(`${askUrl}/api/sourcevision/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  }

  async function utilization(): Promise<Record<string, never> & {
    usage: {
      packages: Record<string, {
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
        calls: number;
      }>;
      totalCacheCreationTokens: number;
      totalCacheReadTokens: number;
    };
    byVendorModel: Array<{
      vendor: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      calls: number;
      toolBreakdown: Record<string, { inputTokens: number; calls: number }>;
    }>;
    commands: Array<{ package: string; command: string; inputTokens: number; calls: number }>;
    source: { dashboard: string };
  }> {
    // The aggregation cache is module-scoped and fingerprints the ledger, but
    // it is also shared across tests in this worker — reset so a previous
    // test's project directory cannot answer this one.
    resetAggregationCache();
    const res = await fetch(`${tokenUrl}/api/token/utilization`);
    expect(res.status).toBe(200);
    return await res.json();
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dash-usage-rollup-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(MANIFEST));
    await writeFile(join(svDir, "zones.json"), JSON.stringify(ZONES));

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    routeOptions = {};
    resetAggregationCache();

    const askStarted = await startRouteTestServer((req, res) =>
      handleSourcevisionAskRoute(req, res, ctx, routeOptions),
    );
    askServer = askStarted.server;
    askUrl = askStarted.baseUrl;

    const tokenStarted = await startRouteTestServer((req, res) =>
      handleTokenUsageRoute(req, res, ctx),
    );
    tokenServer = tokenStarted.server;
    tokenUrl = tokenStarted.baseUrl;
  });

  afterEach(async () => {
    await closeRouteTestServer(askServer);
    await closeRouteTestServer(tokenServer);
    resetAggregationCache();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── The acceptance criterion ──────────────────────────────────────────────

  it("records vendor, model, and every token class for an answered ask", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "local", local: { model: "qwen-3-coder" } } }),
    );
    routeOptions = stub(() =>
      Promise.resolve({
        text: "Core is the only zone.",
        tokenUsage: { input: 900, output: 60, cacheCreationInput: 400, cacheReadInput: 12_000 },
      }),
    );

    expect((await ask("What zones exist?")).status).toBe(200);

    const records = readDashboardUsage(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      command: "ask",
      vendor: "local",
      model: "qwen-3-coder",
      inputTokens: 900,
      outputTokens: 60,
      cacheCreationTokens: 400,
      cacheReadTokens: 12_000,
      calls: 1,
      outcome: "success",
    });
  });

  it("surfaces the ask in the rollup under its own vendor/model attribution", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "local", local: { model: "qwen-3-coder" } } }),
    );
    routeOptions = stub(() =>
      Promise.resolve({
        text: "ok",
        tokenUsage: { input: 900, output: 60, cacheCreationInput: 400, cacheReadInput: 12_000 },
      }),
    );
    await ask("What zones exist?");

    const data = await utilization();

    const row = data.byVendorModel.find((r) => r.vendor === "local" && r.model === "qwen-3-coder");
    expect(row).toBeDefined();
    expect(row!.inputTokens).toBe(900);
    expect(row!.outputTokens).toBe(60);
    expect(row!.calls).toBe(1);
    // Attributed to the dashboard, not to the analyze run it read from.
    expect(row!.toolBreakdown.web.inputTokens).toBe(900);
    expect(row!.toolBreakdown.sv.inputTokens).toBe(0);
    expect(row!.toolBreakdown.hench.inputTokens).toBe(0);
  });

  it("keeps dashboard spend separable from hench run spend", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "run-1.json"),
      JSON.stringify({
        startedAt: "2026-03-01T09:00:00.000Z",
        model: "claude-opus-5",
        tokenUsage: { input: 5_000, output: 700 },
      }),
    );
    routeOptions = stub(() =>
      Promise.resolve({ text: "ok", tokenUsage: { input: 900, output: 60 } }),
    );
    await ask("Anything?");

    const data = await utilization();

    expect(data.usage.packages.web.inputTokens).toBe(900);
    expect(data.usage.packages.hench.inputTokens).toBe(5_000);
    // And the command dimension names the surface, so the two are legible in
    // the table as well as in the package totals.
    const askCommand = data.commands.find((c) => c.package === "web" && c.command === "ask");
    expect(askCommand?.inputTokens).toBe(900);
    const runCommand = data.commands.find((c) => c.package === "hench" && c.command === "run");
    expect(runCommand?.inputTokens).toBe(5_000);
  });

  it("reports the ask's cache tokens rather than folding them away", async () => {
    routeOptions = stub(() =>
      Promise.resolve({
        text: "ok",
        tokenUsage: { input: 900, output: 60, cacheCreationInput: 400, cacheReadInput: 12_000 },
      }),
    );
    await ask("Anything?");

    const data = await utilization();

    expect(data.usage.packages.web.cacheCreationTokens).toBe(400);
    expect(data.usage.packages.web.cacheReadTokens).toBe(12_000);
    expect(data.usage.totalCacheCreationTokens).toBe(400);
    expect(data.usage.totalCacheReadTokens).toBe(12_000);
  });

  it("names the ledger as the dashboard usage source once it exists", async () => {
    expect((await utilization()).source.dashboard).toContain("missing");

    routeOptions = stub(() => Promise.resolve({ text: "ok", tokenUsage: { input: 1, output: 1 } }));
    await ask("Anything?");

    expect((await utilization()).source.dashboard).toBe(DASHBOARD_USAGE_FILE);
  });

  // ── Failure paths ─────────────────────────────────────────────────────────

  it("records a rate-limited ask instead of dropping the call", async () => {
    routeOptions = stub(() =>
      Promise.reject(new ClaudeClientError("429 rate limit exceeded", "rate-limit", true, 5_000)),
    );

    expect((await ask("Too many questions.")).status).toBe(429);

    const records = readDashboardUsage(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0].outcome).toBe("error");
    expect(records[0].calls).toBe(1);
  });

  it("records a timed-out ask, and its tokens if the provider reports them late", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ sourcevision: { ask: { timeoutMs: 30 } } }),
    );
    let settle: (result: CompletionResult) => void = () => {};
    routeOptions = stub(() => new Promise<CompletionResult>((resolve) => { settle = resolve; }));

    expect((await ask("Take your time.")).status).toBe(504);

    // The timeout itself is on the ledger with the call counted.
    const afterTimeout = readDashboardUsage(tmpDir);
    expect(afterTimeout).toHaveLength(1);
    expect(afterTimeout[0]).toMatchObject({ outcome: "timeout", calls: 1, inputTokens: 0 });

    // The provider then finishes. Those tokens were spent, so they land too —
    // with calls: 0, because the call itself is already accounted for above.
    settle({ text: "late answer", tokenUsage: { input: 1_200, output: 40 } });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const afterLateArrival = readDashboardUsage(tmpDir);
    expect(afterLateArrival).toHaveLength(2);
    expect(afterLateArrival[1]).toMatchObject({
      outcome: "timeout",
      calls: 0,
      inputTokens: 1_200,
      outputTokens: 40,
    });

    // One call, both sets of tokens.
    const data = await utilization();
    expect(data.usage.packages.web.calls).toBe(1);
    expect(data.usage.packages.web.inputTokens).toBe(1_200);
  });

  it("does not record a call that was never made", async () => {
    // No analysis to ground an answer in: the route refuses before reaching a
    // provider, so there is no spend to report.
    const emptyDir = await mkdtemp(join(tmpdir(), "dash-usage-empty-"));
    const emptySvDir = join(emptyDir, ".sourcevision");
    await mkdir(emptySvDir, { recursive: true });
    const emptyCtx: ServerContext = {
      projectDir: emptyDir,
      svDir: emptySvDir,
      rexDir: join(emptyDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleSourcevisionAskRoute(req, res, emptyCtx, stub(() => Promise.resolve({ text: "no" }))),
    );
    try {
      const res = await fetch(`${started.baseUrl}/api/sourcevision/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "What does this project do?" }),
      });
      expect(res.status).toBe(404);
      expect(readDashboardUsage(emptyDir)).toEqual([]);
    } finally {
      await closeRouteTestServer(started.server);
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("writes one line per call so a reader can page the ledger", async () => {
    routeOptions = stub(() => Promise.resolve({ text: "ok", tokenUsage: { input: 1, output: 1 } }));
    await ask("One.");
    await ask("Two.");

    const raw = await readFile(join(tmpDir, DASHBOARD_USAGE_FILE), "utf-8");
    expect(raw.trimEnd().split("\n")).toHaveLength(2);
  });
});
