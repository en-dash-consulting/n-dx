/**
 * Text spec drafter: the `prd.spec` tier of the migration plan's spec pass.
 *
 * Fills the {@link SpecModel} seam of `migrations/v1-to-v2/spec-pass.ts` with
 * one call through the configured LLM client. The model restates a
 * capability in present tense from its own item and applied history only.
 * This module asks and parses; the spec pass checks every citation.
 *
 * @module rex/analyze/spec-draft-reason
 */

import { z } from "zod";
import type { PromptEnvelope } from "@n-dx/llm-client";
import type { SpecAnswer, SpecModel, SpecQuestion } from "../migrations/v1-to-v2/spec-pass.js";
import { extractJson } from "./analyze-shared.js";
import { resolveConfiguredModel, spawnClaude } from "./llm-bridge.js";
import { rexPrompt, rexPromptEnvelope, section } from "./prompt-envelope.js";

export const SPEC_DRAFT_TASK_CLASS = "prd.spec";

const ResponseSchema = z
  .object({
    statement: z.string().nullable(),
    criteria: z.array(
      z.object({ text: z.string(), source: z.string().optional(), tests: z.array(z.string()).optional() }),
    ),
  });

export function buildSpecDraftEnvelope(question: SpecQuestion): PromptEnvelope {
  const { capability, history, codeFiles, tests } = question;
  return rexPromptEnvelope([
    section(
      "role",
      "You write the standing spec of one capability of a product: what it does now, in present tense, as a reader of the product would check it.",
    ),
    section(
      "input-rules",
      [
        "Use only the items below. Do not add a requirement none of them states.",
        "The statement is one present-tense sentence about what the product does, not about work done on it.",
        "Each criterion states one behaviour, in EARS form where it fits (\"When …, the system shall …\" or \"The system shall …\").",
        "Each criterion cites the id of the item it came from as source. Cite only ids listed below.",
        "Name the actor and the behaviour. Never open a criterion with \"The system shall ensure that\"; write \"The system shall keep …\" or name the actor (\"The scheduler shall …\").",
        "Leave out criteria that record a decision (\"X is justified or relocated\"), a documentation edit (a docstring or comment describes …) or a process step: tests pass, docs updated, changeset added, build or review done.",
        "Cite a test only from the tests listed, and only when it checks that criterion.",
      ].join("\n"),
    ),
    section(
      "input",
      [
        `Capability:\n${JSON.stringify(capability, null, 2)}`,
        `Applied history, completed changes on it:\n${JSON.stringify(history, null, 2)}`,
        `Code files:\n${JSON.stringify(codeFiles, null, 2)}`,
        `Tests:\n${JSON.stringify(tests, null, 2)}`,
      ].join("\n\n"),
    ),
    section(
      "output",
      [
        "Respond with JSON only (no markdown wrapper, no prose):",
        '{"statement": "<sentence>" | null, "criteria": [{"text": "<criterion>", "source": "<item id>", "tests": ["<test path>"]}]}',
        "statement is null when the items do not say what the product does.",
      ].join("\n"),
    ),
  ]);
}

/** The text spec drafter and the model id it resolves to, for recording in a plan. */
export function createTextSpecModel(model?: string): { model: string; draft: SpecModel } {
  const resolved = resolveConfiguredModel(model, { taskClass: SPEC_DRAFT_TASK_CLASS });
  const draft: SpecModel = async (question) => {
    const result = await spawnClaude(rexPrompt(buildSpecDraftEnvelope(question)), resolved, undefined, {
      taskClass: SPEC_DRAFT_TASK_CLASS,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(result.text));
    } catch {
      throw new Error(`spec draft response is not JSON: ${result.text.slice(0, 300)}`);
    }
    const checked = ResponseSchema.safeParse(parsed);
    if (!checked.success) throw new Error(`spec draft response has the wrong shape: ${JSON.stringify(parsed).slice(0, 300)}`);
    return checked.data as SpecAnswer;
  };
  return { model: resolved, draft };
}
