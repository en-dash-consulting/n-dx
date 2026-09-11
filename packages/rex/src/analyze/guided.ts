import { createInterface } from "node:readline";
import { z } from "zod";
import { spawnClaude } from "./reason.js";
import {
  readProjectContext,
  parseProposalResponse,
  FEW_SHOT_EXAMPLE,
  PRD_SCHEMA,
  TASK_QUALITY_RULES,
  OUTPUT_INSTRUCTION,
  resolveConfiguredModel,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
} from "./reason.js";
import type { ReasonResult } from "./reason.js";
import { info } from "../cli/output.js";
import type { PromptEnvelope } from "@n-dx/llm-client";
import { section, rexPromptEnvelope, rexPrompt } from "./prompt-envelope.js";

// ── Types ──

export interface GuidedContext {
  description: string;
  exchanges: Array<{ question: string; answer: string }>;
}

export interface ClarifyResponse {
  status: "clarifying" | "ready";
  questions?: string[];
  summary?: string;
}

const ClarifyResponseSchema = z.object({
  status: z.enum(["clarifying", "ready"]),
  questions: z.array(z.string()).optional(),
  summary: z.string().optional(),
});

// ── Readline helper ──

export function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Clarification round ──

/**
 * Prompt asking whether enough is known to write a spec, and what to ask next.
 *
 * Exported so the section costs of the guided flow's two prompts are visible
 * alongside every other rex surface; it was module-private and unmeasurable.
 */
export function buildClarifyEnvelope(
  context: GuidedContext,
  projectContext: string,
): PromptEnvelope {
  return rexPromptEnvelope([
    section(
      "role",
      "You are a product specification assistant helping a user define their project requirements.",
    ),
    section(
      "input",
      "The user is building a new project and has provided the following description:\n" +
        `<description>${context.description}</description>`,
    ),
    section(
      "input-rules",
      context.exchanges.length > 0
        ? [
          "Previous clarifications:",
          ...context.exchanges.map((ex) => `Q: ${ex.question}\nA: ${ex.answer}`),
        ].join("\n")
        : "",
    ),
    section("project-context", projectContext ? `Project context:\n${projectContext}` : ""),
    section(
      "structure",
      [
        "Your task: Evaluate whether you have enough information to generate a comprehensive product spec (epics, features, and tasks).",
        "",
        "Key areas to probe (only ask about what's missing):",
        "- Target users and their primary use cases",
        "- Core features vs nice-to-haves (priorities)",
        "- Technical constraints or preferences (language, framework, infra)",
        '- Success criteria (what does "done" look like?)',
        "- Integrations, data models, or workflows that need defining",
      ].join("\n"),
    ),
    section(
      "output",
      [
        "If you need more information, respond with:",
        '{ "status": "clarifying", "questions": ["question1", "question2", ...] }',
        "Ask 2-4 focused, specific questions. Don't repeat questions already answered. Avoid generic questions — each should unlock concrete requirements.",
        "",
        "If you have enough information, respond with:",
        '{ "status": "ready", "summary": "Brief summary of what you understand the project to be" }',
        "",
        "Respond with ONLY the JSON object. No markdown fences, no explanation.",
      ].join("\n"),
    ),
  ]);
}

function buildClarifyPrompt(
  context: GuidedContext,
  projectContext: string,
): string {
  return rexPrompt(buildClarifyEnvelope(context, projectContext));
}

export async function clarify(
  context: GuidedContext,
  projectContext: string,
  model: string,
): Promise<ClarifyResponse> {
  const prompt = buildClarifyPrompt(context, projectContext);
  const claudeResult = await spawnClaude(prompt, model);

  // Strip markdown fences if present
  let text = claudeResult.text.trim();
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(text);
    const result = ClarifyResponseSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  } catch {
    // Malformed response — fall through
  }

  // Fallback: treat malformed response as ready (stop asking questions)
  return { status: "ready", summary: text.slice(0, 200) };
}

// ── Spec generation ──

/** Prompt turning the guided conversation into a full PRD proposal set. */
export function buildSpecEnvelope(
  context: GuidedContext,
  projectContext: string,
): PromptEnvelope {
  return rexPromptEnvelope([
    section(
      "role",
      "You are a product requirements analyst. Create a comprehensive PRD breakdown as a JSON array from the following project specification.",
    ),
    section("schema", PRD_SCHEMA),
    section("example", FEW_SHOT_EXAMPLE),
    section(
      "structure",
      [
        "Structuring guidelines:",
        "- Create a complete initial PRD covering ALL aspects discussed — do not leave gaps.",
        "- Group related work into epics, break epics into features, features into tasks.",
        "- Assign priority: critical for blocking/foundational, high for core features, medium for enhancements, low for nice-to-haves.",
      ].join("\n"),
    ),
    section("quality", TASK_QUALITY_RULES),
    section("input", `Project description:\n${context.description}`),
    section(
      "input-rules",
      context.exchanges.length > 0
        ? [
          "Clarifications:",
          ...context.exchanges.map((ex) => `Q: ${ex.question}\nA: ${ex.answer}`),
        ].join("\n")
        : "",
    ),
    section("project-context", projectContext ? `Project context:\n${projectContext}` : ""),
    section("output", OUTPUT_INSTRUCTION),
  ]);
}

function buildSpecPrompt(
  context: GuidedContext,
  projectContext: string,
): string {
  return rexPrompt(buildSpecEnvelope(context, projectContext));
}

export async function generateSpecFromContext(
  context: GuidedContext,
  projectContext: string,
  model: string,
): Promise<ReasonResult> {
  const prompt = buildSpecPrompt(context, projectContext);
  const tokenUsage = emptyAnalyzeTokenUsage();
  const claudeResult = await spawnClaude(prompt, model);
  accumulateTokenUsage(tokenUsage, claudeResult.tokenUsage);
  return { proposals: parseProposalResponse(claudeResult.text), tokenUsage };
}

// ── Main flow ──

const MAX_CLARIFY_ROUNDS = 5;

export async function runGuidedSpec(
  dir: string,
  model?: string,
): Promise<ReasonResult> {
  const effectiveModel = resolveConfiguredModel(model, { taskClass: "prd.spec" });
  // Clarify rounds are mechanical single-shot calls (question generation) —
  // routed light by the registry. Spec synthesis stays on the standard model.
  // An explicit --model flag overrides both.
  const clarifyModel = resolveConfiguredModel(model, { taskClass: "prd.clarify" });
  const tokenUsage = emptyAnalyzeTokenUsage();

  info("Guided spec builder — let's define your project.\n");

  const description = await promptLine(
    "What are you building? Describe your project in a few sentences:\n> ",
  );

  if (!description) {
    info("No description provided. Exiting guided mode.");
    return { proposals: [], tokenUsage };
  }

  const context: GuidedContext = { description, exchanges: [] };
  const projectContext = await readProjectContext(dir);

  // Clarification loop
  for (let round = 0; round < MAX_CLARIFY_ROUNDS; round++) {
    info("\nAnalyzing your project...");
    const response = await clarify(context, projectContext, clarifyModel);

    if (response.status === "ready") {
      if (response.summary) {
        info(`\nUnderstood: ${response.summary}`);
      }
      break;
    }

    if (!response.questions || response.questions.length === 0) {
      break;
    }

    info("");
    for (const question of response.questions) {
      const answer = await promptLine(`${question}\n> `);
      if (answer.toLowerCase() === "done") {
        info("Skipping remaining questions.");
        break;
      }
      context.exchanges.push({ question, answer });
    }

    // Check if user typed "done" for any question
    if (
      context.exchanges.length > 0 &&
      context.exchanges[context.exchanges.length - 1].answer.toLowerCase() === "done"
    ) {
      // Remove the "done" entry — it's not a real answer
      context.exchanges.pop();
      break;
    }
  }

  info("\nGenerating proposals from your spec...");
  return generateSpecFromContext(context, projectContext, effectiveModel);
}
