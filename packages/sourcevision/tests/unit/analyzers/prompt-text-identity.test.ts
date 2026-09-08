/**
 * Byte-identity guard for every sourcevision LLM prompt surface.
 *
 * Same purpose and same discipline as rex's equivalent: these snapshots were
 * recorded from the implementation as it stood *before* the prompts were moved
 * onto `PromptEnvelope`, so a passing run is evidence that the restructuring
 * changed no prompt text — not a restatement of whatever the code now emits.
 *
 * The three exported builders are called directly. The three that build their
 * prompt inside the function that also calls the model are captured by mocking
 * `callClaude` and reading the prompt it was handed, which keeps the test shape
 * stable across the extraction.
 *
 * Update a snapshot here only as part of a deliberate prompt rewrite.
 *
 * @see packages/rex/tests/unit/analyze/prompt-text-identity.test.ts — the rex half
 * @see docs/analysis/prompt-token-baseline.md — the recorded token baseline
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  Inventory,
  Imports,
  ImportEdge,
  FileEntry,
  Zone,
  ZoneCrossing,
  Zones,
  Finding,
} from "../../../src/schema/index.js";

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
import { buildPrimerPrompt } from "../../../src/analyzers/primer.js";
import { buildMetaPrompt, getPassConfig } from "../../../src/analyzers/enrich-config.js";
import { enrichBatch } from "../../../src/analyzers/enrich-batch.js";
import { enrichZonesPerZone } from "../../../src/analyzers/enrich-per-zone.js";
import { buildLLMClassifyPrompt } from "../../../src/analyzers/classify.js";

const mockedCallClaude = vi.mocked(callClaude);

// ── Fixtures ────────────────────────────────────────────────────────────────

const CONTEXT_MD = [
  "# Project Context",
  "",
  "## Overview",
  "TypeScript monorepo, 3 packages, pnpm workspaces.",
  "",
  "## Zones",
  "- `api` — 12 files, cohesion 0.90, coupling 0.10. HTTP handlers.",
  "- `core` — 8 files, cohesion 0.95, coupling 0.05. Domain logic.",
].join("\n");

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

const ZONES: Zone[] = [
  makeZone("api", ["src/api/routes.ts", "src/api/server.ts"]),
  makeZone("core", ["src/core/billing.ts", "src/core/period.ts"]),
];

const CROSSINGS: ZoneCrossing[] = [
  { from: "api", to: "core", count: 4, files: ["src/api/routes.ts"] },
] as unknown as ZoneCrossing[];

const INVENTORY = makeInventory([
  makeFileEntry("src/api/routes.ts"),
  makeFileEntry("src/api/server.ts"),
  makeFileEntry("src/core/billing.ts"),
  makeFileEntry("src/core/period.ts"),
]);

const IMPORTS = makeImports([
  { from: "src/api/routes.ts", to: "src/core/billing.ts", type: "static", symbols: ["charge"] },
]);

const FINDINGS: Finding[] = [
  {
    id: "f-1",
    zone: "api",
    scope: "zone",
    severity: "medium",
    type: "anti-pattern",
    title: "Route handler holds domain logic",
    description: "Billing arithmetic inlined into the request handler.",
  },
  {
    id: "f-2",
    scope: "global",
    severity: "low",
    type: "observation",
    title: "No shared error type",
    description: "Each zone defines its own error shape.",
  },
] as unknown as Finding[];

const ARCHETYPES = [
  { id: "route-handler", name: "Route handler", description: "Maps an HTTP request to a domain call." },
  { id: "domain-service", name: "Domain service", description: "Holds business rules, no transport concerns." },
];

/** Record every prompt `callClaude` receives, and answer with `response`. */
function capturePrompts(response: string): string[] {
  const prompts: string[] = [];
  mockedCallClaude.mockImplementation(async (prompt: string) => {
    prompts.push(prompt);
    return { text: response };
  });
  return prompts;
}

beforeEach(() => {
  mockedCallClaude.mockReset();
});

// ── Directly callable builders ──────────────────────────────────────────────

describe("sourcevision prompt text is unchanged by the envelope migration", () => {
  it("buildPrimerPrompt", () => {
    expect(buildPrimerPrompt(CONTEXT_MD)).toMatchSnapshot();
  });

  it("buildMetaPrompt", () => {
    expect(buildMetaPrompt(ZONES, FINDINGS, CROSSINGS)).toMatchSnapshot();
  });

  it("buildMetaPrompt — with hints", () => {
    expect(
      buildMetaPrompt(ZONES, FINDINGS, CROSSINGS, "Prefer transport/domain split."),
    ).toMatchSnapshot();
  });

  it("buildLLMClassifyPrompt — with archetype descriptions", () => {
    expect(
      buildLLMClassifyPrompt(
        [
          { path: "src/api/routes.ts", archetype: null, confidence: 0 },
          { path: "src/core/billing.ts", archetype: null, confidence: 0 },
        ] as unknown as Parameters<typeof buildLLMClassifyPrompt>[0],
        ARCHETYPES,
        true,
      ),
    ).toMatchSnapshot();
  });

  it("buildLLMClassifyPrompt — compact (no descriptions)", () => {
    expect(
      buildLLMClassifyPrompt(
        [
          { path: "src/api/routes.ts", archetype: null, confidence: 0 },
        ] as unknown as Parameters<typeof buildLLMClassifyPrompt>[0],
        ARCHETYPES,
        false,
      ),
    ).toMatchSnapshot();
  });
});

// ── Surfaces captured through the mocked LLM call ───────────────────────────

describe("sourcevision prompts built inline at the call site", () => {
  /** A response every enrichment parser accepts, so the call reaches its end. */
  const ENRICH_RESPONSE = JSON.stringify({
    zones: [
      { id: "api", name: "API", description: "HTTP handlers.", insights: [] },
      { id: "core", name: "Core", description: "Domain logic.", insights: [] },
    ],
    findings: [],
  });

  it("buildFirstPassPrompt — via enrichBatch, pass 1", async () => {
    const prompts = capturePrompts(ENRICH_RESPONSE);

    await enrichBatch(
      ZONES,
      ZONES,
      [["api→core", 4]],
      1,
      getPassConfig(1, 0),
      undefined,
      0,
      1,
    );

    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts[0]).toMatchSnapshot();
  });

  it("buildLaterPassPrompt — via enrichBatch, pass 2", async () => {
    const prompts = capturePrompts(ENRICH_RESPONSE);
    const previous: Zones = {
      zones: ZONES,
      enrichmentPass: 1,
      findings: [],
    } as unknown as Zones;

    await enrichBatch(
      ZONES,
      ZONES,
      [["api→core", 4]],
      2,
      getPassConfig(2, 0),
      previous,
      0,
      1,
    );

    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts[0]).toMatchSnapshot();
  });

  it("enrichSingleZone — via enrichZonesPerZone", async () => {
    const prompts = capturePrompts(ENRICH_RESPONSE);

    await enrichZonesPerZone(ZONES, CROSSINGS, INVENTORY, IMPORTS);

    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts[0]).toMatchSnapshot();
  });
});
