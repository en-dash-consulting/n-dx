import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Zone, ZoneCrossing, Finding } from "../../../src/schema/index.js";
import { makeFileEntry, makeInventory, makeImports } from "./zones-helpers.js";

vi.mock("../../../src/analyzers/zone-naming.js", async () => {
  const actual = await import("../../../src/analyzers/zone-naming.js");
  return {
    ...actual,
    nameZonesBySelection: vi.fn(),
    describeZoneFromFacts: vi.fn(() => "templated description."),
  };
});
vi.mock("../../../src/analyzers/enrich-judge.js", async () => {
  const actual = await import("../../../src/analyzers/enrich-judge.js");
  return { ...actual, assessZoneFragility: vi.fn() };
});
vi.mock("../../../src/analyzers/enrich-per-zone.js", () => ({
  enrichZonesPerZone: vi.fn(),
}));

import { nameZonesBySelection } from "../../../src/analyzers/zone-naming.js";
import { assessZoneFragility } from "../../../src/analyzers/enrich-judge.js";
import { enrichZonesPerZone } from "../../../src/analyzers/enrich-per-zone.js";
import { cascadeEnrichment, dedupeZoneNames, ESCALATION_BAND, ESCALATION_MAX_ZONES } from "../../../src/analyzers/enrich-cascade.js";

const mockedNaming = vi.mocked(nameZonesBySelection);
const mockedFragility = vi.mocked(assessZoneFragility);
const mockedPerZone = vi.mocked(enrichZonesPerZone);

function zone(id: string, files: string[]): Zone {
  return { id, name: id, description: "algo", files, entryPoints: [], cohesion: 0.5, coupling: 0.5 };
}

const src = zone("core", ["src/a.ts", "src/b.ts"]);
const ui = zone("ui", ["ui/x.ts"]);
const docs = zone("docs", ["docs/readme.md"]);
const inventory = makeInventory([
  makeFileEntry("src/a.ts"),
  makeFileEntry("src/b.ts"),
  makeFileEntry("ui/x.ts"),
  makeFileEntry("docs/readme.md", { role: "docs", language: "Markdown" }),
]);
const imports = makeImports([]);
const crossings: ZoneCrossing[] = [{ from: "ui/x.ts", to: "src/a.ts", fromZone: "ui", toZone: "core" }];

beforeEach(() => {
  mockedNaming.mockReset();
  mockedFragility.mockReset();
  mockedPerZone.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockedNaming.mockImplementation(async (zones) => ({
    zones: zones.map((z) => ({ ...z, name: `Named ${z.id}` })),
    findings: [],
    calls: 1,
    tokenUsage: { input: 50, output: 5 },
    renamed: zones.length,
    merged: 0,
    escalated: 0,
    skippedFallback: 0,
  }));
});

describe("cascadeEnrichment", () => {
  it("templates structural zones, names source zones by selection, and describes them from facts", async () => {
    mockedFragility.mockResolvedValueOnce({ probabilities: new Map(), calls: 0 });

    const res = await cascadeEnrichment([src, ui, docs], crossings, inventory, imports);

    expect(mockedNaming).toHaveBeenCalledTimes(1);
    expect(mockedNaming.mock.calls[0][0].map((z) => z.id)).toEqual(["core", "ui"]);
    const byId = new Map(res.zones.map((z) => [z.id, z]));
    expect(byId.get("core")).toMatchObject({ name: "Named core", description: "templated description." });
    expect(byId.get("docs")!.name).toBe("Documentation Site");
    expect(res.pass).toBe(1);
    expect(res.fragilityJudged).toBe(true);
    expect(res.tokenUsage).toMatchObject({ calls: 1, inputTokens: 50, outputTokens: 5 });
    expect(mockedPerZone).not.toHaveBeenCalled();
  });

  it("bands fragility: a finding above the band, nothing below, escalation inside it", async () => {
    mockedFragility.mockResolvedValueOnce({
      probabilities: new Map([
        ["core", { unrelated: 0.9, overdependent: 0.1 }],
        ["ui", { unrelated: 0.2, overdependent: (ESCALATION_BAND[0] + ESCALATION_BAND[1]) / 2 }],
      ]),
      calls: 1,
      tokenUsage: { input: 30, output: 2 },
    });
    const narratedFinding: Finding = { type: "suggestion", pass: 2, scope: "ui", text: "Split the hub.", severity: "warning" };
    mockedPerZone.mockResolvedValueOnce({
      zones: [{ ...ui, name: "Named ui", insights: ["hub does too much"], structureHash: "h1" }],
      newZoneInsights: new Map([["ui", ["hub does too much"]]]),
      newGlobalInsights: [],
      newFindings: [narratedFinding],
      pass: 2,
      tokenUsage: { calls: 1, inputTokens: 900, outputTokens: 80 },
    });

    const res = await cascadeEnrichment([src, ui], crossings, inventory, imports, undefined, undefined, "hint");

    // Above the band → templated finding for core, kept apart from narrated
    // findings so the support judgment never sees it; inside it → ui
    // escalated, and only ui.
    expect(res.prejudgedFindings.filter((f) => f.scope === "core")).toHaveLength(1);
    expect(res.prejudgedFindings.find((f) => f.scope === "core")).toMatchObject({ category: "structural", confidence: 0.9 });
    expect(res.newFindings.filter((f) => f.scope === "core")).toHaveLength(0);
    expect(mockedPerZone).toHaveBeenCalledTimes(1);
    const [escalated, , , , synthetic, , hints] = mockedPerZone.mock.calls[0];
    expect(escalated.map((z) => z.id)).toEqual(["ui"]);
    expect(synthetic?.enrichmentPass).toBe(1); // runs as pass 2 → names preserved
    expect(hints).toBe("hint");
    expect(res.escalatedZoneIds).toEqual(new Set(["ui"]));
    // Narrated output flows through: findings, insights, but the cascade's name and description stay.
    expect(res.newFindings).toContainEqual(narratedFinding);
    expect(res.newZoneInsights.get("ui")).toEqual(["hub does too much"]);
    expect(res.zones.find((z) => z.id === "ui")).toMatchObject({ name: "Named ui", description: "templated description.", insights: ["hub does too much"] });
    expect(res.tokenUsage).toMatchObject({ calls: 3, inputTokens: 980, outputTokens: 87 });
  });

  it("does not narrate an escalated zone the previous run already narrated on the same files, and keeps its insights", async () => {
    mockedFragility.mockResolvedValueOnce({
      probabilities: new Map([["core", { unrelated: 0.5 }]]),
      calls: 1,
    });
    const previous = { zones: [{ ...src, structureHash: "prev-hash", insights: ["old"] }], crossings: [], unzoned: [], enrichmentPass: 1 };

    const res = await cascadeEnrichment([src], [], inventory, imports, previous);

    expect(mockedPerZone).not.toHaveBeenCalled();
    expect(res.zones.find((z) => z.id === "core")).toMatchObject({ insights: ["old"], structureHash: "prev-hash" });
    expect(res.escalatedZoneIds).toEqual(new Set(["core"]));
  });

  it("narrates an escalated zone whose previous match has different files, with the previous hashes in the synthetic previous", async () => {
    mockedFragility.mockResolvedValueOnce({
      probabilities: new Map([["core", { unrelated: 0.5 }]]),
      calls: 1,
    });
    mockedPerZone.mockResolvedValueOnce({
      zones: [], newZoneInsights: new Map(), newGlobalInsights: [], newFindings: [], pass: 2,
    });
    // Same id, but only one of two files in common → 50% overlap: below the carry threshold.
    const previous = { zones: [{ ...src, files: ["src/a.ts", "src/z.ts"], structureHash: "prev-hash", insights: ["old"] }], crossings: [], unzoned: [], enrichmentPass: 1 };

    await cascadeEnrichment([src], [], inventory, imports, previous);

    expect(mockedPerZone).toHaveBeenCalledTimes(1);
    const synthetic = mockedPerZone.mock.calls[0][4];
    expect(synthetic?.zones.find((z) => z.id === "core")).toMatchObject({ structureHash: "prev-hash", insights: ["old"] });
  });
});

describe("cascadeEnrichment — previous names", () => {
  it("does not re-select a name a previous run chose, and keeps it", async () => {
    mockedFragility.mockResolvedValueOnce({ probabilities: new Map(), calls: 0 });
    const previous = {
      zones: [
        { ...src, name: "Core Orchestration" },   // chosen earlier → inherited, not re-selected
        { ...ui, name: "Ui" },                     // algorithmic default → selected again
      ],
      crossings: [], unzoned: [], enrichmentPass: 1,
    };

    const res = await cascadeEnrichment([src, ui], crossings, inventory, imports, previous);

    expect(mockedNaming.mock.calls[0][0].map((z) => z.id)).toEqual(["ui"]);
    // ui kept its algorithmic name on exactly these files last run: no generated-name fallback again.
    expect(mockedNaming.mock.calls[0][1].skipGeneratedNames).toEqual(new Set(["ui"]));
    expect(res.zones.find((z) => z.id === "core")!.name).toBe("Core Orchestration");
    expect(res.zones.find((z) => z.id === "ui")!.name).toBe("Named ui");
  });

  it("allows the generated-name fallback again once the zone's files change", async () => {
    mockedFragility.mockResolvedValueOnce({ probabilities: new Map(), calls: 0 });
    const grown = zone("ui", ["ui/x.ts", "ui/y.ts", "ui/z.ts"]);
    const inv = makeInventory([makeFileEntry("ui/x.ts"), makeFileEntry("ui/y.ts"), makeFileEntry("ui/z.ts")]);
    const previous = { zones: [{ ...ui, name: "Ui" }], crossings: [], unzoned: [], enrichmentPass: 1 };

    await cascadeEnrichment([grown], [], inv, imports, previous);

    expect(mockedNaming.mock.calls[0][1].skipGeneratedNames).toEqual(new Set());
  });
});

describe("dedupeZoneNames", () => {
  it("keeps the largest zone's name and gives the rest their algorithmic name", () => {
    const zones = [
      zone("hench", ["a", "b", "c"]), zone("hench-store", ["d"]), zone("tests-e2e", ["e", "f"]), zone("tests-unit", ["g"]), zone("web", ["h"]),
    ].map((z, i) => ({ ...z, name: ["Hench", "Hench", "Tests", "Tests", "Web"][i] }));
    expect(dedupeZoneNames(zones).map((z) => z.name)).toEqual(["Hench", "Hench Store", "Tests", "Tests Unit", "Web"]);
  });
  it("is identity when names are unique", () => {
    const zones = [zone("a", ["x"]), zone("b", ["y"])].map((z, i) => ({ ...z, name: ["A", "B"][i] }));
    expect(dedupeZoneNames(zones)).toBe(zones);
  });
});

describe("cascadeEnrichment — escalation cap", () => {
  it("escalates at most ESCALATION_MAX_ZONES zones, the highest in-band probability first", async () => {
    const many = Array.from({ length: ESCALATION_MAX_ZONES + 2 }, (_, i) => zone(`z${i}`, [`z${i}/a.ts`]));
    const inv = makeInventory(many.map((z) => makeFileEntry(z.files[0])));
    const lo = ESCALATION_BAND[0], hi = ESCALATION_BAND[1];
    // z0 highest in band … last lowest; all inside the band.
    const probs = new Map(many.map((z, i) => [z.id, { unrelated: hi - 0.001 - i * ((hi - lo) / (many.length + 1)), overdependent: 0.1 }]));
    mockedFragility.mockResolvedValueOnce({ probabilities: probs, calls: 1 });
    mockedPerZone.mockResolvedValueOnce({ zones: [], newZoneInsights: new Map(), newGlobalInsights: [], newFindings: [], pass: 2 });

    const res = await cascadeEnrichment(many, [], inv, imports);

    const escalated = mockedPerZone.mock.calls[0][0].map((z) => z.id);
    expect(escalated).toEqual(many.slice(0, ESCALATION_MAX_ZONES).map((z) => z.id));
    expect(res.escalatedZoneIds.size).toBe(ESCALATION_MAX_ZONES);
  });
});
