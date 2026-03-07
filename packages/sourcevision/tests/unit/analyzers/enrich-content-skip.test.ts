import { describe, it, expect, vi, afterEach } from "vitest";
import { enrichZonesWithAI } from "../../../src/analyzers/enrich.js";
import type { Zone, ZoneCrossing, Zones } from "../../../src/schema/index.js";
import { ClaudeClientError } from "@n-dx/llm-client";
import {
  makeFileEntry,
  makeInventory,
  makeEdge,
  makeImports,
  makeZone,
} from "./zones-helpers.js";
import { computeZoneContentHash, computeGlobalContentHash } from "../../../src/analyzers/zones.js";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return {
    callClaude: vi.fn(),
    ClaudeClientError: actual.ClaudeClientError,
    setClaudeConfig: vi.fn(),
    getAuthMode: vi.fn(),
    DEFAULT_MODEL: "claude-sonnet-4-6",
  };
});

import { callClaude } from "../../../src/analyzers/claude-client.js";
const mockedCallClaude = vi.mocked(callClaude);

function mockClaudeResponse(str: string) {
  mockedCallClaude.mockResolvedValueOnce({ text: str });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const zones: Zone[] = [
  makeZone("zone-a", ["src/a/1.ts", "src/a/2.ts"]),
  makeZone("zone-b", ["src/b/1.ts", "src/b/2.ts"]),
  makeZone("zone-c", ["src/c/1.ts"]),
];

const crossings: ZoneCrossing[] = [
  { from: "src/a/1.ts", to: "src/b/1.ts", fromZone: "zone-a", toZone: "zone-b" },
];

const inventory = makeInventory([
  makeFileEntry("src/a/1.ts", { hash: "aaa1" }),
  makeFileEntry("src/a/2.ts", { hash: "aaa2" }),
  makeFileEntry("src/b/1.ts", { hash: "bbb1" }),
  makeFileEntry("src/b/2.ts", { hash: "bbb2" }),
  makeFileEntry("src/c/1.ts", { hash: "ccc1" }),
]);

const imports = makeImports([makeEdge("src/a/1.ts", "src/b/1.ts")]);

/** Build content hashes matching the given inventory hashes. */
function buildContentHashes(zs: Zone[], inv = inventory) {
  const fileHashes = new Map<string, string>();
  for (const f of inv.files) fileHashes.set(f.path, f.hash);
  const hashes: Record<string, string> = {};
  for (const z of zs) hashes[z.id] = computeZoneContentHash(z, fileHashes);
  return hashes;
}

function makePreviousZones(
  zs: Zone[],
  contentHashes: Record<string, string>,
  enrichmentPass = 2,
): Zones {
  return {
    zones: zs.map((z) => ({
      ...z,
      id: `enriched-${z.id}`,
      name: `Enriched ${z.name}`,
      description: `AI description for ${z.id}`,
    })),
    crossings,
    unzoned: [],
    enrichmentPass,
    structureHash: "stable",
    zoneContentHashes: contentHashes,
  };
}

function makePass1Response(zs: Zone[]) {
  return JSON.stringify({
    zones: zs.map((z) => ({
      algorithmicId: z.id,
      id: `ai-${z.id}`,
      name: `AI ${z.name}`,
      description: `AI desc ${z.id}`,
      insights: [`Insight for ${z.id}`],
    })),
    insights: ["Global insight"],
  });
}

function makePass2Response(zs: Zone[]) {
  return JSON.stringify({
    zones: zs.map((z) => ({
      id: z.id,
      newInsights: [`New insight for ${z.id}`],
    })),
    insights: ["New global insight"],
  });
}

// ── Optimization 1: Global content-hash skip ────────────────────────────────

describe("enrichZonesWithAI content-hash skip (Opt 1)", () => {
  afterEach(() => {
    mockedCallClaude.mockReset();
  });

  it("advances to next pass even when content unchanged", async () => {
    const contentHashes = buildContentHashes(zones);
    const prev = makePreviousZones(zones, contentHashes, 2);

    // Pass 3 proceeds because each pass has different focus
    mockClaudeResponse(makePass2Response(prev.zones));

    const result = await enrichZonesWithAI(
      zones, crossings, inventory, imports, prev, undefined, contentHashes,
    );

    expect(mockedCallClaude).toHaveBeenCalled();
    expect(result.pass).toBe(3); // advanced, not preserved
  });

  it("does not skip when content unchanged but never enriched (pass 0)", async () => {
    const contentHashes = buildContentHashes(zones);
    const prev: Zones = {
      zones: zones,
      crossings,
      unzoned: [],
      enrichmentPass: 0,
      structureHash: "stable",
      zoneContentHashes: contentHashes,
    };

    mockClaudeResponse(makePass1Response(zones));

    const result = await enrichZonesWithAI(
      zones, crossings, inventory, imports, prev, undefined, contentHashes,
    );

    expect(mockedCallClaude).toHaveBeenCalled();
    expect(result.pass).toBe(1);
  });

  it("does not skip when content has changed", async () => {
    const oldHashes = buildContentHashes(zones);
    const prev = makePreviousZones(zones, oldHashes, 2);

    // Change a file hash to simulate code change
    const changedInventory = makeInventory([
      makeFileEntry("src/a/1.ts", { hash: "CHANGED" }),
      makeFileEntry("src/a/2.ts", { hash: "aaa2" }),
      makeFileEntry("src/b/1.ts", { hash: "bbb1" }),
      makeFileEntry("src/b/2.ts", { hash: "bbb2" }),
      makeFileEntry("src/c/1.ts", { hash: "ccc1" }),
    ]);
    const newHashes = buildContentHashes(zones, changedInventory);

    mockClaudeResponse(makePass2Response(prev.zones));

    const result = await enrichZonesWithAI(
      zones, crossings, changedInventory, imports, prev, undefined, newHashes,
    );

    expect(mockedCallClaude).toHaveBeenCalled();
    expect(result.pass).toBe(3);
  });

  it("does not skip when previousZones is undefined (first run / --full)", async () => {
    const contentHashes = buildContentHashes(zones);

    mockClaudeResponse(makePass1Response(zones));

    const result = await enrichZonesWithAI(
      zones, crossings, inventory, imports, undefined, undefined, contentHashes,
    );

    expect(mockedCallClaude).toHaveBeenCalled();
    expect(result.pass).toBe(1);
  });

  it("does not skip when currentContentHashes is undefined", async () => {
    const contentHashes = buildContentHashes(zones);
    const prev = makePreviousZones(zones, contentHashes, 2);

    mockClaudeResponse(makePass2Response(prev.zones));

    const result = await enrichZonesWithAI(
      zones, crossings, inventory, imports, prev, undefined, undefined,
    );

    expect(mockedCallClaude).toHaveBeenCalled();
    expect(result.pass).toBe(3);
  });
});

// ── Optimization 2: Per-zone filtering ──────────────────────────────────────

describe("enrichZonesWithAI per-zone filtering (Opt 2)", () => {
  afterEach(() => {
    mockedCallClaude.mockReset();
  });

  it("only enriches changed zones, preserving unchanged zone data", async () => {
    const oldHashes = buildContentHashes(zones);
    const prev = makePreviousZones(zones, oldHashes, 2);

    // Change only zone-a (file src/a/1.ts hash changed)
    const changedInventory = makeInventory([
      makeFileEntry("src/a/1.ts", { hash: "CHANGED" }),
      makeFileEntry("src/a/2.ts", { hash: "aaa2" }),
      makeFileEntry("src/b/1.ts", { hash: "bbb1" }),
      makeFileEntry("src/b/2.ts", { hash: "bbb2" }),
      makeFileEntry("src/c/1.ts", { hash: "ccc1" }),
    ]);
    const newHashes = buildContentHashes(zones, changedInventory);

    // LLM should only receive zone-a
    const pass2Response = JSON.stringify({
      zones: [
        { id: "enriched-zone-a", newInsights: ["Zone A was re-analyzed"] },
      ],
      insights: ["Updated global insight"],
    });
    mockClaudeResponse(pass2Response);

    const result = await enrichZonesWithAI(
      zones, crossings, changedInventory, imports, prev, undefined, newHashes,
    );

    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
    expect(result.pass).toBe(3);
    // Result should contain all 3 zones
    expect(result.zones).toHaveLength(3);

    // Unchanged zones should preserve previous enriched data
    const zoneB = result.zones.find((z) => z.id === "enriched-zone-b");
    expect(zoneB).toBeDefined();
    expect(zoneB!.name).toBe("Enriched Zone-b");

    const zoneC = result.zones.find((z) => z.id === "enriched-zone-c");
    expect(zoneC).toBeDefined();
    expect(zoneC!.name).toBe("Enriched Zone-c");
  });

  it("batches all zones when all have changed", async () => {
    const oldHashes = buildContentHashes(zones);
    const prev = makePreviousZones(zones, oldHashes, 2);

    // Change all files
    const changedInventory = makeInventory([
      makeFileEntry("src/a/1.ts", { hash: "X1" }),
      makeFileEntry("src/a/2.ts", { hash: "X2" }),
      makeFileEntry("src/b/1.ts", { hash: "X3" }),
      makeFileEntry("src/b/2.ts", { hash: "X4" }),
      makeFileEntry("src/c/1.ts", { hash: "X5" }),
    ]);
    const newHashes = buildContentHashes(zones, changedInventory);

    mockClaudeResponse(makePass2Response(prev.zones));

    const result = await enrichZonesWithAI(
      zones, crossings, changedInventory, imports, prev, undefined, newHashes,
    );

    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
    expect(result.pass).toBe(3);
    expect(result.zones).toHaveLength(3);
  });

  it("includes all zones as context in LLM prompt even when filtering", async () => {
    const oldHashes = buildContentHashes(zones);
    const prev = makePreviousZones(zones, oldHashes, 1);

    // Change only zone-c
    const changedInventory = makeInventory([
      makeFileEntry("src/a/1.ts", { hash: "aaa1" }),
      makeFileEntry("src/a/2.ts", { hash: "aaa2" }),
      makeFileEntry("src/b/1.ts", { hash: "bbb1" }),
      makeFileEntry("src/b/2.ts", { hash: "bbb2" }),
      makeFileEntry("src/c/1.ts", { hash: "CHANGED" }),
    ]);
    const newHashes = buildContentHashes(zones, changedInventory);

    // The enrichBatch call receives `zones` (all zones) as the allZones parameter
    // for cross-zone context, even though only zone-c is in the batch
    const pass2Response = JSON.stringify({
      zones: [
        { id: "enriched-zone-c", newInsights: ["Zone C updated"] },
      ],
      insights: [],
    });
    mockClaudeResponse(pass2Response);

    const result = await enrichZonesWithAI(
      zones, crossings, changedInventory, imports, prev, undefined, newHashes,
    );

    expect(mockedCallClaude).toHaveBeenCalledTimes(1);

    // The second argument to enrichBatch (allZones) should be the full list
    const call = mockedCallClaude.mock.calls[0];
    const prompt = call[0] as string;
    // All zones should appear in the "other zones" context
    expect(prompt).toContain("zone-a");
    expect(prompt).toContain("zone-b");
  });

  it("does not filter on pass 1 (first enrichment)", async () => {
    const oldHashes = buildContentHashes(zones);
    // Previous pass 0 means currentContentHashes won't trigger filtering
    // (prevEnrichPass > 0 required)
    const prev: Zones = {
      zones: zones,
      crossings,
      unzoned: [],
      enrichmentPass: 0,
      structureHash: "stable",
      zoneContentHashes: oldHashes,
    };

    // Change only one zone
    const changedInventory = makeInventory([
      makeFileEntry("src/a/1.ts", { hash: "CHANGED" }),
      makeFileEntry("src/a/2.ts", { hash: "aaa2" }),
      makeFileEntry("src/b/1.ts", { hash: "bbb1" }),
      makeFileEntry("src/b/2.ts", { hash: "bbb2" }),
      makeFileEntry("src/c/1.ts", { hash: "ccc1" }),
    ]);
    const newHashes = buildContentHashes(zones, changedInventory);

    // All 3 zones should be sent since pass 0 → 1 doesn't filter
    mockClaudeResponse(makePass1Response(zones));

    const result = await enrichZonesWithAI(
      zones, crossings, changedInventory, imports, prev, undefined, newHashes,
    );

    expect(result.pass).toBe(1);
    // All zones should be enriched (no filtering on first pass)
    expect(result.zones).toHaveLength(3);
    expect(result.zones.every((z) => z.id.startsWith("ai-"))).toBe(true);
  });
});
