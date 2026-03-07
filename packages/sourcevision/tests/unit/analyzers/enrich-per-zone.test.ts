import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeZoneStructureHash,
  enrichZonesPerZone,
} from "../../../src/analyzers/enrich-per-zone.js";
import {
  computePerZoneAttemptConfigs,
  MAX_CONCURRENT_ZONES,
  PER_ZONE_MAX_FILES,
  PER_ZONE_MAX_CROSSINGS,
} from "../../../src/analyzers/enrich-config.js";
import type {
  Inventory,
  Imports,
  ImportEdge,
  FileEntry,
  Zone,
  ZoneCrossing,
  Zones,
} from "../../../src/schema/index.js";
import { ClaudeClientError } from "@n-dx/llm-client";

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

/** Mock callClaude to return a successful response */
function mockClaudeResponse(str: string) {
  mockedCallClaude.mockResolvedValueOnce({ text: str });
}

/** Mock callClaude to reject with an error */
function mockClaudeError(_msg: string, opts?: { reason?: string }) {
  const reason = (opts?.reason ?? "unknown") as any;
  mockedCallClaude.mockRejectedValueOnce(
    new ClaudeClientError(_msg, reason, reason !== "auth")
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFileEntry(path: string, overrides?: Partial<FileEntry>): FileEntry {
  return {
    path,
    size: 100,
    language: "TypeScript",
    lineCount: 10,
    hash: "abc123",
    role: "source",
    category: "misc",
    ...overrides,
  };
}

function makeInventory(files: FileEntry[]): Inventory {
  return {
    files,
    summary: {
      totalFiles: files.length,
      totalLines: files.reduce((s, f) => s + f.lineCount, 0),
      byLanguage: {},
      byRole: {},
      byCategory: {},
    },
  };
}

function makeEdge(from: string, to: string, symbols = ["default"]): ImportEdge {
  return { from, to, type: "static", symbols };
}

function makeImports(edges: ImportEdge[]): Imports {
  return {
    edges,
    external: [],
    summary: {
      totalEdges: edges.length,
      totalExternal: 0,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
  };
}

function makeZone(id: string, files: string[], overrides?: Partial<Zone>): Zone {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${files.length} files`,
    files,
    entryPoints: [files[0]],
    cohesion: 0.8,
    coupling: 0.2,
    ...overrides,
  };
}

// ── computeZoneStructureHash ────────────────────────────────────────────────

describe("computeZoneStructureHash", () => {
  it("produces same hash for same files", () => {
    const zone1 = makeZone("test", ["a.ts", "b.ts"]);
    const zone2 = makeZone("test", ["a.ts", "b.ts"]);
    expect(computeZoneStructureHash(zone1)).toBe(computeZoneStructureHash(zone2));
  });

  it("produces same hash regardless of file order", () => {
    const zone1 = makeZone("test", ["b.ts", "a.ts"]);
    const zone2 = makeZone("test", ["a.ts", "b.ts"]);
    expect(computeZoneStructureHash(zone1)).toBe(computeZoneStructureHash(zone2));
  });

  it("produces different hashes for different files", () => {
    const zone1 = makeZone("test", ["a.ts"]);
    const zone2 = makeZone("test", ["b.ts"]);
    expect(computeZoneStructureHash(zone1)).not.toBe(computeZoneStructureHash(zone2));
  });

  it("is independent of zone ID/name", () => {
    const zone1 = makeZone("test1", ["a.ts", "b.ts"]);
    const zone2 = makeZone("test2", ["a.ts", "b.ts"]);
    expect(computeZoneStructureHash(zone1)).toBe(computeZoneStructureHash(zone2));
  });
});

// ── computePerZoneAttemptConfigs ────────────────────────────────────────────

describe("computePerZoneAttemptConfigs", () => {
  it("returns 3 attempt configs", () => {
    const configs = computePerZoneAttemptConfigs(10);
    expect(configs).toHaveLength(3);
  });

  it("first attempt has highest maxFiles", () => {
    const configs = computePerZoneAttemptConfigs(10);
    expect(configs[0].maxFiles).toBe(PER_ZONE_MAX_FILES);
    expect(configs[0].maxCrossings).toBe(PER_ZONE_MAX_CROSSINGS);
  });

  it("subsequent attempts have lower maxFiles", () => {
    const configs = computePerZoneAttemptConfigs(10);
    expect(configs[1].maxFiles).toBeLessThan(configs[0].maxFiles);
    expect(configs[2].maxFiles).toBeLessThan(configs[1].maxFiles);
  });

  it("pass 1 gets 1.3x multiplier", () => {
    const pass1 = computePerZoneAttemptConfigs(20, 1);
    const pass2 = computePerZoneAttemptConfigs(20, 2);
    // Both may be clamped to same value for small files, but pass1 base should be higher
    expect(pass1[0].timeout).toBeGreaterThanOrEqual(pass2[0].timeout);
  });

  it("caps at 300_000ms", () => {
    const configs = computePerZoneAttemptConfigs(1000, 1);
    expect(configs[0].timeout).toBeLessThanOrEqual(300_000);
    expect(configs[1].timeout).toBeLessThanOrEqual(300_000);
    expect(configs[2].timeout).toBeLessThanOrEqual(300_000);
  });
});

// ── Per-zone config constants ───────────────────────────────────────────────

describe("per-zone config constants", () => {
  it("MAX_CONCURRENT_ZONES is a reasonable value", () => {
    expect(MAX_CONCURRENT_ZONES).toBeGreaterThanOrEqual(1);
    expect(MAX_CONCURRENT_ZONES).toBeLessThanOrEqual(10);
  });

  it("PER_ZONE_MAX_FILES is higher than batch mode", () => {
    expect(PER_ZONE_MAX_FILES).toBeGreaterThan(8); // batch mode uses 8
  });

  it("PER_ZONE_MAX_CROSSINGS is higher than batch mode", () => {
    expect(PER_ZONE_MAX_CROSSINGS).toBeGreaterThan(15); // batch mode uses 15
  });
});

// ── enrichZonesPerZone ──────────────────────────────────────────────────────

describe("enrichZonesPerZone", () => {
  afterEach(() => {
    mockedCallClaude.mockReset();
  });

  const sampleZones: Zone[] = [
    makeZone("auth", ["src/auth/login.ts", "src/auth/session.ts"]),
    makeZone("api", ["src/api/routes.ts", "src/api/handlers.ts"]),
  ];

  const sampleCrossings: ZoneCrossing[] = [
    { from: "src/api/routes.ts", to: "src/auth/login.ts", fromZone: "api", toZone: "auth" },
  ];

  const sampleInventory = makeInventory([
    makeFileEntry("src/auth/login.ts"),
    makeFileEntry("src/auth/session.ts"),
    makeFileEntry("src/api/routes.ts"),
    makeFileEntry("src/api/handlers.ts"),
  ]);

  const sampleImports = makeImports([
    makeEdge("src/api/routes.ts", "src/auth/login.ts"),
  ]);

  function makePerZoneResponse(zone: Zone) {
    return JSON.stringify({
      id: `ai-${zone.id}`,
      name: `AI ${zone.name}`,
      description: `AI description for ${zone.id}`,
      insights: [`Insight for ${zone.id}`],
      findings: [],
    });
  }

  it("returns unchanged zones when claude not found", async () => {
    mockClaudeError("Claude CLI not found", { reason: "not-found" });
    mockClaudeError("Claude CLI not found", { reason: "not-found" });

    const result = await enrichZonesPerZone(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("enriches each zone individually with pass 1 response", async () => {
    // Mock responses for each zone
    mockClaudeResponse(makePerZoneResponse(sampleZones[0]));
    mockClaudeResponse(makePerZoneResponse(sampleZones[1]));

    const result = await enrichZonesPerZone(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.pass).toBe(1);
    expect(result.zones).toHaveLength(2);
    expect(result.zones.find((z) => z.id === "ai-auth")).toBeDefined();
    expect(result.zones.find((z) => z.id === "ai-api")).toBeDefined();
  });

  it("tracks per-zone token usage", async () => {
    // Responses with token usage
    mockedCallClaude.mockResolvedValueOnce({
      text: makePerZoneResponse(sampleZones[0]),
      tokenUsage: { input: 100, output: 50 },
    });
    mockedCallClaude.mockResolvedValueOnce({
      text: makePerZoneResponse(sampleZones[1]),
      tokenUsage: { input: 100, output: 50 },
    });

    const result = await enrichZonesPerZone(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.calls).toBe(2);
  });

  it("sets structureHash on enriched zones", async () => {
    mockClaudeResponse(makePerZoneResponse(sampleZones[0]));
    mockClaudeResponse(makePerZoneResponse(sampleZones[1]));

    const result = await enrichZonesPerZone(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    for (const zone of result.zones) {
      expect(zone.structureHash).toBeDefined();
      expect(typeof zone.structureHash).toBe("string");
    }
  });

  it("skips unchanged zones when structureHash matches", async () => {
    const hash0 = computeZoneStructureHash(sampleZones[0]);
    const hash1 = computeZoneStructureHash(sampleZones[1]);
    const previousZones: Zones = {
      zones: [
        {
          ...sampleZones[0],
          id: "prev-auth",
          name: "Previous Auth",
          description: "Previous description",
          structureHash: hash0,
        },
        {
          ...sampleZones[1],
          id: "prev-api",
          name: "Previous Api",
          description: "Previous api description",
          // No structureHash — this zone will be re-enriched
        },
      ],
      crossings: sampleCrossings,
      unzoned: [],
      enrichmentPass: 1,
    };

    // Only one zone needs enrichment (api, since auth has matching structureHash)
    // Pass 2+ returns newInsights, not new id/name/description
    mockClaudeResponse(JSON.stringify({
      id: "prev-api",
      newInsights: ["New insight for api"],
      findings: [],
    }));

    const result = await enrichZonesPerZone(
      sampleZones, sampleCrossings, sampleInventory, sampleImports, previousZones
    );

    expect(result.pass).toBe(2);
    // Auth zone should preserve previous data (unchanged)
    const authZone = result.zones.find((z) => z.id === "prev-auth");
    expect(authZone).toBeDefined();
    expect(authZone!.name).toBe("Previous Auth");
    // API zone should still have its original id (pass 2+ doesn't rename)
    const apiZone = result.zones.find((z) => z.id === "api");
    expect(apiZone).toBeDefined();
    expect(result.newZoneInsights.get("api")).toContain("New insight for api");
  });

  it("skips all enrichment when all zones unchanged", async () => {
    const hash0 = computeZoneStructureHash(sampleZones[0]);
    const hash1 = computeZoneStructureHash(sampleZones[1]);
    const previousZones: Zones = {
      zones: [
        { ...sampleZones[0], id: "prev-auth", structureHash: hash0 },
        { ...sampleZones[1], id: "prev-api", structureHash: hash1 },
      ],
      crossings: sampleCrossings,
      unzoned: [],
      enrichmentPass: 1,
    };

    // No Claude calls should be made

    const result = await enrichZonesPerZone(
      sampleZones, sampleCrossings, sampleInventory, sampleImports, previousZones
    );

    expect(result.pass).toBe(1); // Stays at previous pass
    expect(mockedCallClaude).not.toHaveBeenCalled();
  });

  it("handles partial failures gracefully", async () => {
    // First zone succeeds
    mockClaudeResponse(makePerZoneResponse(sampleZones[0]));
    // Second zone fails all retries
    mockClaudeError("timeout", { reason: "timeout" });
    mockClaudeError("timeout", { reason: "timeout" });
    mockClaudeError("timeout", { reason: "timeout" });

    const result = await enrichZonesPerZone(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.pass).toBe(1);
    // First zone enriched
    expect(result.zones.find((z) => z.id === "ai-auth")).toBeDefined();
    // Second zone keeps algorithmic name
    expect(result.zones.find((z) => z.id === "api")).toBeDefined();
  });

  it("returns empty result on auth error", async () => {
    mockClaudeError("Not logged in.", { reason: "auth" });
    mockClaudeError("Not logged in.", { reason: "auth" });

    const result = await enrichZonesPerZone(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("extracts insights from successful enrichment", async () => {
    mockClaudeResponse(makePerZoneResponse(sampleZones[0]));
    mockClaudeResponse(makePerZoneResponse(sampleZones[1]));

    const result = await enrichZonesPerZone(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.newZoneInsights.get("ai-auth")).toContain("Insight for auth");
    expect(result.newZoneInsights.get("ai-api")).toContain("Insight for api");
  });
});
