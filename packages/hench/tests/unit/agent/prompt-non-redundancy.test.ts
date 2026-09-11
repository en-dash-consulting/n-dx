/**
 * The agent's prompt does not tell it the same thing twice.
 *
 * hench assembles one model call from two halves — the system prompt and the
 * task brief — built in different files by different functions. Neither could
 * see what the other emitted, so the same facts and the same instructions were
 * written into both, and the duplication was invisible in either file alone.
 * It only appears in the assembled envelope, which is what these tests read.
 *
 * What was duplicated when this file was written:
 *
 * - **The project block.** `buildSystemPrompt` emitted `## Project Info`
 *   (Project / CLI command / Validate command / Test command) and
 *   `formatTaskBrief` emitted `## Project` with the same four values under
 *   different labels. Every autonomous run paid for both.
 * - **Staging and the commit message.** Rule 5 and Workflow step 4 gave the
 *   same `git add -A` + `.hench-commit-msg.txt` + "do NOT run git commit"
 *   instruction, in full, within the same system prompt.
 * - **Read before you change, and run the tests.** Rules 1 and 4 restated
 *   Workflow steps 1 and 3.
 *
 * `## Rules` and `## Workflow` had drifted into two renderings of one list:
 * the same obligations as prohibitions and then as an ordered procedure.
 *
 * Repetition is not free — this is the prompt hench sends on *every*
 * autonomous run — and it is not harmless either: two phrasings of one rule
 * invite the reader to look for the distinction that must justify saying it
 * twice.
 *
 * Assertions count occurrences in the assembled envelope rather than comparing
 * bytes, because a paraphrase costs the same and reads worse.
 *
 * @see packages/hench/src/agent/planning/prompt.ts — the system half
 * @see packages/hench/src/agent/planning/brief.ts — the brief half
 */

import { describe, it, expect } from "vitest";
import { buildPromptEnvelope } from "../../../src/agent/planning/prompt.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/index.js";
import type { TaskBrief } from "../../../src/schema/index.js";

const BRIEF: TaskBrief = {
  task: {
    id: "task-001",
    title: "Add input validation to login form",
    level: "task",
    status: "pending",
    description: "Validate email format and password length before submission.",
    acceptanceCriteria: ["Email must match RFC 5322 format"],
    priority: "high",
    tags: ["auth"],
  },
  parentChain: [
    {
      id: "epic-001",
      title: "User Authentication",
      level: "epic",
      description: "Complete auth system.",
    },
  ],
  requirements: [],
  siblings: [],
  project: {
    name: "widget-service",
    cliName: "widget",
    validateCommand: "pnpm typecheck",
    testCommand: "pnpm test",
  },
  recentLog: [],
} as unknown as TaskBrief;

/** The assembled prompt for a provider, both halves joined as the model sees it. */
function assembled(provider: "cli" | "api"): string {
  const envelope = buildPromptEnvelope(BRIEF, {
    ...DEFAULT_HENCH_CONFIG(),
    provider,
  });
  return envelope.sections.map((s) => s.content).join("\n\n");
}

/** Non-overlapping match count. */
function count(text: string, re: RegExp): number {
  return [...text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))].length;
}

const PROVIDERS = ["cli", "api"] as const;

describe("the assembled prompt states each project fact once", () => {
  it.each(PROVIDERS)("%s: names the validate command once", (provider) => {
    // The value, not the label — the two blocks used different labels
    // ("Validate command:" vs "Validate:") for the identical fact, which is
    // exactly why a label-based check would have missed it.
    expect(count(assembled(provider), /pnpm typecheck/g)).toBe(1);
  });

  it.each(PROVIDERS)("%s: names the test command once", (provider) => {
    expect(count(assembled(provider), /pnpm test/g)).toBe(1);
  });

  it.each(PROVIDERS)("%s: names the project once", (provider) => {
    expect(count(assembled(provider), /widget-service/g)).toBe(1);
  });
});

describe("the assembled prompt gives each instruction once", () => {
  it.each(PROVIDERS)("%s: explains staging exactly once", (provider) => {
    expect(count(assembled(provider), /git add -A/g)).toBeLessThanOrEqual(1);
  });

  it.each(PROVIDERS)("%s: names the commit-message file once", (provider) => {
    expect(count(assembled(provider), /\.hench-commit-msg\.txt/g)).toBeLessThanOrEqual(1);
  });

  it.each(PROVIDERS)("%s: forbids running git commit once", (provider) => {
    expect(count(assembled(provider), /do NOT run `?git commit/gi)).toBeLessThanOrEqual(1);
  });

  it.each(PROVIDERS)("%s: says to read before changing once", (provider) => {
    const text = assembled(provider);
    const rule = count(text, /Read existing code before modifying/gi);
    const workflow = count(text, /Explore the codebase to understand context/gi);
    expect(rule + workflow).toBeLessThanOrEqual(1);
  });

  it.each(PROVIDERS)("%s: says to run tests once", (provider) => {
    const text = assembled(provider);
    const rule = count(text, /Run tests after making changes/gi);
    const workflow = count(text, /Run validation\/tests if configured/gi);
    expect(rule + workflow).toBeLessThanOrEqual(1);
  });
});

describe("a retry tells the agent what to do differently", () => {
  it("frames a previous failure as a corrective instruction, not raw output", () => {
    // Dumping the prior failure text under a heading and stopping leaves the
    // model to infer what to change — and the most available continuation is
    // the approach it just tried. The section must direct a change of
    // approach, not merely report that one failed.
    const retry = buildPromptEnvelope(
      {
        ...BRIEF,
        task: { ...BRIEF.task, failureReason: "Tests timed out after 600s." },
      } as unknown as TaskBrief,
      { ...DEFAULT_HENCH_CONFIG(), provider: "cli" },
    );
    const text = retry.sections.map((s) => s.content).join("\n\n");

    expect(text).toContain("Tests timed out after 600s.");
    expect(
      /do not repeat|different approach|changed approach|caused the failure|avoid repeating/i.test(
        text,
      ),
      "PREVIOUS FAILURE reports the prior failure but does not instruct the " +
        "agent to take a different approach.",
    ).toBe(true);
  });
});
