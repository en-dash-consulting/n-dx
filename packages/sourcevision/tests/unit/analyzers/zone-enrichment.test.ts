import { describe, it, expect, vi, afterEach } from "vitest";
import {
  enrichZonesWithAI,
  computeAttemptConfigs,
  extractFindings,
  buildMetaPrompt,
} from "../../../src/analyzers/enrich.js";
import { enforceSeverityRules } from "../../../src/analyzers/enrich-parsing.js";
import type {
  Zone,
  ZoneCrossing,
  Finding,
} from "../../../src/schema/index.js";
import { ClaudeClientError } from "@n-dx/llm-client";
import {
  makeFileEntry,
  makeInventory,
  makeEdge,
  makeImports,
} from "./zones-helpers.js";

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

// ── enrichZonesWithAI ──────────────────────────────────────────────────────

describe("enrichZonesWithAI", () => {
  afterEach(() => {
    mockedCallClaude.mockReset();
  });

  const sampleZones: Zone[] = [
    {
      id: "analyzers",
      name: "Analyzers",
      description: "3 files, primarily TypeScript",
      files: ["src/analyzers/a.ts", "src/analyzers/b.ts", "src/analyzers/c.ts"],
      entryPoints: ["src/analyzers/a.ts"],
      cohesion: 0.8,
      coupling: 0.2,
    },
    {
      id: "schema",
      name: "Schema",
      description: "2 files, primarily TypeScript",
      files: ["src/schema/v1.ts", "src/schema/validate.ts"],
      entryPoints: ["src/schema/v1.ts"],
      cohesion: 1,
      coupling: 0.1,
    },
  ];

  const sampleCrossings: ZoneCrossing[] = [
    { from: "src/analyzers/a.ts", to: "src/schema/v1.ts", fromZone: "analyzers", toZone: "schema" },
  ];

  const sampleInventory = makeInventory([
    makeFileEntry("src/analyzers/a.ts"),
    makeFileEntry("src/analyzers/b.ts"),
    makeFileEntry("src/analyzers/c.ts"),
    makeFileEntry("src/schema/v1.ts"),
    makeFileEntry("src/schema/validate.ts"),
  ]);

  const sampleImports = makeImports([
    makeEdge("src/analyzers/a.ts", "src/schema/v1.ts"),
  ]);

  function makePass1Response() {
    return JSON.stringify({
      zones: [
        {
          algorithmicId: "analyzers",
          id: "code-analysis",
          name: "Code Analysis",
          description: "Core analysis pipeline",
          insights: ["Uses visitor pattern for AST traversal"],
        },
        {
          algorithmicId: "schema",
          id: "data-schema",
          name: "Data Schema",
          description: "Schema definitions and validation",
          insights: ["Well-isolated with clean boundary"],
        },
      ],
      insights: ["Clean layered architecture: schema → analyzers"],
    });
  }

  it("pass 1: replaces id/name/description and returns AI insights", async () => {
    mockClaudeResponse(makePass1Response());

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.pass).toBe(1);
    expect(result.zones).toHaveLength(2);
    expect(result.zones[0].id).toBe("code-analysis");
    expect(result.zones[0].name).toBe("Code Analysis");
    expect(result.zones[0].description).toBe("Core analysis pipeline");

    // Structural data preserved
    expect(result.zones[0].files).toEqual(sampleZones[0].files);
    expect(result.zones[0].cohesion).toBe(0.8);
    expect(result.zones[0].coupling).toBe(0.2);

    // AI insights extracted
    expect(result.newZoneInsights.get("code-analysis")).toEqual([
      "Uses visitor pattern for AST traversal",
    ]);
    expect(result.newGlobalInsights).toEqual([
      "Clean layered architecture: schema → analyzers",
    ]);
  });

  it("handles AI response wrapped in markdown fences", async () => {
    mockClaudeResponse("```json\n" + makePass1Response() + "\n```");

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones[0].id).toBe("code-analysis");
    expect(result.zones[1].id).toBe("data-schema");
  });

  it("returns zones unchanged when claude not found", async () => {
    mockClaudeError("Claude CLI not found", { reason: "not-found" });

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("returns zones unchanged on invalid JSON response after all retries", async () => {
    // All 3 retry attempts return invalid JSON
    mockClaudeResponse("This is not valid JSON");
    mockClaudeResponse("Still not JSON");
    mockClaudeResponse("Nope");

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("returns zones unchanged when response has empty zones array", async () => {
    const emptyResponse = JSON.stringify({ zones: [], insights: [] });
    mockClaudeResponse(emptyResponse);
    mockClaudeResponse(emptyResponse);
    mockClaudeResponse(emptyResponse);

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("applies partial results when response has fewer zones", async () => {
    mockClaudeResponse(JSON.stringify({
      zones: [{ algorithmicId: "analyzers", id: "analysis-core", name: "Analysis Core", description: "Core analysis", insights: [] }],
      insights: [],
    }));

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    // First zone matched by algorithmicId and enriched
    expect(result.zones[0].id).toBe("analysis-core");
    expect(result.zones[0].name).toBe("Analysis Core");
    // Second zone kept as-is (no match)
    expect(result.zones[1].id).toBe("schema");
    expect(result.zones[1].name).toBe("Schema");
    expect(result.pass).toBe(1);
  });

  it("returns zones unchanged when all claude calls throw", async () => {
    mockClaudeError("timed out", { reason: "timeout" });
    mockClaudeError("timed out", { reason: "timeout" });
    mockClaudeError("timed out", { reason: "timeout" });

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("does not retry on auth errors", async () => {
    mockClaudeError("Not logged in. Run claude login first.", { reason: "auth" });

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
    // Only 1 call — no retries after auth error
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
  });

  it("succeeds on retry after initial failure", async () => {
    // First attempt fails
    mockClaudeResponse("not json");
    // Second attempt succeeds
    mockClaudeResponse(makePass1Response());

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones[0].id).toBe("code-analysis");
    expect(result.pass).toBe(1);
  });

  it("pass 2+: preserves previous AI names and returns only new insights", async () => {
    const previousZones = {
      zones: [
        { ...sampleZones[0], id: "code-analysis", name: "Code Analysis", description: "Pipeline" },
        { ...sampleZones[1], id: "data-schema", name: "Data Schema", description: "Schemas" },
      ],
      crossings: sampleCrossings,
      unzoned: [],
      enrichmentPass: 1,
      structureHash: "abc",
    };

    const pass2Response = JSON.stringify({
      zones: [
        { id: "code-analysis", newInsights: ["Tightly coupled with schema"] },
        { id: "data-schema", newInsights: [] },
      ],
      insights: ["Consider extracting shared types"],
    });

    mockClaudeResponse(pass2Response);

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports, previousZones
    );

    expect(result.pass).toBe(2);
    // Preserved previous names
    expect(result.zones[0].id).toBe("code-analysis");
    expect(result.zones[0].name).toBe("Code Analysis");
    // Only new insights returned
    expect(result.newZoneInsights.get("code-analysis")).toEqual([
      "Tightly coupled with schema",
    ]);
    expect(result.newGlobalInsights).toEqual([
      "Consider extracting shared types",
    ]);
  });
});

// ── enrichZonesWithAI batching ──────────────────────────────────────────────

describe("enrichZonesWithAI batching", () => {
  afterEach(() => {
    mockedCallClaude.mockReset();
  });

  function makeZone(id: string, fileCount: number): Zone {
    const files = Array.from({ length: fileCount }, (_, i) => `src/${id}/f${i}.ts`);
    return {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      description: `${fileCount} files`,
      files,
      entryPoints: [files[0]],
      cohesion: 0.8,
      coupling: 0.2,
    };
  }

  function makeBatchResponse(zones: Zone[]) {
    return JSON.stringify({
      zones: zones.map((z) => ({
        algorithmicId: z.id,
        id: `ai-${z.id}`,
        name: `AI ${z.name}`,
        description: `AI description for ${z.id}`,
        insights: [`Insight for ${z.id}`],
      })),
      insights: [`Cross-zone insight for batch containing ${zones[0].id}`],
    });
  }

  it("uses single-batch fast path for <= 5 zones", async () => {
    const zones = Array.from({ length: 3 }, (_, i) => makeZone(`zone${i}`, 3));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    mockClaudeResponse(makeBatchResponse(zones));

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.pass).toBe(1);
    expect(result.zones).toHaveLength(3);
    expect(result.zones[0].id).toBe("ai-zone0");
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
  });

  it("splits > 5 zones into multiple batches", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    // Batch 1: zones 0-4
    mockClaudeResponse(makeBatchResponse(zones.slice(0, 5)));
    // Batch 2: zones 5-7
    mockClaudeResponse(makeBatchResponse(zones.slice(5, 8)));

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.pass).toBe(1);
    expect(result.zones).toHaveLength(8);
    // All zones should be enriched
    for (let i = 0; i < 8; i++) {
      expect(result.zones[i].id).toBe(`ai-zone${i}`);
      expect(result.zones[i].name).toBe(`AI Zone${i}`);
    }
    expect(mockedCallClaude).toHaveBeenCalledTimes(2);
  });

  it("preserves partial results when a batch fails", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    // Batch 1: succeeds
    mockClaudeResponse(makeBatchResponse(zones.slice(0, 5)));
    // Batch 2: all 3 retries fail
    mockClaudeError("timed out", { reason: "timeout" });
    mockClaudeError("timed out", { reason: "timeout" });
    mockClaudeError("timed out", { reason: "timeout" });

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.pass).toBe(1);
    expect(result.zones).toHaveLength(8);
    // First 5 zones should be enriched
    for (let i = 0; i < 5; i++) {
      expect(result.zones[i].id).toBe(`ai-zone${i}`);
    }
    // Last 3 zones should keep algorithmic names
    for (let i = 5; i < 8; i++) {
      expect(result.zones[i].id).toBe(`zone${i}`);
    }
  });

  it("accumulates global insights across batches", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    mockClaudeResponse(makeBatchResponse(zones.slice(0, 5)));
    mockClaudeResponse(makeBatchResponse(zones.slice(5, 8)));

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    // Should have global insights from both batches
    expect(result.newGlobalInsights.length).toBe(2);
    expect(result.newGlobalInsights[0]).toContain("zone0");
    expect(result.newGlobalInsights[1]).toContain("zone5");
  });

  it("deduplicates identical global insights across batches", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    const responseWithDupInsight = (batchZones: Zone[]) => JSON.stringify({
      zones: batchZones.map((z) => ({
        algorithmicId: z.id,
        id: `ai-${z.id}`,
        name: `AI ${z.name}`,
        description: `desc`,
        insights: [],
      })),
      insights: ["Shared insight appears in both batches"],
    });

    mockClaudeResponse(responseWithDupInsight(zones.slice(0, 5)));
    mockClaudeResponse(responseWithDupInsight(zones.slice(5, 8)));

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.newGlobalInsights).toEqual(["Shared insight appears in both batches"]);
  });

  it("returns empty when auth fails on all batches with no prior results", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    // First batch gets auth error, stops processing
    mockClaudeError("Not logged in.", { reason: "auth" });

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.zones).toEqual(zones);
    expect(result.pass).toBe(0);
  });
});

// ── computeAttemptConfigs ──────────────────────────────────────────────────

describe("computeAttemptConfigs", () => {
  it("returns minimum 480s base for small projects (pass 1)", () => {
    const configs = computeAttemptConfigs(10, 2);
    // sizeBase = 10*400 + 2*5000 = 14000, pass1 multiplier 1.5 = 21000 → clamped to 480_000
    expect(configs[0].timeout).toBe(480_000);
    expect(configs).toHaveLength(3);
  });

  it("returns minimum 480s base for small projects (pass 2+)", () => {
    const configs = computeAttemptConfigs(10, 2, 2);
    // sizeBase = 14000, pass2+ multiplier 1 = 14000 → clamped to 480_000
    expect(configs[0].timeout).toBe(480_000);
  });

  it("pass 1 gets 1.5x multiplier on size-based timeout", () => {
    const configs = computeAttemptConfigs(500, 20, 1);
    expect(configs[0].timeout).toBe(480_000);
    const configs2 = computeAttemptConfigs(500, 20, 2);
    expect(configs2[0].timeout).toBe(480_000);
  });

  it("scales retry timeouts with 1.3x and 1.6x multipliers", () => {
    const configs = computeAttemptConfigs(10, 2, 1);
    expect(configs[0].timeout).toBe(480_000);
    expect(configs[1].timeout).toBe(600_000); // 480_000 * 1.3 = 624_000 → capped
    expect(configs[2].timeout).toBe(600_000); // 480_000 * 1.6 = 768_000 → capped
  });

  it("caps at 600s", () => {
    const configs = computeAttemptConfigs(2000, 50);
    expect(configs[0].timeout).toBe(600_000);
    expect(configs[1].timeout).toBe(600_000);
    expect(configs[2].timeout).toBe(600_000);
  });

  it("has progressively simpler maxFiles", () => {
    const configs = computeAttemptConfigs(100, 5);
    expect(configs[0].maxFiles).toBe(8);
    expect(configs[1].maxFiles).toBe(3);
    expect(configs[2].maxFiles).toBe(0);
  });
});

// ── extractFindings ────────────────────────────────────────────────────────

describe("extractFindings", () => {
  it("extracts new-format findings from top-level array", () => {
    const parsed = {
      findings: [
        { type: "pattern", scope: "global", text: "MVC pattern detected", severity: "info" },
        { type: "relationship", scope: "api", text: "API depends on core" },
      ],
      zones: [],
      insights: [],
    };

    const findings = extractFindings(parsed, 2, ["pattern", "relationship"]);
    expect(findings).toHaveLength(2);
    expect(findings[0].type).toBe("pattern");
    expect(findings[0].pass).toBe(2);
    expect(findings[0].severity).toBe("info");
    expect(findings[1].type).toBe("relationship");
    expect(findings[1].scope).toBe("api");
  });

  it("extracts findings from per-zone arrays", () => {
    const parsed = {
      zones: [
        {
          id: "auth",
          findings: [
            { type: "anti-pattern", scope: "auth", text: "God class detected", severity: "warning" },
          ],
        },
      ],
      insights: [],
    };

    const findings = extractFindings(parsed, 3, ["anti-pattern"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("anti-pattern");
    expect(findings[0].scope).toBe("auth");
    expect(findings[0].severity).toBe("warning");
  });

  it("falls back to legacy insights when no findings present", () => {
    const parsed = {
      zones: [
        { id: "core", insights: ["High cohesion zone"] },
        { id: "util", insights: ["Helper functions"] },
      ],
      insights: ["Clean architecture"],
    };

    const findings = extractFindings(parsed, 1, ["observation"]);
    expect(findings).toHaveLength(3);
    expect(findings[0].type).toBe("observation");
    expect(findings[0].scope).toBe("global");
    expect(findings[0].text).toBe("Clean architecture");
    expect(findings[1].scope).toBe("core");
    expect(findings[2].scope).toBe("util");
  });

  it("falls back to legacy newInsights for pass 2+", () => {
    const parsed = {
      zones: [
        { id: "core", newInsights: ["Needs refactoring"] },
      ],
      insights: [],
    };

    const findings = extractFindings(parsed, 2, ["pattern"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("pattern");
    expect(findings[0].scope).toBe("core");
    expect(findings[0].text).toBe("Needs refactoring");
  });

  it("uses expected type as default for invalid finding types", () => {
    const parsed = {
      findings: [
        { type: "invalid-type", scope: "global", text: "some finding" },
      ],
      zones: [],
    };

    const findings = extractFindings(parsed, 1, ["observation"]);
    expect(findings[0].type).toBe("observation");
  });

  it("handles related array and filters non-strings", () => {
    const parsed = {
      findings: [
        { type: "pattern", scope: "global", text: "test", related: ["a.ts", 42, "b.ts"] },
      ],
      zones: [],
    };

    const findings = extractFindings(parsed, 1, ["pattern"]);
    expect(findings[0].related).toEqual(["a.ts", "b.ts"]);
  });

  it("parses explicit category from LLM response", () => {
    const parsed = {
      findings: [
        { type: "anti-pattern", scope: "global", text: "Duplicated logic", severity: "warning", category: "code" },
        { type: "suggestion", scope: "zone-a", text: "Split this zone", severity: "info", category: "structural" },
      ],
      zones: [],
    };

    const findings = extractFindings(parsed, 1, ["anti-pattern"]);
    expect(findings[0].category).toBe("code");
    expect(findings[1].category).toBe("structural");
  });

  it("falls back to heuristic classification when category not provided", () => {
    const parsed = {
      findings: [
        { type: "anti-pattern", scope: "global", text: "God function: handleDrop has 45 outgoing calls", severity: "warning" },
        { type: "suggestion", scope: "zone-a", text: "This zone spans 17 directories and should be split", severity: "info" },
      ],
      zones: [],
    };

    const findings = extractFindings(parsed, 1, ["anti-pattern"]);
    expect(findings[0].category).toBe("code");
    expect(findings[1].category).toBe("structural");
  });

  it("ignores invalid category values from LLM", () => {
    const parsed = {
      findings: [
        { type: "observation", scope: "global", text: "Clean architecture", severity: "info", category: "bogus" },
      ],
      zones: [],
    };

    const findings = extractFindings(parsed, 1, ["observation"]);
    // "bogus" is ignored, heuristic doesn't match either → no category
    expect(findings[0].category).toBeUndefined();
  });

  it("classifies legacy insight strings via heuristic", () => {
    const parsed = {
      zones: [
        { id: "core", insights: ["Circular dependency between core and utils"] },
      ],
      insights: ["Zone boundary misassignment: file belongs in different zone"],
    };

    const findings = extractFindings(parsed, 1, ["observation"]);
    expect(findings[0].category).toBe("structural");  // zone boundary
    expect(findings[1].category).toBe("code");         // circular dependency
  });
});

// ── buildMetaPrompt ────────────────────────────────────────────────────────

describe("buildMetaPrompt", () => {
  const sampleZones: Zone[] = [
    {
      id: "core",
      name: "Core",
      description: "Core module",
      files: ["src/core/a.ts", "src/core/b.ts"],
      entryPoints: ["src/core/a.ts"],
      cohesion: 0.8,
      coupling: 0.2,
    },
  ];

  const sampleCrossings: ZoneCrossing[] = [];

  it("annotates pass 0 findings with source pass and detection method", () => {
    const findings: Finding[] = [
      {
        type: "anti-pattern",
        pass: 0,
        scope: "global",
        text: "God function: render in src/ui/app.ts calls 45 unique functions",
        severity: "warning",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("[source: pass 0: automated heuristic; method: call-graph: outgoing-call count]");
  });

  it("annotates tightly coupled module findings with cross-file edge count method", () => {
    const findings: Finding[] = [
      {
        type: "relationship",
        pass: 0,
        scope: "global",
        text: "Tightly coupled modules: a.ts and b.ts — 50 cross-file calls",
        severity: "warning",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("[source: pass 0: automated heuristic; method: call-graph: cross-file edge count]");
  });

  it("annotates dead export findings with dead-export scan method", () => {
    const findings: Finding[] = [
      {
        type: "suggestion",
        pass: 0,
        scope: "global",
        text: "Potentially unused export: foo in src/bar.ts has no incoming calls",
        severity: "info",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("[source: pass 0: automated heuristic; method: call-graph: dead-export scan]");
  });

  it("annotates hub function findings with fan-in method", () => {
    const findings: Finding[] = [
      {
        type: "suggestion",
        pass: 0,
        scope: "global",
        text: "Hub function: walkTree in src/core/tree.ts is called from 8 files",
        severity: "info",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("[source: pass 0: automated heuristic; method: call-graph: fan-in (caller file count)]");
  });

  it("annotates fan-in hotspot findings with fan-in method", () => {
    const findings: Finding[] = [
      {
        type: "observation",
        pass: 0,
        scope: "global",
        text: "Fan-in hotspot: src/core/tree.ts receives calls from 10 files",
        severity: "info",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("[source: pass 0: automated heuristic; method: call-graph: fan-in (caller file count)]");
  });

  it("annotates zone-scoped cohesion/coupling findings with zone metrics method", () => {
    const findings: Finding[] = [
      {
        type: "observation",
        pass: 0,
        scope: "core",
        text: "Low cohesion (0.3) — zone may be too broad",
        severity: "warning",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("[source: pass 0: automated heuristic; method: zone metrics: cohesion/coupling]");
  });

  it("annotates LLM-pass findings with LLM analysis method", () => {
    const findings: Finding[] = [
      {
        type: "pattern",
        pass: 2,
        scope: "global",
        text: "Clean layered architecture between zones",
        severity: "info",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("[source: pass 2: LLM cross-zone relationships; method: LLM analysis]");
  });

  it("annotates pass 1 findings with LLM zone naming label", () => {
    const findings: Finding[] = [
      {
        type: "observation",
        pass: 1,
        scope: "core",
        text: "Well-isolated module",
        severity: "info",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("[source: pass 1: LLM zone naming + initial observations; method: LLM analysis]");
  });

  it("includes guardrail: do not escalate heuristic findings without corroboration", () => {
    const findings: Finding[] = [
      {
        type: "observation",
        pass: 0,
        scope: "global",
        text: "Some finding",
        severity: "info",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("Do NOT escalate their severity unless corroborated by MULTIPLE independent findings");
  });

  it("includes guardrail: do not suggest decomposition unless metric exceeds 2x threshold", () => {
    const findings: Finding[] = [
      {
        type: "observation",
        pass: 0,
        scope: "global",
        text: "Some finding",
        severity: "info",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("Do NOT generate specific file decomposition suggestions");
    expect(prompt).toContain("2x its detection threshold");
  });

  it("includes guardrail: preserve exact numeric values from heuristic findings", () => {
    const findings: Finding[] = [
      {
        type: "observation",
        pass: 0,
        scope: "global",
        text: "Some finding",
        severity: "info",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("preserve the exact numeric values as written");
  });

  it("includes guardrail: positive findings must have info severity", () => {
    const findings: Finding[] = [
      { type: "observation", pass: 0, scope: "global", text: "Some finding", severity: "info" },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("Positive findings describing good architecture, clean patterns, or successful design choices must have severity \"info\"");
  });

  it("includes guardrail: test-to-implementation coupling is expected", () => {
    const findings: Finding[] = [
      { type: "observation", pass: 0, scope: "global", text: "Some finding", severity: "info" },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("Test files coupling to implementation internals is expected by design");
  });

  it("annotates findings for unknown high pass numbers", () => {
    const findings: Finding[] = [
      {
        type: "suggestion",
        pass: 7,
        scope: "global",
        text: "Some late-pass finding",
        severity: "info",
      },
    ];

    const prompt = buildMetaPrompt(sampleZones, findings, sampleCrossings);
    expect(prompt).toContain("[source: pass 7: LLM analysis; method: LLM analysis]");
  });
});

// ── enforceSeverityRules ────────────────────────────────────────────────────

describe("enforceSeverityRules", () => {
  it("downgrades positive LLM findings to info", () => {
    const findings: Finding[] = [
      { type: "observation", pass: 1, scope: "global", text: "Architecture successfully implements zero-circular-dependency design", severity: "critical" },
    ];
    const result = enforceSeverityRules(findings);
    expect(result[0].severity).toBe("info");
  });

  it("downgrades test-coupling anti-patterns to info", () => {
    const findings: Finding[] = [
      { type: "anti-pattern", pass: 3, scope: "global", text: "Test coupling to implementation: test suite has direct calls to internals", severity: "critical" },
    ];
    const result = enforceSeverityRules(findings);
    expect(result[0].severity).toBe("info");
  });

  it("does not modify pass 0 findings", () => {
    const findings: Finding[] = [
      { type: "anti-pattern", pass: 0, scope: "global", text: "God function: something successfully calls 50 functions", severity: "warning" },
    ];
    const result = enforceSeverityRules(findings);
    expect(result[0].severity).toBe("warning");
  });

  it("does not modify legitimate LLM warnings", () => {
    const findings: Finding[] = [
      { type: "anti-pattern", pass: 3, scope: "global", text: "Tight coupling between zones X and Y", severity: "warning" },
    ];
    const result = enforceSeverityRules(findings);
    expect(result[0].severity).toBe("warning");
  });

  it("matches positive indicators case-insensitively", () => {
    const findings: Finding[] = [
      { type: "observation", pass: 2, scope: "global", text: "EXEMPLARY module isolation across all zones", severity: "warning" },
    ];
    const result = enforceSeverityRules(findings);
    expect(result[0].severity).toBe("info");
  });

  it("does not modify findings already at info severity", () => {
    const findings: Finding[] = [
      { type: "observation", pass: 1, scope: "global", text: "Clean separation of concerns", severity: "info" },
    ];
    const result = enforceSeverityRules(findings);
    expect(result[0].severity).toBe("info");
  });

  it("handles test-coupling with regex pattern", () => {
    const findings: Finding[] = [
      { type: "anti-pattern", pass: 2, scope: "global", text: "Unit test coupling to implementation details detected", severity: "warning" },
    ];
    const result = enforceSeverityRules(findings);
    expect(result[0].severity).toBe("info");
  });
});
