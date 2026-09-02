/**
 * Prompt JSON discipline — compact in, compact out.
 *
 * Every rex prompt that embeds a proposal or task used
 * `JSON.stringify(x, null, 2)`. Indentation is billed: two spaces per nesting
 * level on every key of every proposal, on every analyze call, forever. It buys
 * nothing — the model does not read JSON more accurately for being pretty.
 *
 * Output matters more than input: output tokens cost roughly 5x input on every
 * tier, so the prompts also have to *ask* for minified JSON rather than
 * accepting whatever the model feels like emitting.
 *
 * These assertions are behavioural rather than a grep for `null, 2`, because
 * grep cannot tell a prompt from the many legitimate pretty-printers in the
 * tree — `--format=json` CLI output and on-disk config files are supposed to
 * stay readable. Building the real prompt and looking at it can.
 *
 * @see packages/rex/src/analyze/analyze-shared.ts — OUTPUT_INSTRUCTION
 */

import { describe, it, expect } from "vitest";
import type { Proposal, ProposalTask } from "../../../src/analyze/propose.js";
import { buildConsolidationGuardPrompt } from "../../../src/analyze/consolidation-guard.js";
import {
  buildBreakdownPrompt,
  buildConsolidatePrompt,
  buildAssessmentPrompt,
} from "../../../src/analyze/reason.js";
import { buildModifyPrompt } from "../../../src/analyze/modify-reason.js";
import { buildDecompositionPrompt } from "../../../src/analyze/decompose.js";
import { OUTPUT_INSTRUCTION } from "../../../src/analyze/analyze-shared.js";

// ── Fixtures ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<ProposalTask> = {}): ProposalTask {
  return {
    title: "Implement the OAuth2 callback handler",
    source: "test",
    sourceFile: "src/auth/callback.ts",
    description: "Exchange the authorization code for a token pair.",
    acceptanceCriteria: ["A valid code yields a token pair", "An expired code is rejected"],
    priority: "medium",
    loe: 2,
    loeRationale: "Two integration points",
    loeConfidence: "medium",
    ...overrides,
  };
}

function makeProposal(title = "Authentication"): Proposal {
  return {
    epic: { title, source: "test" },
    features: [
      { title: `${title} Feature`, source: "test", tasks: [makeTask(), makeTask({ title: "Add token refresh" })] },
    ],
  };
}

const PROPOSALS: Proposal[] = [makeProposal(), makeProposal("Billing")];

/**
 * Every prompt builder that embeds JSON, with a ready-to-call thunk.
 * Keyed by the name that appears in a failure message.
 */
const PROMPTS: Array<[string, () => string]> = [
  ["buildConsolidationGuardPrompt", () => buildConsolidationGuardPrompt(PROPOSALS, 8, 20)],
  ["buildBreakdownPrompt", () => buildBreakdownPrompt(PROPOSALS)],
  ["buildConsolidatePrompt", () => buildConsolidatePrompt(PROPOSALS)],
  ["buildAssessmentPrompt", () => buildAssessmentPrompt(PROPOSALS)],
  ["buildModifyPrompt", () => buildModifyPrompt(PROPOSALS, "split the billing epic")],
  ["buildDecompositionPrompt", () => buildDecompositionPrompt(makeTask({ loe: 6 }), 2)],
];

/**
 * Pretty-printed JSON always puts a newline plus indentation immediately after
 * an opening brace or bracket. Compact JSON never does. Matching that, rather
 * than any indented line, keeps prose bullet lists in the prompts from
 * registering as false positives.
 */
const PRETTY_JSON = /[{[]\n\s+"/;

// ── Input side ────────────────────────────────────────────────────────

describe("prompt-embedded JSON is compact", () => {
  for (const [name, build] of PROMPTS) {
    it(`${name} embeds no pretty-printed JSON`, () => {
      const prompt = build();
      const match = PRETTY_JSON.exec(prompt);

      expect(
        match,
        `${name} embeds indented JSON at offset ${match?.index}: ` +
          `${JSON.stringify(match?.[0])}. Use JSON.stringify(x) — the ` +
          `indentation is billed on every call and buys nothing.`,
      ).toBeNull();
    });
  }

  it("still embeds the data itself, not just an empty shell", () => {
    // Guards against the assertions above being satisfied by a prompt that
    // dropped its payload entirely.
    for (const [name, build] of PROMPTS) {
      const prompt = build();
      expect(prompt, `${name} lost its payload`).toContain("OAuth2 callback handler");
    }
  });

  it("embeds parseable JSON — compacting must not mangle it", () => {
    const prompt = buildBreakdownPrompt(PROPOSALS);
    const compact = JSON.stringify(PROPOSALS);

    expect(prompt).toContain(compact);
    expect(() => JSON.parse(compact)).not.toThrow();
  });
});

// ── Output side ───────────────────────────────────────────────────────

describe("prompts request minified JSON output", () => {
  it("the shared OUTPUT_INSTRUCTION asks for minified JSON with no fences or prose", () => {
    expect(OUTPUT_INSTRUCTION.toLowerCase()).toContain("minified");
    expect(OUTPUT_INSTRUCTION.toLowerCase()).toContain("no markdown fences");
  });

  for (const [name, build] of PROMPTS) {
    it(`${name} tells the model to return minified JSON`, () => {
      const prompt = build().toLowerCase();

      expect(
        prompt.includes("minified"),
        `${name} does not ask for minified output. Output tokens cost ~5x ` +
          `input, so the response format is where the saving is.`,
      ).toBe(true);
      expect(prompt).toContain("no markdown fences");
    });
  }
});
