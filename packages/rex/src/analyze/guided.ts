import { createInterface } from "node:readline";
import { z } from "zod";
import { spawnClaude } from "./reason.js";
import {
  readProjectContext,
  parseProposalResponse,
  FEW_SHOT_EXAMPLE,
  DEFAULT_MODEL,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
} from "./reason.js";
import type { ReasonResult } from "./reason.js";
import type { Proposal } from "./propose.js";
import { info } from "../cli/output.js";

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

function buildClarifyPrompt(
  context: GuidedContext,
  projectContext: string,
): string {
  let prompt = `You are a product specification assistant helping a user define their project requirements.

The user is building a new project and has provided the following description:
<description>${context.description}</description>
`;

  if (context.exchanges.length > 0) {
    prompt += "\nPrevious clarifications:\n";
    for (const ex of context.exchanges) {
      prompt += `Q: ${ex.question}\nA: ${ex.answer}\n`;
    }
  }

  if (projectContext) {
    prompt += `\nProject context:\n${projectContext}\n`;
  }

  prompt += `
Your task: Evaluate whether you have enough information to generate a comprehensive product spec (epics, features, and tasks). Consider:
- Who are the target users?
- What are the core features vs nice-to-haves?
- Are there technical constraints or preferences?
- What does success look like?
- Are there integrations, data models, or workflows to define?

If you need more information, respond with a JSON object:
{ "status": "clarifying", "questions": ["question1", "question2", ...] }
Ask 2-4 focused questions. Don't repeat questions already answered.

If you have enough information, respond with:
{ "status": "ready", "summary": "Brief summary of what you understand the project to be" }

Respond with ONLY the JSON object, no markdown fences or explanation.`;

  return prompt;
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

function buildSpecPrompt(
  context: GuidedContext,
  projectContext: string,
): string {
  let prompt = `You are a product requirements analyst. Create a comprehensive PRD breakdown as a JSON array from the following project specification.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Guidelines:
- Create a complete initial PRD covering all aspects discussed
- Task titles must be specific and actionable (verb-first)
- Every task MUST have a description and acceptanceCriteria
- Assign priority: critical for blocking/foundational, high for core features, medium for enhancements, low for nice-to-haves
- Group related work into epics, break epics into features, features into tasks
- Each task should be a single unit of work completable in one session

Project description:
${context.description}
`;

  if (context.exchanges.length > 0) {
    prompt += "\nClarifications:\n";
    for (const ex of context.exchanges) {
      prompt += `Q: ${ex.question}\nA: ${ex.answer}\n`;
    }
  }

  if (projectContext) {
    prompt += `\nProject context:\n${projectContext}\n`;
  }

  prompt += "\nRespond with ONLY a valid JSON array, no explanation or markdown fences.";

  return prompt;
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
  const effectiveModel = model ?? DEFAULT_MODEL;
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
    const response = await clarify(context, projectContext, effectiveModel);

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
