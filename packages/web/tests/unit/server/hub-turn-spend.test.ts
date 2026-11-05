/**
 * Hub session spend: a finished hub turn lands in `<ndx home>/hub/usage.jsonl`
 * whichever project hosts it, and in no project's own usage ledger.
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDashboardUsage, dashboardUsagePath } from "../../../src/server/dashboard-usage.js";
import { hubTurnSpendRecorder } from "../../../src/server/routes-sidecar.js";
import { hubUsagePath, readHubUsageTotals, renderHomePage } from "../../../src/hub/index.js";
import type { SidecarTurnSpend } from "../../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../../src/server/types.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

let home: string;
let hostA: string;
let hostB: string;

function ctxFor(dir: string): ServerContext {
  return { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir: join(dir, ".rex"), dev: false };
}

function turn(input: number, output: number, status: SidecarTurnSpend["status"] = "completed"): SidecarTurnSpend {
  return {
    record: { id: "s1", lens: "hub", vendor: "claude", model: "m" },
    status,
    tokens: { input, output },
  } as unknown as SidecarTurnSpend;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hub-spend-home-"));
  hostA = mkdtempSync(join(tmpdir(), "hub-spend-a-"));
  hostB = mkdtempSync(join(tmpdir(), "hub-spend-b-"));
});

afterEach(async () => {
  await Promise.all([home, hostA, hostB].map((d) => removeTestDir(d)));
});

describe("hubTurnSpendRecorder", () => {
  it("records turns hosted by two projects in the one hub ledger and in neither project's", () => {
    hubTurnSpendRecorder(ctxFor(hostA), home)(turn(100, 10));
    hubTurnSpendRecorder(ctxFor(hostB), home)(turn(200, 20));

    const lines = readFileSync(hubUsagePath(home), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.host)).toEqual([hostA, hostB]);
    expect(readHubUsageTotals(home)).toMatchObject({ turns: 2, inputTokens: 300, outputTokens: 30 });

    for (const dir of [hostA, hostB]) {
      expect(readDashboardUsage(dir)).toEqual([]);
      expect(existsSync(dashboardUsagePath(dir))).toBe(false);
    }
  });

  it("records nothing for an interrupted turn that spent nothing", () => {
    hubTurnSpendRecorder(ctxFor(hostA), home)(turn(0, 0, "interrupted"));
    expect(existsSync(hubUsagePath(home))).toBe(false);
  });
});

describe("readHubUsageTotals", () => {
  it("is zero without a ledger", () => {
    expect(readHubUsageTotals(home).turns).toBe(0);
  });
});

describe("hub home", () => {
  const overview = { projects: [] } as never;

  it("shows the hub session's total spend once it has a turn", () => {
    const spend = { turns: 2, inputTokens: 1500, outputTokens: 30, cacheCreationTokens: 0, cacheReadTokens: 0 };
    expect(renderHomePage(overview, "", [], { hubSpend: spend })).toContain("Hub session: 2 turns, 1.5k in / 30 out");
  });

  it("shows nothing before the first turn", () => {
    const spend = { turns: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    expect(renderHomePage(overview, "", [], { hubSpend: spend })).not.toContain("hub-spend");
  });
});
