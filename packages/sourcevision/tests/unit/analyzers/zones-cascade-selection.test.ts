/**
 * analyzeZones picks the cascade only when a judgment route resolves and
 * `narrate` is off. Everything else — including the whole no-key path — goes
 * through the generative enrichment exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFileEntry, makeInventory, makeImports, makeEdge } from "./zones-helpers.js";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return {
    callClaude: vi.fn(),
    getJudgmentRoute: vi.fn(() => undefined),
    ClaudeClientError: actual.ClaudeClientError,
    setClaudeConfig: vi.fn(),
    getAuthMode: vi.fn(),
    resolveLightModel: vi.fn(() => "claude-haiku-4-5"),
  };
});
vi.mock("../../../src/analyzers/enrich-cascade.js", () => ({
  cascadeEnrichment: vi.fn(),
}));
vi.mock("../../../src/analyzers/enrich.js", async () => {
  const actual = await import("../../../src/analyzers/enrich.js");
  return { ...actual, enrichZonesWithAI: vi.fn(), enrichZonesPerZone: vi.fn() };
});

import { getJudgmentRoute } from "../../../src/analyzers/claude-client.js";
import { cascadeEnrichment } from "../../../src/analyzers/enrich-cascade.js";
import { enrichZonesWithAI } from "../../../src/analyzers/enrich.js";
import { analyzeZones, reapplyCascadeLabels } from "../../../src/analyzers/zones.js";
import { startRunLedger, snapshotRunLedger } from "../../../src/analyzers/run-ledger.js";

const mockedRoute = vi.mocked(getJudgmentRoute);
const mockedCascade = vi.mocked(cascadeEnrichment);
const mockedGenerative = vi.mocked(enrichZonesWithAI);

const inventory = makeInventory([
  makeFileEntry("src/a/one.ts"), makeFileEntry("src/a/two.ts"), makeFileEntry("src/a/three.ts"),
  makeFileEntry("src/b/one.ts"), makeFileEntry("src/b/two.ts"), makeFileEntry("src/b/three.ts"),
]);
const imports = makeImports([
  makeEdge("src/a/one.ts", "src/a/two.ts"), makeEdge("src/a/two.ts", "src/a/three.ts"),
  makeEdge("src/b/one.ts", "src/b/two.ts"), makeEdge("src/b/two.ts", "src/b/three.ts"),
  makeEdge("src/a/one.ts", "src/b/one.ts"),
]);

function passThrough(zones: any) {
  return { zones, newZoneInsights: new Map(), newGlobalInsights: [], newFindings: [], pass: 1 };
}

beforeEach(() => {
  mockedRoute.mockReset();
  mockedCascade.mockReset();
  mockedGenerative.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockedGenerative.mockImplementation(async (zones) => passThrough(zones));
  mockedCascade.mockImplementation(async (zones) => ({ ...passThrough(zones), fragilityJudged: true as const, escalatedZoneIds: new Set<string>(), deferredZoneIds: new Set<string>(), deferredNameZoneIds: new Set<string>(), prejudgedFindings: [] }));
  startRunLedger("generative");
});

describe("analyzeZones enrichment selection", () => {
  it("takes the cascade when a route resolves and records the mode", async () => {
    mockedRoute.mockReturnValue("typesafe");
    await analyzeZones(inventory, imports, { enrich: true });
    expect(mockedCascade).toHaveBeenCalledTimes(1);
    expect(mockedGenerative).not.toHaveBeenCalled();
    expect(snapshotRunLedger().mode).toBe("cascade");
  });

  it("takes the generative path with --narrate even when a route resolves", async () => {
    mockedRoute.mockReturnValue("typesafe");
    await analyzeZones(inventory, imports, { enrich: true, narrate: true });
    expect(mockedCascade).not.toHaveBeenCalled();
    expect(mockedGenerative).toHaveBeenCalledTimes(1);
    expect(snapshotRunLedger().mode).toBe("generative");
  });

  it("takes the generative path without a route", async () => {
    await analyzeZones(inventory, imports, { enrich: true });
    expect(mockedCascade).not.toHaveBeenCalled();
    expect(mockedGenerative).toHaveBeenCalledTimes(1);
  });

  it("passes deferNarration to the cascade and maps deferred zones to their final ids", async () => {
    mockedRoute.mockReturnValue("typesafe");
    mockedCascade.mockImplementationOnce(async (zones) => ({
      ...passThrough(zones), fragilityJudged: true as const, prejudgedFindings: [],
      escalatedZoneIds: new Set([zones[0].id]), deferredZoneIds: new Set([zones[0].id]), deferredNameZoneIds: new Set([zones[1].id]),
    }));
    const res = await analyzeZones(inventory, imports, { enrich: true, deferNarration: true });
    expect(mockedCascade.mock.calls[0][8]).toEqual({ deferNarration: true });
    expect(res.pendingNarration).toHaveLength(1);
    expect(res.pendingNames).toHaveLength(1);
    expect(res.zones.zones.map((z) => z.id)).toContain(res.pendingNarration![0]);
    expect(res.zones.zones.map((z) => z.id)).toContain(res.pendingNames![0]);
    expect(res.pendingNames![0]).not.toBe(res.pendingNarration![0]);
  });

  it("does neither in fast mode", async () => {
    mockedRoute.mockReturnValue("typesafe");
    await analyzeZones(inventory, imports, { enrich: false });
    expect(mockedCascade).not.toHaveBeenCalled();
    expect(mockedGenerative).not.toHaveBeenCalled();
  });
});

describe("reapplyCascadeLabels", () => {
  const files = ["src/a/one.ts", "src/a/two.ts"];
  const cascade = [{ id: "a", name: "Selected A", description: "2 files; imports B.", files, entryPoints: [], cohesion: 1, coupling: 0 }];

  it("always takes the templated description, and the selected name only over an algorithmic default", () => {
    const preservedDefault = [{ ...cascade[0], id: "src-a", name: "Src A", description: "old prose" }];
    expect(reapplyCascadeLabels(preservedDefault, cascade)[0]).toMatchObject({ id: "src-a", name: "Selected A", description: "2 files; imports B." });

    const preservedChosen = [{ ...cascade[0], id: "src-a", name: "Chosen Long Ago", description: "old prose" }];
    expect(reapplyCascadeLabels(preservedChosen, cascade)[0]).toMatchObject({ name: "Chosen Long Ago", description: "2 files; imports B." });
  });

  it("leaves zones with no cascade counterpart untouched", () => {
    const other = [{ id: "x", name: "X", description: "d", files: ["z.ts"], entryPoints: [], cohesion: 1, coupling: 0 }];
    expect(reapplyCascadeLabels(other, cascade)).toEqual(other);
  });
});
