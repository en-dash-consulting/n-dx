/**
 * Envelope structure and per-section cost for sourcevision's prompts.
 *
 * The companion to `prompt-text-identity.test.ts`. That file proves the
 * migration did not change what sourcevision sends; this one proves the
 * migration bought something — that every prompt exposes named sections whose
 * token cost can be attributed individually.
 *
 * The invariants are the same four rex pins, for the same reasons:
 *
 * - Assembling an envelope reproduces the paired `*Prompt` function exactly,
 *   so the measured sections are the text that is actually sent.
 * - Section names are unique within a prompt. A duplicate would split one
 *   part's cost across two identically-labelled rows and silently mislead.
 * - Section names come from the shared vocabulary, so a section's cost is
 *   comparable across builders.
 * - The section costs sum to the whole, so no part of a prompt is unattributed.
 *
 * ## What the numbers say here, and why it differs from rex
 *
 * rex's prompts are dominated by fixed instruction text — a worked example and
 * a JSON schema are half of a propose prompt. sourcevision's are dominated by
 * generated context: zone file lists, the crossing table, the document being
 * distilled. The cost-attribution tests below assert that difference directly,
 * because it is the finding that tells a rewrite where *not* to spend effort.
 * Shortening sourcevision's instructions would save almost nothing.
 *
 * @see packages/sourcevision/src/analyzers/prompt-envelope.ts — the vocabulary
 * @see packages/rex/tests/unit/analyze/prompt-envelope-sections.test.ts — the rex half
 */

import { describe, it, expect } from "vitest";

import {
  SV_PROMPT_SECTIONS,
  svPrompt,
  svPromptCosts,
} from "../../../src/analyzers/prompt-envelope.js";
import {
  buildFirstPassEnvelope,
  buildLaterPassEnvelope,
} from "../../../src/analyzers/enrich-batch.js";
import {
  buildMetaEnvelope,
  buildMetaPrompt,
  getPassConfig,
} from "../../../src/analyzers/enrich-config.js";
import {
  buildSingleZoneFirstPassEnvelope,
  buildSingleZoneLaterPassEnvelope,
} from "../../../src/analyzers/enrich-per-zone.js";
import {
  buildLLMClassifyEnvelope,
  buildLLMClassifyPrompt,
} from "../../../src/analyzers/classify.js";
import { buildPrimerEnvelope, buildPrimerPrompt } from "../../../src/analyzers/primer.js";
import type { PromptEnvelope } from "@n-dx/llm-client";
import type { Zone, ZoneCrossing, Finding, Zones } from "../../../src/schema/index.js";

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
] as unknown as Finding[];

const ARCHETYPES = [
  {
    id: "route-handler",
    name: "Route handler",
    description: "Maps an HTTP request to a domain call.",
  },
  {
    id: "domain-service",
    name: "Domain service",
    description: "Holds business rules, no transport concerns.",
  },
];

const CLASSIFY_FILES = [
  { path: "src/api/routes.ts", archetype: null, confidence: 0 },
  { path: "src/core/billing.ts", archetype: null, confidence: 0 },
] as unknown as Parameters<typeof buildLLMClassifyEnvelope>[0];

/** The sampling budget the batch builders take per attempt. */
const ATTEMPT = { maxFiles: 10, maxCrossings: 20 };

const PREVIOUS_ZONES: Zones = {
  zones: ZONES,
  enrichmentPass: 1,
  findings: [],
} as unknown as Zones;

/** Context object the per-zone builders take; the interface is module-private. */
function singleZoneCtx(
  overrides: Record<string, unknown> = {},
): Parameters<typeof buildSingleZoneFirstPassEnvelope>[0] {
  return {
    zone: ZONES[0],
    config: { maxFiles: 15, maxCrossings: 20 },
    passConfig: getPassConfig(1, 0),
    filesStr: '"src/api/routes.ts", "src/api/server.ts"',
    otherContext: 'Other zones: "core" (2 files)',
    crossingLines: "  api→core: 4 imports",
    hints: "Prefer a transport/domain split.",
    ...overrides,
  } as unknown as Parameters<typeof buildSingleZoneFirstPassEnvelope>[0];
}

/**
 * Every sourcevision prompt surface: its envelope, and — where the paired
 * `*Prompt` function is exported — the assembled string it produces. The batch
 * and per-zone builders have no exported string pair; their text identity is
 * covered by `prompt-text-identity.test.ts` through the mocked model call.
 */
const SURFACES: Array<{
  name: string;
  envelope: PromptEnvelope;
  assembled?: string;
}> = [
  {
    name: "buildFirstPassEnvelope",
    envelope: buildFirstPassEnvelope(
      ZONES,
      ATTEMPT,
      'Other zones: "core"',
      "",
      "  api→core: 4 imports",
      "",
      getPassConfig(1, 0),
    ),
  },
  {
    name: "buildLaterPassEnvelope",
    envelope: buildLaterPassEnvelope(
      ZONES,
      ATTEMPT,
      'Other zones: "core"',
      "  api→core: 4 imports",
      2,
      getPassConfig(2, 0),
      PREVIOUS_ZONES,
      "",
    ),
  },
  {
    name: "buildMetaEnvelope",
    envelope: buildMetaEnvelope(ZONES, FINDINGS, CROSSINGS),
    assembled: buildMetaPrompt(ZONES, FINDINGS, CROSSINGS),
  },
  {
    name: "buildMetaEnvelope — with hints",
    envelope: buildMetaEnvelope(ZONES, FINDINGS, CROSSINGS, "Prefer transport/domain split."),
    assembled: buildMetaPrompt(ZONES, FINDINGS, CROSSINGS, "Prefer transport/domain split."),
  },
  {
    name: "buildSingleZoneFirstPassEnvelope",
    envelope: buildSingleZoneFirstPassEnvelope(singleZoneCtx()),
  },
  {
    name: "buildSingleZoneLaterPassEnvelope",
    envelope: buildSingleZoneLaterPassEnvelope(
      singleZoneCtx({ passNumber: 2, previousZone: ZONES[0] }),
    ),
  },
  {
    name: "buildLLMClassifyEnvelope",
    envelope: buildLLMClassifyEnvelope(CLASSIFY_FILES, ARCHETYPES, true),
    assembled: buildLLMClassifyPrompt(CLASSIFY_FILES, ARCHETYPES, true),
  },
  {
    name: "buildLLMClassifyEnvelope — compact",
    envelope: buildLLMClassifyEnvelope(CLASSIFY_FILES, ARCHETYPES, false),
    assembled: buildLLMClassifyPrompt(CLASSIFY_FILES, ARCHETYPES, false),
  },
  {
    name: "buildPrimerEnvelope",
    envelope: buildPrimerEnvelope(CONTEXT_MD),
    assembled: buildPrimerPrompt(CONTEXT_MD),
  },
];

// ── Structural invariants, applied to every surface ─────────────────────────

describe("every sourcevision prompt is envelope-built", () => {
  it("covers all 7 registered prompt surfaces", () => {
    // Keeps this file honest against scripts/prompt-census.mjs, which declares
    // 7 sourcevision surfaces. A new prompt with no entry here would go
    // unmeasured. Two builders appear twice, under different arguments, to
    // cover a branch each — hence 9 cases over 7 surfaces.
    const distinct = new Set(SURFACES.map((s) => s.name.split(" — ")[0]));
    expect(distinct.size).toBe(7);
  });

  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s exposes named, non-empty sections",
    (_name, surface) => {
      expect(surface.envelope.sections.length).toBeGreaterThan(1);
      for (const s of surface.envelope.sections) {
        expect(s.content.length).toBeGreaterThan(0);
        expect(s.name).toBeTruthy();
      }
    },
  );

  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s uses section names from the shared vocabulary",
    (_name, surface) => {
      for (const s of surface.envelope.sections) {
        expect(SV_PROMPT_SECTIONS).toContain(s.name);
      }
    },
  );

  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s names each section at most once",
    (_name, surface) => {
      const names = surface.envelope.sections.map((s) => s.name);
      expect(names).toEqual([...new Set(names)]);
    },
  );

  it.each(SURFACES.filter((s) => s.assembled !== undefined).map((s) => [s.name, s] as const))(
    "%s assembles to exactly what its prompt function returns",
    (_name, surface) => {
      expect(svPrompt(surface.envelope)).toBe(surface.assembled);
    },
  );
});

// ── Cost attribution ───────────────────────────────────────────────────────

describe("sourcevision prompt cost is attributable to sections", () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s reports a cost per section, summing to 100%%",
    (_name, surface) => {
      const costs = svPromptCosts(surface.envelope);

      expect(costs).toHaveLength(surface.envelope.sections.length);
      for (const c of costs) {
        expect(c.tokenEstimate).toBeGreaterThan(0);
      }
      expect(costs.reduce((n, c) => n + c.sharePercent, 0)).toBeCloseTo(100, 6);
    },
  );

  it("names the archetype catalog as the dominant cost of the classify prompt", () => {
    // The classify prompt's weight is the enumeration the model must choose
    // from, not the instructions around it — and it scales with the archetype
    // list, not with the batch. That is why the compact variant exists.
    const costs = svPromptCosts(buildLLMClassifyEnvelope(CLASSIFY_FILES, ARCHETYPES, true));
    const catalog = costs.find((c) => c.name === "catalog");

    expect(catalog).toBeDefined();
    expect(catalog!.tokenEstimate).toBeGreaterThan(0);

    // Dropping the descriptions is the lever, and it must actually move the
    // number — otherwise the compact branch is dead weight.
    const compact = svPromptCosts(buildLLMClassifyEnvelope(CLASSIFY_FILES, ARCHETYPES, false));
    const compactCatalog = compact.find((c) => c.name === "catalog")!;
    expect(compactCatalog.tokenEstimate).toBeLessThan(catalog!.tokenEstimate);
  });

  it("attributes a large document to the input section, not the instructions", () => {
    // The primer distils CONTEXT.md. On any real repository that document
    // dwarfs the surrounding instructions, so a rewrite aimed at the
    // instructions would save nothing. This is the sourcevision-shaped
    // counterpart to rex's instruction-dominated propose prompts.
    const costs = svPromptCosts(buildPrimerEnvelope("x ".repeat(20_000)));
    const input = costs.find((c) => c.name === "input");

    expect(input).toBeDefined();
    expect(input!.sharePercent).toBeGreaterThan(80);
  });

  it("reports the enrichment prompt as context-dominated rather than rule-dominated", () => {
    // First-pass enrichment carries a fixed `rules` block and a generated
    // `input` block listing every zone and its files. On a repository of any
    // size the second outgrows the first, which is the measurement that says
    // trimming the pass-config focus text is not where the saving is.
    const many = Array.from({ length: 40 }, (_, i) =>
      makeZone(`zone-${i}`, [`src/z${i}/a.ts`, `src/z${i}/b.ts`, `src/z${i}/c.ts`]),
    );
    const costs = svPromptCosts(
      buildFirstPassEnvelope(many, ATTEMPT, "", "", "", "", getPassConfig(1, 0)),
    );
    const byName = new Map(costs.map((c) => [c.name, c]));

    expect(byName.get("input")!.tokenEstimate).toBeGreaterThan(
      byName.get("rules")!.tokenEstimate,
    );
  });
});
