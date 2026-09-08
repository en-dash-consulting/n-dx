/**
 * Envelope structure and per-section cost for rex's prompts.
 *
 * The companion to `prompt-text-identity.test.ts`. That file proves the
 * migration did not change what rex sends; this one proves the migration
 * bought something — that every prompt now exposes named sections whose token
 * cost can be attributed individually, which is what the follow-on rewrites
 * need in order to open the largest section first.
 *
 * The invariants that matter:
 *
 * - Assembling an envelope reproduces the paired `*Prompt` function exactly,
 *   so the measured sections are the text that is actually sent.
 * - Section names are unique within a prompt. A duplicate name would split one
 *   part's cost across two identically-labelled rows and silently mislead.
 * - Section names come from the shared vocabulary, so a section's cost is
 *   comparable across builders.
 * - The section costs sum to the whole, so no part of a prompt is unattributed.
 *
 * @see packages/rex/src/analyze/prompt-envelope.ts — the vocabulary
 * @see packages/llm-client/src/prompt-diagnostics.ts — the shared measurement
 */

import { describe, it, expect } from "vitest";

import {
  REX_PROMPT_SECTIONS,
  rexPrompt,
  rexPromptCosts,
} from "../../../src/analyze/prompt-envelope.js";
import {
  buildFileImportEnvelope,
  buildFileImportPrompt,
  buildScanImportEnvelope,
  buildScanImportPrompt,
  buildAddEnvelope,
  buildMultiAddEnvelope,
  buildBreakdownEnvelope,
  buildBreakdownPrompt,
  buildConsolidateEnvelope,
  buildConsolidatePrompt,
  buildAssessmentEnvelope,
  buildAssessmentPrompt,
  buildIdeasEnvelope,
} from "../../../src/analyze/reason.js";
import {
  buildConsolidationGuardEnvelope,
  buildConsolidationGuardPrompt,
} from "../../../src/analyze/consolidation-guard.js";
import {
  buildDecompositionEnvelope,
  buildDecompositionPrompt,
} from "../../../src/analyze/decompose.js";
import {
  buildDisambiguationEnvelope,
  buildDisambiguationPrompt,
} from "../../../src/analyze/extract.js";
import { buildClarifyEnvelope, buildSpecEnvelope } from "../../../src/analyze/guided.js";
import { buildModifyEnvelope, buildModifyPrompt } from "../../../src/analyze/modify-reason.js";
import {
  buildGroupRenameEnvelope,
  buildGroupRenamePrompt,
} from "../../../src/analyze/propose-group-renames.js";
import { buildRenameEnvelope, buildRenamePrompt } from "../../../src/analyze/rename-resolve.js";
import {
  buildReshapeEnvelope,
  buildReshapePrompt,
  buildBodyMergeEnvelope,
  buildBodyMergePrompt,
} from "../../../src/analyze/reshape-reason.js";
import {
  buildValidationFeedbackEnvelope,
  buildValidationFeedback,
} from "../../../src/analyze/escalate.js";
import type { PromptEnvelope } from "@n-dx/llm-client";
import type { PRDItem } from "../../../src/schema/index.js";
import type { Proposal } from "../../../src/analyze/index.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const PROJECT_CONTEXT = "--- README.md ---\n# Widget Service\n\nBilling for widgets.";

const EXISTING_ITEMS: PRDItem[] = [
  {
    id: "epic-1",
    title: "Billing",
    level: "epic",
    status: "in_progress",
    children: [
      { id: "feat-1", title: "Invoices", level: "feature", status: "pending", children: [] },
    ],
  },
] as unknown as PRDItem[];

const PROPOSALS: Proposal[] = [
  {
    epic: { title: "Subscription Lifecycle" },
    features: [
      {
        title: "Trial handling",
        description: "Start and convert a free trial.",
        tasks: [
          {
            title: "Implement trial start endpoint",
            description: "Create a trial subscription with an explicit expiry.",
            acceptanceCriteria: ["POST /trials creates a trial subscription"],
            priority: "high",
            tags: ["billing"],
            loe: 1,
            loeRationale: "One endpoint plus tests.",
            loeConfidence: "high",
          },
        ],
      },
    ],
  },
] as unknown as Proposal[];

const RENAME_ITEMS = [
  {
    id: "r-1",
    title: "Billing",
    level: "feature",
    status: "pending",
    description: "Invoices.",
    children: [],
  },
  {
    id: "r-2",
    title: "Billing",
    level: "feature",
    status: "pending",
    description: "Dunning.",
    children: [],
  },
] as unknown as PRDItem[];

/**
 * Every rex prompt surface: its envelope, and the assembled string its paired
 * `*Prompt` function produces. `assembled` is undefined where the pair is not
 * separately exported (the guided flow keeps its string builders private).
 */
const SURFACES: Array<{
  name: string;
  envelope: PromptEnvelope;
  assembled?: string;
  separator?: string;
}> = [
  {
    name: "buildFileImportEnvelope",
    envelope: buildFileImportEnvelope("# Doc", "markdown", EXISTING_ITEMS),
    assembled: buildFileImportPrompt("# Doc", "markdown", EXISTING_ITEMS),
  },
  {
    name: "buildScanImportEnvelope",
    envelope: buildScanImportEnvelope({
      scanSummary: "[task] Add validation",
      existingSummary: "- [epic] Billing (in_progress)",
      projectContext: PROJECT_CONTEXT,
      chunkNote: "Note: This is chunk 1 of 2.",
      isBaseline: true,
    }),
    assembled: buildScanImportPrompt({
      scanSummary: "[task] Add validation",
      existingSummary: "- [epic] Billing (in_progress)",
      projectContext: PROJECT_CONTEXT,
      chunkNote: "Note: This is chunk 1 of 2.",
      isBaseline: true,
    }),
  },
  {
    name: "buildAddEnvelope",
    envelope: buildAddEnvelope("Add dunning.", EXISTING_ITEMS, PROJECT_CONTEXT),
  },
  {
    name: "buildMultiAddEnvelope",
    envelope: buildMultiAddEnvelope(["A", "B"], EXISTING_ITEMS, PROJECT_CONTEXT),
  },
  {
    name: "buildBreakdownEnvelope",
    envelope: buildBreakdownEnvelope(PROPOSALS),
    assembled: buildBreakdownPrompt(PROPOSALS),
  },
  {
    name: "buildConsolidateEnvelope",
    envelope: buildConsolidateEnvelope(PROPOSALS),
    assembled: buildConsolidatePrompt(PROPOSALS),
  },
  {
    name: "buildAssessmentEnvelope",
    envelope: buildAssessmentEnvelope(PROPOSALS),
    assembled: buildAssessmentPrompt(PROPOSALS),
  },
  {
    name: "buildIdeasEnvelope",
    envelope: buildIdeasEnvelope("- caching", EXISTING_ITEMS, PROJECT_CONTEXT),
  },
  {
    name: "buildConsolidationGuardEnvelope",
    envelope: buildConsolidationGuardEnvelope(PROPOSALS, 5, 12),
    assembled: buildConsolidationGuardPrompt(PROPOSALS, 5, 12),
  },
  {
    name: "buildDecompositionEnvelope",
    envelope: buildDecompositionEnvelope(PROPOSALS[0].features[0].tasks[0], 1),
    assembled: buildDecompositionPrompt(PROPOSALS[0].features[0].tasks[0], 1),
  },
  {
    name: "buildDisambiguationEnvelope",
    envelope: buildDisambiguationEnvelope("Prose.", new Set(["Billing"])),
    assembled: buildDisambiguationPrompt("Prose.", new Set(["Billing"])),
  },
  {
    name: "buildClarifyEnvelope",
    envelope: buildClarifyEnvelope(
      { description: "A billing service.", exchanges: [{ question: "Q", answer: "A" }] },
      PROJECT_CONTEXT,
    ),
  },
  {
    name: "buildSpecEnvelope",
    envelope: buildSpecEnvelope(
      { description: "A billing service.", exchanges: [{ question: "Q", answer: "A" }] },
      PROJECT_CONTEXT,
    ),
  },
  {
    name: "buildModifyEnvelope",
    envelope: buildModifyEnvelope(PROPOSALS, "Split it.", {
      existingSummary: "- [epic] Billing",
      projectContext: PROJECT_CONTEXT,
    }),
    assembled: buildModifyPrompt(PROPOSALS, "Split it.", {
      existingSummary: "- [epic] Billing",
      projectContext: PROJECT_CONTEXT,
    }),
  },
  {
    name: "buildGroupRenameEnvelope",
    envelope: buildGroupRenameEnvelope({
      baseTitle: "Billing",
      members: [
        { id: "a-1", title: "Billing 1", level: "feature", description: "Invoices." },
        { id: "a-2", title: "Billing 2", level: "feature", description: "Dunning." },
      ],
    } as unknown as Parameters<typeof buildGroupRenameEnvelope>[0]),
    assembled: buildGroupRenamePrompt({
      baseTitle: "Billing",
      members: [
        { id: "a-1", title: "Billing 1", level: "feature", description: "Invoices." },
        { id: "a-2", title: "Billing 2", level: "feature", description: "Dunning." },
      ],
    } as unknown as Parameters<typeof buildGroupRenamePrompt>[0]),
  },
  {
    name: "buildRenameEnvelope",
    envelope: buildRenameEnvelope(RENAME_ITEMS[0], RENAME_ITEMS[1]),
    assembled: buildRenamePrompt(RENAME_ITEMS[0], RENAME_ITEMS[1]),
  },
  {
    name: "buildReshapeEnvelope",
    envelope: buildReshapeEnvelope(EXISTING_ITEMS, "reshape", PROJECT_CONTEXT),
    assembled: buildReshapePrompt(EXISTING_ITEMS, "reshape", PROJECT_CONTEXT),
    separator: "\n",
  },
  {
    name: "buildBodyMergeEnvelope",
    envelope: buildBodyMergeEnvelope(RENAME_ITEMS),
    assembled: buildBodyMergePrompt(RENAME_ITEMS),
    separator: "\n",
  },
  {
    name: "buildValidationFeedbackEnvelope",
    envelope: buildValidationFeedbackEnvelope("PROMPT", "bad loe", 2),
    assembled: buildValidationFeedback("PROMPT", "bad loe", 2),
  },
];

// ── Structural invariants, applied to every surface ─────────────────────────

describe("every rex prompt is envelope-built", () => {
  it("covers all 19 registered prompt surfaces", () => {
    // Keeps this file honest against scripts/prompt-census.mjs, which declares
    // 19 rex surfaces. A new prompt with no entry here would go unmeasured.
    expect(SURFACES).toHaveLength(19);
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
        expect(REX_PROMPT_SECTIONS).toContain(s.name);
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
      expect(rexPrompt(surface.envelope, { separator: surface.separator })).toBe(
        surface.assembled,
      );
    },
  );
});

// ── Cost attribution ───────────────────────────────────────────────────────

describe("rex prompt cost is attributable to sections", () => {
  it.each(SURFACES.map((s) => [s.name, s] as const))(
    "%s reports a cost per section, summing to 100%%",
    (_name, surface) => {
      const costs = rexPromptCosts(surface.envelope);

      expect(costs).toHaveLength(surface.envelope.sections.length);
      for (const c of costs) {
        expect(c.tokenEstimate).toBeGreaterThan(0);
      }
      expect(costs.reduce((n, c) => n + c.sharePercent, 0)).toBeCloseTo(100, 6);
    },
  );

  it("names the few-shot example as the single dominant cost of a propose prompt", () => {
    // The finding that makes the follow-on rewrite tractable. Measured at the
    // time of writing, `buildAddEnvelope` over a two-item PRD costs ~1,730
    // tokens and divides as:
    //
    //   example 25% · schema 19% · consolidation 13% · quality 11% ·
    //   anti-patterns 8% · placement 7% · dedup 5% · structure 4% ·
    //   output 3% · role 2% · existing-prd 2% · project-context 1% · input 0.5%
    //
    // So the worked example and the JSON schema are the top two by a wide
    // margin, and the caller's actual description — the only part that is not
    // fixed text — is a rounding error. That is the ordering a rewrite should
    // follow; the assertions below pin the shape of it, not the exact figures.
    const costs = rexPromptCosts(
      buildAddEnvelope("Add dunning.", EXISTING_ITEMS, PROJECT_CONTEXT),
    );
    const byName = new Map(costs.map((c) => [c.name, c]));
    const dominant = [...costs].sort((a, b) => b.tokenEstimate - a.tokenEstimate);

    expect(dominant[0].name).toBe("example");
    expect(dominant[1].name).toBe("schema");

    const example = byName.get("example")!;
    const schema = byName.get("schema")!;
    expect(example.sharePercent + schema.sharePercent).toBeGreaterThan(40);

    // The instructions, not the input, are what this prompt pays for — which
    // is why shortening them is worth doing at all.
    expect(byName.get("input")!.sharePercent).toBeLessThan(2);
    expect(byName.get("role")!.tokenEstimate).toBeLessThan(example.tokenEstimate);
  });

  it("attributes a large input to the input section, not the instructions", () => {
    // The other half of the point: a prompt dominated by caller-supplied
    // context must not read as an expensive instruction set. Shortening
    // instructions here would save nothing.
    const costs = rexPromptCosts(
      buildDisambiguationEnvelope("x".repeat(20_000), new Set(["Billing"])),
    );
    const input = costs.find((c) => c.name === "input");

    expect(input).toBeDefined();
    expect(input!.sharePercent).toBeGreaterThan(80);
  });
});
