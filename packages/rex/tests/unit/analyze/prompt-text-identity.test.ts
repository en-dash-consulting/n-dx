/**
 * Byte-identity guard for every rex LLM prompt surface.
 *
 * ## Why snapshots, and why they were recorded before the envelope migration
 *
 * Moving rex's prompts onto `PromptEnvelope` is a restructuring step: the same
 * text, emitted from named sections instead of one large template literal, so
 * that each part becomes individually measurable. "Same text" is the whole
 * claim, and it is the kind of claim that is easy to assert and hard to notice
 * breaking — a lost blank line between two blocks changes nothing a type
 * checker or a unit test on parsed output would catch, and would silently
 * change what every `rex analyze` run sends to a model.
 *
 * These snapshots were recorded from the pre-migration implementation and left
 * untouched by it. They are therefore evidence rather than description: a
 * passing run means the assembled envelope reproduces the original prompt
 * exactly, separators included.
 *
 * Each surface is driven through its real entry point with a fixed fixture. The
 * four surfaces that build their prompt inline and call the model in the same
 * function are captured through an injected client (`setClaudeClient`), which
 * is also how they will still be captured after extraction — the test does not
 * change shape when the implementation does.
 *
 * A snapshot here should only ever be updated as part of a deliberate prompt
 * rewrite, and never to make a refactor pass.
 *
 * @see packages/rex/tests/unit/analyze/prompt-envelope-sections.test.ts — structure and cost
 * @see docs/analysis/prompt-token-baseline.md — the recorded token baseline
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setClaudeClient, setLLMConfig } from "../../../src/analyze/llm-bridge.js";
import {
  buildAddPrompt,
  buildMultiAddPrompt,
  buildBreakdownPrompt,
  buildConsolidatePrompt,
  buildAssessmentPrompt,
  buildIdeasPrompt,
  reasonFromFile,
  reasonFromScanResults,
} from "../../../src/analyze/reason.js";
import { buildConsolidationGuardPrompt } from "../../../src/analyze/consolidation-guard.js";
import { buildDecompositionPrompt } from "../../../src/analyze/decompose.js";
import { buildModifyPrompt } from "../../../src/analyze/modify-reason.js";
import { buildGroupRenamePrompt } from "../../../src/analyze/propose-group-renames.js";
import { buildRenamePrompt } from "../../../src/analyze/rename-resolve.js";
import { buildValidationFeedback } from "../../../src/analyze/escalate.js";
import { reasonForReshape, reasonForBodyMerge } from "../../../src/analyze/reshape-reason.js";
import { buildDisambiguationPrompt } from "../../../src/analyze/extract.js";
import { clarify, generateSpecFromContext } from "../../../src/analyze/guided.js";
import type { PRDItem } from "../../../src/schema/index.js";
import type { Proposal } from "../../../src/analyze/index.js";

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// Deliberately small and fully literal. A snapshot is only useful if the input
// that produced it cannot drift, so nothing here reads the repository or the
// clock.

const PROJECT_DOC = [
  "# Widget Service",
  "",
  "A billing service for widget subscriptions. Node, TypeScript, Postgres.",
].join("\n");

/** Temp project dir the context-loading builders read `README.md` from. */
let projectDir: string;

const EXISTING_ITEMS: PRDItem[] = [
  {
    id: "epic-1",
    title: "Billing",
    level: "epic",
    status: "in_progress",
    children: [
      {
        id: "feat-1",
        title: "Invoice generation",
        level: "feature",
        status: "pending",
        children: [
          {
            id: "task-1",
            title: "Render invoice PDF",
            level: "task",
            status: "completed",
            children: [],
          },
        ],
      },
    ],
  },
] as unknown as PRDItem[];

const PROPOSALS: Proposal[] = [
  {
    epic: { title: "Subscription Lifecycle" },
    features: [
      {
        title: "Trial handling",
        description: "Let a customer start and convert a free trial.",
        tasks: [
          {
            title: "Implement trial start endpoint",
            description: "Create a trial subscription with an explicit expiry.",
            acceptanceCriteria: [
              "POST /trials creates a subscription in trial state",
              "Expiry is exactly 14 days from creation",
            ],
            priority: "high",
            tags: ["billing", "api"],
            loe: 1,
            loeRationale: "One endpoint plus state transition and tests.",
            loeConfidence: "high",
          },
          {
            title: "Implement trial conversion job",
            description: "Convert or expire trials on their expiry date.",
            acceptanceCriteria: ["Expired trials move to cancelled"],
            priority: "medium",
            tags: ["billing"],
            loe: 2,
            loeRationale: "Scheduled job with idempotency requirements.",
            loeConfidence: "medium",
          },
        ],
      },
    ],
  },
] as unknown as Proposal[];

const SCAN_RESULTS = [
  {
    kind: "task",
    name: "Add input validation to /trials",
    source: "sourcevision",
    sourceFile: "src/routes/trials.ts",
    description: "Route accepts unvalidated body.",
    priority: "high",
  },
  {
    kind: "task",
    name: "Extract billing period helper",
    source: "sourcevision",
    sourceFile: "src/billing/period.ts",
    description: "Duplicated date arithmetic in three call sites.",
    priority: "medium",
  },
] as unknown as Parameters<typeof reasonFromScanResults>[0];

/**
 * Inject a client that records the prompt and returns a parseable response.
 *
 * The response has to survive each caller's own parsing step, otherwise the
 * call throws before the recorded prompt can be asserted on. An empty JSON
 * array satisfies every proposal parser rex has.
 */
function capturePrompts(response = "[]"): string[] {
  const prompts: string[] = [];
  setClaudeClient({
    mode: "cli",
    complete: async ({ prompt }: { prompt: string; model: string }) => {
      prompts.push(prompt);
      return { text: response };
    },
  } as never);
  return prompts;
}

beforeEach(() => {
  setLLMConfig({ vendor: "claude" });
});

projectDir = mkdtempSync(join(tmpdir(), "rex-prompt-identity-"));
writeFileSync(join(projectDir, "README.md"), PROJECT_DOC, "utf8");

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

// ── Directly callable builders ──────────────────────────────────────────────

describe("rex prompt text is unchanged by the envelope migration", () => {
  it("buildAddPrompt — with auto-placement", async () => {
    expect(
      await buildAddPrompt("Add dunning emails for failed payments.", EXISTING_ITEMS, projectDir),
    ).toMatchSnapshot();
  });

  it("buildAddPrompt — scoped to an explicit parent", async () => {
    expect(
      await buildAddPrompt("Add dunning emails.", EXISTING_ITEMS, projectDir, {
        parentId: "feat-1",
      }),
    ).toMatchSnapshot();
  });

  it("buildAddPrompt — empty PRD, no project docs", async () => {
    const bare = mkdtempSync(join(tmpdir(), "rex-prompt-bare-"));
    try {
      expect(await buildAddPrompt("Add dunning emails.", [], bare)).toMatchSnapshot();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("buildMultiAddPrompt", async () => {
    expect(
      await buildMultiAddPrompt(
        ["Add dunning emails.", "Add a billing audit log."],
        EXISTING_ITEMS,
        projectDir,
      ),
    ).toMatchSnapshot();
  });

  it("buildBreakdownPrompt", () => {
    expect(buildBreakdownPrompt(PROPOSALS)).toMatchSnapshot();
  });

  it("buildConsolidatePrompt", () => {
    expect(buildConsolidatePrompt(PROPOSALS)).toMatchSnapshot();
  });

  it("buildAssessmentPrompt", () => {
    expect(buildAssessmentPrompt(PROPOSALS)).toMatchSnapshot();
  });

  it("buildIdeasPrompt", async () => {
    expect(
      await buildIdeasPrompt(
        "- dunning emails\n- audit log\n- maybe usage-based pricing?",
        EXISTING_ITEMS,
        projectDir,
      ),
    ).toMatchSnapshot();
  });

  it("buildConsolidationGuardPrompt", () => {
    expect(buildConsolidationGuardPrompt(PROPOSALS, 5, 12)).toMatchSnapshot();
  });

  it("buildDecompositionPrompt", () => {
    expect(
      buildDecompositionPrompt(PROPOSALS[0].features[0].tasks[1], 1),
    ).toMatchSnapshot();
  });

  it("buildModifyPrompt", () => {
    expect(
      buildModifyPrompt(PROPOSALS, "Split the conversion job into two tasks.", {
        existingSummary: "- [epic] Billing (in_progress)",
        projectContext: PROJECT_DOC,
      }),
    ).toMatchSnapshot();
  });

  it("buildModifyPrompt — no context options", () => {
    expect(
      buildModifyPrompt(PROPOSALS, "Split the conversion job into two tasks."),
    ).toMatchSnapshot();
  });

  it("buildGroupRenamePrompt", () => {
    expect(
      buildGroupRenamePrompt({
        baseTitle: "Billing",
        members: [
          {
            id: "a-1",
            title: "Billing 1",
            level: "feature",
            description: "Invoice generation and delivery.",
          },
          {
            id: "a-2",
            title: "Billing 2",
            level: "feature",
            description: "Dunning and retries.",
          },
        ],
      } as unknown as Parameters<typeof buildGroupRenamePrompt>[0]),
    ).toMatchSnapshot();
  });

  it("buildRenamePrompt", () => {
    const [a, b] = [
      {
        id: "r-1",
        title: "Billing",
        level: "feature",
        status: "pending",
        description: "Invoice generation.",
        children: [],
      },
      {
        id: "r-2",
        title: "Billing",
        level: "feature",
        status: "pending",
        description: "Dunning emails.",
        children: [],
      },
    ] as unknown as PRDItem[];
    expect(buildRenamePrompt(a, b)).toMatchSnapshot();
  });

  it("buildValidationFeedback", () => {
    expect(
      buildValidationFeedback("ORIGINAL PROMPT BODY", "tasks[0].loe: expected number", 2),
    ).toMatchSnapshot();
  });

  it("buildDisambiguationPrompt", () => {
    expect(
      buildDisambiguationPrompt(
        "Some prose about billing with no clear heading structure.",
        new Set(["Billing", "Invoice generation"]),
      ),
    ).toMatchSnapshot();
  });

  it("buildDisambiguationPrompt — no existing titles", () => {
    expect(
      buildDisambiguationPrompt("Some prose about billing.", new Set()),
    ).toMatchSnapshot();
  });
});

// ── Surfaces captured through an injected client ────────────────────────────

describe("rex prompts built inline at the call site", () => {
  it("reasonFromFile — markdown document", async () => {
    const prompts = capturePrompts();
    const doc = join(projectDir, "requirements.md");
    writeFileSync(doc, "# Requirements\n\n- Trials must expire after 14 days.\n", "utf8");

    await reasonFromFile(doc, EXISTING_ITEMS);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchSnapshot();
  });

  it("reasonFromScanResults — populated PRD", async () => {
    const prompts = capturePrompts();

    await reasonFromScanResults(SCAN_RESULTS, EXISTING_ITEMS, { dir: projectDir });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchSnapshot();
  });

  it("reasonFromScanResults — baseline mode (empty PRD)", async () => {
    const prompts = capturePrompts();

    await reasonFromScanResults(SCAN_RESULTS, [], { dir: projectDir });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchSnapshot();
  });

  it("reasonForReshape", async () => {
    const prompts = capturePrompts("[]");

    await reasonForReshape(EXISTING_ITEMS, { dir: projectDir });

    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts[0]).toMatchSnapshot();
  });

  it("reasonForBodyMerge", async () => {
    // The body-merge contract is plain prose, and its validator rejects JSON.
    const prompts = capturePrompts(
      "Render, deliver, and email invoices to the billing contact.",
    );
    const group = [
      {
        id: "m-1",
        title: "Invoice generation",
        level: "feature",
        status: "pending",
        description: "Render and deliver invoices.",
        acceptanceCriteria: ["PDF renders"],
        children: [],
      },
      {
        id: "m-2",
        title: "Invoice generation",
        level: "feature",
        status: "pending",
        description: "Email invoices to the billing contact.",
        acceptanceCriteria: ["Email sends"],
        children: [],
      },
    ] as unknown as PRDItem[];

    await reasonForBodyMerge(group);

    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts[0]).toMatchSnapshot();
  });

  it("buildClarifyPrompt — via clarify", async () => {
    const prompts = capturePrompts('{"questions":[],"ready":true}');

    await clarify(
      {
        description: "A billing service for widget subscriptions.",
        exchanges: [{ question: "Which providers?", answer: "Stripe only." }],
      } as unknown as Parameters<typeof clarify>[0],
      PROJECT_DOC,
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchSnapshot();
  });

  it("buildSpecPrompt — via generateSpecFromContext", async () => {
    const prompts = capturePrompts("[]");

    await generateSpecFromContext(
      {
        description: "A billing service for widget subscriptions.",
        exchanges: [{ question: "Which providers?", answer: "Stripe only." }],
      } as unknown as Parameters<typeof generateSpecFromContext>[0],
      PROJECT_DOC,
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchSnapshot();
  });
});
