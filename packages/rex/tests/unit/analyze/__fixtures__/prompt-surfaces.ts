/**
 * Every rex prompt surface, built from one shared set of fixtures.
 *
 * Two suites need the same nineteen builders invoked with plausible arguments:
 * `prompt-envelope-sections.test.ts` (structure and per-section cost) and
 * `prompt-non-redundancy.test.ts` (no instruction stated twice, none
 * contradicting another). Keeping the list in one place is what stops a new
 * prompt from being covered by one suite and missed by the other — the failure
 * mode where a prompt looks tested because *a* prompt test exists.
 *
 * `assembled` is present only where the paired `*Prompt` function is exported;
 * the guided flow keeps its string builders private.
 *
 * @see packages/rex/src/analyze/prompt-envelope.ts — the section vocabulary
 */

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
} from "../../../../src/analyze/reason.js";
import {
  buildConsolidationGuardEnvelope,
  buildConsolidationGuardPrompt,
} from "../../../../src/analyze/consolidation-guard.js";
import {
  buildDecompositionEnvelope,
  buildDecompositionPrompt,
} from "../../../../src/analyze/decompose.js";
import {
  buildDisambiguationEnvelope,
  buildDisambiguationPrompt,
} from "../../../../src/analyze/extract.js";
import { buildClarifyEnvelope, buildSpecEnvelope } from "../../../../src/analyze/guided.js";
import { buildModifyEnvelope, buildModifyPrompt } from "../../../../src/analyze/modify-reason.js";
import {
  buildGroupRenameEnvelope,
  buildGroupRenamePrompt,
} from "../../../../src/analyze/propose-group-renames.js";
import { buildRenameEnvelope, buildRenamePrompt } from "../../../../src/analyze/rename-resolve.js";
import {
  buildReshapeEnvelope,
  buildReshapePrompt,
  buildBodyMergeEnvelope,
  buildBodyMergePrompt,
} from "../../../../src/analyze/reshape-reason.js";
import {
  buildValidationFeedbackEnvelope,
  buildValidationFeedback,
} from "../../../../src/analyze/escalate.js";
import type { PromptEnvelope } from "@n-dx/llm-client";
import type { PRDItem } from "../../../../src/schema/index.js";
import type { Proposal } from "../../../../src/analyze/index.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

export const PROJECT_CONTEXT =
  "--- README.md ---\n# Widget Service\n\nBilling for widgets.";

export const EXISTING_ITEMS: PRDItem[] = [
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

export const PROPOSALS: Proposal[] = [
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

export const RENAME_ITEMS = [
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

export interface RexPromptSurface {
  name: string;
  envelope: PromptEnvelope;
  assembled?: string;
  separator?: string;
}

const SCAN_ARGS = {
  scanSummary: "[task] Add validation",
  existingSummary: "- [epic] Billing (in_progress)",
  projectContext: PROJECT_CONTEXT,
  chunkNote: "Note: This is chunk 1 of 2.",
  isBaseline: true,
};

const GUIDED_ANSWERS = {
  description: "A billing service.",
  exchanges: [{ question: "Q", answer: "A" }],
};

const MODIFY_OPTS = {
  existingSummary: "- [epic] Billing",
  projectContext: PROJECT_CONTEXT,
};

const GROUP_RENAME_ARGS = {
  baseTitle: "Billing",
  members: [
    { id: "a-1", title: "Billing 1", level: "feature", description: "Invoices." },
    { id: "a-2", title: "Billing 2", level: "feature", description: "Dunning." },
  ],
};

/** All nineteen registered rex prompt surfaces. */
export const REX_PROMPT_SURFACES: RexPromptSurface[] = [
  {
    name: "buildFileImportEnvelope",
    envelope: buildFileImportEnvelope("# Doc", "markdown", EXISTING_ITEMS),
    assembled: buildFileImportPrompt("# Doc", "markdown", EXISTING_ITEMS),
  },
  {
    name: "buildScanImportEnvelope",
    envelope: buildScanImportEnvelope(SCAN_ARGS),
    assembled: buildScanImportPrompt(SCAN_ARGS),
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
    envelope: buildClarifyEnvelope(GUIDED_ANSWERS, PROJECT_CONTEXT),
  },
  {
    name: "buildSpecEnvelope",
    envelope: buildSpecEnvelope(GUIDED_ANSWERS, PROJECT_CONTEXT),
  },
  {
    name: "buildModifyEnvelope",
    envelope: buildModifyEnvelope(PROPOSALS, "Split it.", MODIFY_OPTS),
    assembled: buildModifyPrompt(PROPOSALS, "Split it.", MODIFY_OPTS),
  },
  {
    name: "buildGroupRenameEnvelope",
    envelope: buildGroupRenameEnvelope(
      GROUP_RENAME_ARGS as unknown as Parameters<typeof buildGroupRenameEnvelope>[0],
    ),
    assembled: buildGroupRenamePrompt(
      GROUP_RENAME_ARGS as unknown as Parameters<typeof buildGroupRenamePrompt>[0],
    ),
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
