/**
 * Every enrichment prompt states the same output contract the same way.
 *
 * Four builders across two files each spelled out the response format for
 * themselves: the severity enumeration, the "respond with only JSON"
 * instruction, and the "add only new insights" rule on the later passes. Written
 * out four times, they had already drifted —
 * `buildSingleZoneLaterPassEnvelope` said "Respond with ONLY a JSON object:"
 * where the other three said "Respond with ONLY a JSON object (no markdown, no
 * explanation):", so one path asked for raw JSON and one did not.
 *
 * That particular drift was survivable — `tryParseJSON` in enrich-parsing.ts
 * strips markdown fences before parsing, so a fenced response is recovered
 * rather than lost. It still cost output tokens on a path that had asked for
 * none, and it is the kind of divergence that is invisible while it stays
 * harmless: nothing compared the four copies, so nothing could say which
 * wording was intended.
 *
 * These prompts run per batch and per zone rather than once per command, so a
 * contract stated four ways is also four places to edit when the response
 * shape changes.
 *
 * The severity line deliberately comes in two forms. Batch prompts name a
 * `category` enum; the per-zone prompts do not, because they are the minimal
 * fallback path and `classifyFinding` derives a category from the finding text
 * when the model omits one. That difference is a choice, so it is asserted
 * rather than left to be rediscovered as drift.
 *
 * @see packages/sourcevision/src/analyzers/prompt-envelope.ts — the shared text
 */

import { describe, it, expect } from "vitest";

import {
  JSON_OBJECT_ONLY,
  ONLY_NEW_INSIGHTS,
  findingsContract,
} from "../../../src/analyzers/prompt-envelope.js";
import {
  buildFirstPassEnvelope,
  buildLaterPassEnvelope,
} from "../../../src/analyzers/enrich-batch.js";
import {
  buildSingleZoneFirstPassEnvelope,
  buildSingleZoneLaterPassEnvelope,
} from "../../../src/analyzers/enrich-per-zone.js";
import { getPassConfig, buildMetaPrompt } from "../../../src/analyzers/enrich-config.js";
import type { Finding, Zone, Zones } from "../../../src/schema/index.js";

function zone(id: string, files: string[]): Zone {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${files.length} files`,
    files,
    entryPoints: [files[0]],
    cohesion: 0.8,
    coupling: 0.2,
  } as Zone;
}

const ZONES = [
  zone("api", ["src/api/routes.ts"]),
  zone("core", ["src/core/billing.ts"]),
];
const ATTEMPT = { maxFiles: 10, maxCrossings: 20 };
const PREVIOUS = { zones: ZONES, enrichmentPass: 1, findings: [] } as unknown as Zones;

function singleZoneCtx(overrides: Record<string, unknown> = {}) {
  return {
    zone: ZONES[0],
    config: { maxFiles: 15, maxCrossings: 20 },
    passConfig: getPassConfig(1, 0),
    filesStr: '"src/api/routes.ts"',
    otherContext: 'Other zones: "core"',
    crossingLines: "  api→core: 4 imports",
    ...overrides,
  } as unknown as Parameters<typeof buildSingleZoneFirstPassEnvelope>[0];
}

/** The `output` section of each enrichment prompt. */
const OUTPUTS = {
  batchFirst: buildFirstPassEnvelope(
    ZONES, ATTEMPT, "", "", "", "", getPassConfig(1, 0),
  ),
  batchLater: buildLaterPassEnvelope(
    ZONES, ATTEMPT, "", "", 2, getPassConfig(2, 0), PREVIOUS, "",
  ),
  zoneFirst: buildSingleZoneFirstPassEnvelope(singleZoneCtx()),
  zoneLater: buildSingleZoneLaterPassEnvelope(
    singleZoneCtx({ passNumber: 2, previousZone: ZONES[0] }),
  ),
};

function outputSection(name: keyof typeof OUTPUTS): string {
  const s = OUTPUTS[name].sections.find((x) => x.name === "output");
  expect(s, `${name} has no output section`).toBeDefined();
  return s!.content;
}

const ALL = Object.keys(OUTPUTS) as (keyof typeof OUTPUTS)[];
const LATER_PASSES = ["batchLater", "zoneLater"] as const;

describe("the enrichment output contract is stated one way", () => {
  it.each(ALL)("%s asks for JSON with no markdown, in the shared wording", (name) => {
    expect(outputSection(name)).toContain(JSON_OBJECT_ONLY);
  });

  it.each(ALL)("%s does not use a hand-written variant of that line", (name) => {
    // The drift that prompted this file: one builder dropped the parenthetical.
    const section = outputSection(name);
    const mentions = [...section.matchAll(/Respond with ONLY a JSON/g)].length;
    expect(mentions).toBe(1);
    expect(section).not.toMatch(/Respond with ONLY a JSON object:\s*$/m);
  });

  it.each(LATER_PASSES)("%s states the add-only-new rule in the shared wording", (name) => {
    expect(outputSection(name)).toContain(ONLY_NEW_INSIGHTS);
  });
});

describe("the severity contract differs by pass only where intended", () => {
  it("batch prompts name the category enum", () => {
    for (const name of ["batchFirst", "batchLater"] as const) {
      expect(outputSection(name)).toContain(findingsContract(true));
    }
  });

  it("per-zone prompts omit it, and say so consistently", () => {
    // Deliberate: the per-zone path is the minimal fallback, and
    // classifyFinding() derives a category from the text when none is given.
    for (const name of ["zoneFirst", "zoneLater"] as const) {
      const section = outputSection(name);
      expect(section).toContain(findingsContract(false));
      expect(section).not.toContain("category (");
    }
  });

  it("the two forms differ only by the category clause", () => {
    expect(findingsContract(true)).toContain(findingsContract(false).replace(/\.$/, ""));
  });
});

/**
 * When Jev grades severity and category (enrich-judge.ts), every builder stops
 * asking the text model for them: the contract line goes, the example loses
 * the two keys, and the meta prompt drops its severityUpdates channel and the
 * re-rating task. The inactive path is pinned byte-for-byte by
 * prompt-text-identity.test.ts, so only the judged form is asserted here.
 */
function outputOf(envelope: { sections: ReadonlyArray<{ name: string; content: string }> }): string {
  return envelope.sections.find((x) => x.name === "output")!.content;
}

/** The batch prompts' output sections, in the plain or judged form. */
function batchOutputs(judged: boolean): string[] {
  return [
    buildFirstPassEnvelope(ZONES, ATTEMPT, "", "", "", "", getPassConfig(1, 0), undefined, undefined, undefined, judged),
    buildLaterPassEnvelope(ZONES, ATTEMPT, "", "", 2, getPassConfig(2, 0), PREVIOUS, "", undefined, undefined, undefined, judged),
  ].map(outputOf);
}

/** The per-zone prompts' output sections, in the plain or judged form. */
function perZoneOutputs(judged: boolean): string[] {
  return [
    buildSingleZoneFirstPassEnvelope(singleZoneCtx({ judged })),
    buildSingleZoneLaterPassEnvelope(singleZoneCtx({ passNumber: 2, previousZone: ZONES[0], judged })),
  ].map(outputOf);
}

const metaZones = ZONES;
const metaFindings: Finding[] = [
  { type: "observation", pass: 1, scope: "api", text: "Routes call billing directly.", severity: "info" },
];

describe("the judged form of every enrichment prompt", () => {
  const judgedSections = () => [
    ...batchOutputs(true),
    ...perZoneOutputs(true),
  ];

  it("omits the severity/category contract, the type/scope keys, and the types hint", () => {
    for (const text of judgedSections()) {
      expect(text).not.toContain("Findings: severity");
      expect(text).not.toContain('"severity":');
      expect(text).not.toContain('"category":');
      expect(text).not.toContain('"type":');
      expect(text).not.toContain('"scope":');
      expect(text).not.toContain("Use finding types");
      expect(text).toContain('"text":"finding text"');
      expect(text).toContain(JSON_OBJECT_ONLY);
      expect(text).not.toMatch(/\n\n\n/);
      expect(text.startsWith("\n")).toBe(false);
      expect(text.endsWith(" ")).toBe(false);
    }
  });

  it("keeps the inactive form when judged is false", () => {
    for (const text of [...batchOutputs(false), ...perZoneOutputs(false)]) {
      expect(text).toContain("Findings: severity");
      expect(text).toContain('"severity":"info"');
      expect(text).toContain('"type":"');
      expect(text).toContain("Use finding types");
    }
  });

  it("meta prompt drops severityUpdates and the re-rating task when judged", () => {
    const judged = buildMetaPrompt(metaZones, metaFindings, [], undefined, true);
    const plain = buildMetaPrompt(metaZones, metaFindings, [], undefined, false);
    expect(plain).toContain('"severityUpdates"');
    expect(plain).toContain("1. Reassess severities");
    expect(plain).toContain("Findings: severity");
    expect(judged).not.toContain('"severityUpdates"');
    expect(judged).not.toContain("Reassess severities");
    expect(judged).not.toContain("Findings: severity");
    expect(judged).not.toContain('"severity":');
    expect(judged).toContain("1. Find meta-patterns");
    expect(judged).toContain("3. Flag contradictory findings.");
    expect(judged).toContain("Preserve exact metric values");
  });
});
