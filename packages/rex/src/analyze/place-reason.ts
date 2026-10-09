/**
 * Text placement model: the `prd.place` tier of change placement.
 *
 * Fills the {@link PlacementModel} seam of `core/placement.ts` with one call
 * through the configured LLM client. The model picks a capability or
 * constraint from the rules shortlist, declines, or proposes a new node under
 * an area. Validation of a proposal stays in `placeChange`; this module only
 * asks and parses.
 *
 * @module rex/analyze/place-reason
 */

import { z } from "zod";
import type { PromptEnvelope } from "@n-dx/llm-client";
import type { PlacementModel, PlacementProposal } from "../core/placement.js";
import { extractJson } from "./analyze-shared.js";
import { resolveConfiguredModel, spawnClaude } from "./llm-bridge.js";
import { rexPrompt, rexPromptEnvelope, section } from "./prompt-envelope.js";

export const PLACEMENT_TASK_CLASS = "prd.place";

type PlacementInput = Parameters<PlacementModel>[0];

const ResponseSchema = z.union([
  z.object({ pick: z.string().min(1).nullable() }),
  z.object({ propose: z.record(z.string(), z.unknown()) }),
]);

export function buildPlacementEnvelope(input: PlacementInput): PromptEnvelope {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const shortlist = input.shortlist.map((c) => {
    const node = byId.get(c.target);
    return { id: c.target, type: node?.type ?? "capability", title: node?.title ?? c.target, statement: node?.statement, score: c.score, reasons: c.reasons };
  });
  const change = { title: input.change.title, intent: input.change.intent, files: input.change.files };
  return rexPromptEnvelope([
    section(
      "role",
      "You place a change in a product map: which existing capability or constraint does the change work on or amend?",
    ),
    section(
      "input",
      [
        `Change:\n${JSON.stringify(change, null, 2)}`,
        `Shortlist ranked by rules, best first:\n${JSON.stringify(shortlist, null, 2)}`,
        `Areas a new node may sit under:\n${JSON.stringify(input.areas.map((a) => ({ id: a.id, title: a.title })), null, 2)}`,
      ].join("\n\n"),
    ),
    section(
      "output",
      [
        "Respond with JSON only (no markdown wrapper, no prose), one of:",
        '{"pick": "<shortlist id>"}  the change works on or amends that node',
        '{"pick": null}  nothing on the shortlist fits and no new node is warranted',
        '{"propose": {"delta": "added", "type": "capability" | "constraint", "target": "<new-slug>", "under": "<area id>", "title": "<title>", "summary": "<one line>"}}',
        "  only when nothing on the shortlist fits and the change adds a standing part of the product.",
      ].join("\n"),
    ),
  ]);
}

/** The text model seam and the model id it resolves to, for recording in a plan. */
export function createTextPlacementModel(model?: string): { model: string; place: PlacementModel } {
  const resolved = resolveConfiguredModel(model, { taskClass: PLACEMENT_TASK_CLASS });
  const place: PlacementModel = async (input) => {
    const result = await spawnClaude(rexPrompt(buildPlacementEnvelope(input)), resolved, undefined, {
      taskClass: PLACEMENT_TASK_CLASS,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(result.text));
    } catch {
      throw new Error(`placement response is not JSON: ${result.text.slice(0, 300)}`);
    }
    const checked = ResponseSchema.safeParse(parsed);
    if (!checked.success) throw new Error(`placement response has the wrong shape: ${JSON.stringify(parsed).slice(0, 300)}`);
    // placeChange validates a proposal and drops a malformed one with a warning.
    if ("propose" in checked.data) return { propose: checked.data.propose as PlacementProposal };
    return checked.data.pick;
  };
  return { model: resolved, place };
}
