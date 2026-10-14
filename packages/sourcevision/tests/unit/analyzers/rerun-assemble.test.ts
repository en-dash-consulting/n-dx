/**
 * Which previous findings survive a re-run: the judgment where there is one,
 * the content-hash rule where there is not.
 *
 * Driven through `analyzeZones` rather than against `assembleFindings`, which
 * is private — and the rule only means anything in the order the pipeline
 * applies it, after identity preservation has remapped the zone ids the
 * verdicts and the hashes are both keyed on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Finding, Zone, Zones } from "../../../src/schema/index.js";

vi.mock("../../../src/analyzers/enrich-cascade.js", async () => {
  const actual = await import("../../../src/analyzers/enrich-cascade.js");
  return { ...actual, cascadeEnrichment: vi.fn() };
});
vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return {
    callClaude: vi.fn(),
    getJudgmentRoute: vi.fn(() => "typesafe"),
    ClaudeClientError: actual.ClaudeClientError,
    setClaudeConfig: vi.fn(),
    getAuthMode: vi.fn(),
    DEFAULT_MODEL: "claude-sonnet-5",
    resolveLightModel: vi.fn(() => "claude-haiku-4-5"),
  };
});

import { cascadeEnrichment } from "../../../src/analyzers/enrich-cascade.js";
import { analyzeZones, computeZoneContentHash } from "../../../src/analyzers/zones.js";
import { emptyRerunOutcome, findingKey } from "../../../src/analyzers/rerun-judge.js";
import type { RerunOutcome } from "../../../src/analyzers/rerun-judge.js";
import { startRunLedger, snapshotRunLedger } from "../../../src/analyzers/run-ledger.js";
import { makeEdge, makeFileEntry, makeImports, makeInventory, makeZone } from "./zones-helpers.js";

const mockedCascade = vi.mocked(cascadeEnrichment);

const inventory = makeInventory([
  makeFileEntry("src/core/a.ts", { hash: "a1" }),
  makeFileEntry("src/core/b.ts", { hash: "b1" }),
]);
const imports = makeImports([makeEdge("src/core/a.ts", "src/core/b.ts")]);
const core: Zone = makeZone("core", ["src/core/a.ts", "src/core/b.ts"]);

function contentHashFor(zone: Zone): string {
  const fileHashes = new Map(inventory.files.map((f) => [f.path, f.hash]));
  return computeZoneContentHash(zone, fileHashes);
}

/** A judged finding (it carries `confidence`), an unjudged one, and a pass 0 one. */
const judged: Finding = { type: "anti-pattern", pass: 2, scope: "core", text: "Parsing and rendering are tangled.", severity: "warning", confidence: 0.8 };
const unjudged: Finding = { type: "observation", pass: 2, scope: "core", text: "Legacy note with no confidence.", severity: "info" };
const heuristic: Finding = { type: "observation", pass: 0, scope: "core", text: "Low cohesion in core.", severity: "warning" };

/**
 * A previous run of the same inputs, taken from a real structural pass so its
 * structure hash, fingerprint and algorithm version all agree with this run's
 * — a hand-built `Zones` is discarded as a different partition before
 * `assembleFindings` ever sees its findings.
 */
let baseline: Zones;

/** That baseline, carrying `findings`, with a content hash that is stale on purpose. */
function previousRun(findings: Finding[], contentHash = "stale-hash"): Zones {
  return {
    ...baseline,
    zones: baseline.zones.map((z) => ({ ...z, insights: ["core parses and renders"] })),
    enrichmentPass: 2,
    findings,
    zoneContentHashes: Object.fromEntries(baseline.zones.map((z) => [z.id, contentHash])),
  };
}

function cascadeReturning(rerun: RerunOutcome) {
  mockedCascade.mockResolvedValue({
    zones: baseline.zones.map((z) => ({ ...z })),
    newZoneInsights: new Map(),
    newGlobalInsights: [],
    newFindings: [],
    pass: 1,
    enrichedZoneIds: new Set(["core"]),
    fragilityJudged: true,
    escalatedZoneIds: new Set(),
    deferredZoneIds: new Set(),
    deferredNameZoneIds: new Set(),
    prejudgedFindings: [],
    rerun,
  });
}

function textsOf(findings: Finding[] | undefined): string[] {
  return (findings ?? []).map((f) => f.text);
}

beforeEach(async () => {
  mockedCascade.mockReset();
  startRunLedger("cascade");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  baseline = (await analyzeZones(inventory, imports, { enrich: false })).zones;
});

describe("previous findings on a re-run", () => {
  it("carries a judged finding the still-holds Noul confirmed, despite a changed content hash", async () => {
    cascadeReturning({
      ...emptyRerunOutcome(),
      findings: new Map([[findingKey(judged), { verdict: "carry", probability: 0.9 }]]),
      calls: 1,
    });

    const res = await analyzeZones(inventory, imports, { enrich: true, previousZones: previousRun([judged]) });

    expect(textsOf(res.zones.findings)).toContain(judged.text);
    expect(res.zones.findings!.find((f) => f.text === judged.text)!.confidence).toBe(0.8);
  });

  it("drops a judged finding the still-holds Noul resolved", async () => {
    cascadeReturning({
      ...emptyRerunOutcome(),
      findings: new Map([[findingKey(judged), { verdict: "resolve", probability: 0.1 }]]),
      calls: 1,
    });

    const res = await analyzeZones(inventory, imports, { enrich: true, previousZones: previousRun([judged]) });

    expect(textsOf(res.zones.findings)).not.toContain(judged.text);
  });

  it("carries an undecided judged finding with its confidence lowered to the probability", async () => {
    cascadeReturning({
      ...emptyRerunOutcome(),
      findings: new Map([[findingKey(judged), { verdict: "uncertain", probability: 0.45 }]]),
      calls: 1,
    });

    const res = await analyzeZones(inventory, imports, { enrich: true, previousZones: previousRun([judged]) });

    expect(res.zones.findings!.find((f) => f.text === judged.text)).toMatchObject({ confidence: 0.45 });
  });

  it("leaves unjudged and pass 0 findings to the content-hash rule, which drops them on a changed zone", async () => {
    cascadeReturning({
      ...emptyRerunOutcome(),
      findings: new Map([[findingKey(judged), { verdict: "carry", probability: 0.9 }]]),
      calls: 1,
    });

    const res = await analyzeZones(inventory, imports, {
      enrich: true,
      previousZones: previousRun([judged, unjudged, heuristic]),
    });

    const texts = textsOf(res.zones.findings);
    expect(texts).toContain(judged.text);
    expect(texts).not.toContain(unjudged.text);
    // Pass 0 findings are recomputed every run; the previous one is never carried.
    expect(res.zones.findings!.filter((f) => f.text === heuristic.text && f.pass === 0).length).toBeLessThanOrEqual(1);
  });

  it("keeps the content-hash rule in charge when no re-run judgment was made", async () => {
    cascadeReturning(emptyRerunOutcome());

    const res = await analyzeZones(inventory, imports, { enrich: true, previousZones: previousRun([judged]) });

    // No verdict for it, stale hash → dropped, exactly as before this feature.
    expect(textsOf(res.zones.findings)).not.toContain(judged.text);
  });

  it("keeps a judged finding whose zone did not change, with no verdict and a matching hash", async () => {
    cascadeReturning(emptyRerunOutcome());
    const unchanged = previousRun([judged], contentHashFor(core));

    const res = await analyzeZones(inventory, imports, { enrich: true, previousZones: unchanged });

    expect(textsOf(res.zones.findings)).toContain(judged.text);
  });

  it("records the re-run summary on the run ledger", async () => {
    cascadeReturning({
      ...emptyRerunOutcome(),
      summary: { zonesJudged: 2, refreshed: 1, findingsJudged: 3, carried: 2, resolved: 1, uncertain: 1 },
      calls: 1,
    });

    await analyzeZones(inventory, imports, { enrich: true, previousZones: previousRun([judged]) });

    expect(snapshotRunLedger().rerun).toMatchObject({ zonesJudged: 2, refreshed: 1, findingsJudged: 3, resolved: 1 });
  });
});
