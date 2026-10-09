/**
 * A mock Jev judge that answers every question in a request.
 *
 * `answers` overrides by question id; otherwise a choice picks its first
 * option at confidence 1 and a noul answers yes with probability 1, so an
 * unconfigured question never lowers an entry's confidence.
 */

import { vi } from "vitest";
import type { JevAnswer, JevResponse } from "@n-dx/llm-client";
import type { PlacementJudge } from "../../src/core/placement-policy.js";

export const choiceAnswer = (choice: string, confidence: number): JevAnswer => ({
  type: "choice",
  choice,
  confidence,
  probabilities: { [choice]: confidence },
});

export const noulAnswer = (noul: number): JevAnswer => ({ type: "noul", noul });

export function mockJudge(answers: Record<string, JevAnswer> = {}, model = "jev-1.0.0") {
  return vi.fn<PlacementJudge>(async (request): Promise<JevResponse> => ({
    model,
    answers: Object.fromEntries(
      Object.entries(request.questions).map(([id, q]): [string, JevAnswer] => {
        if (Object.hasOwn(answers, id)) return [id, answers[id]!];
        if (q.type === "choice") return [id, choiceAnswer(Object.keys(q.criteria)[0]!, 1)];
        if (q.type === "noul") return [id, noulAnswer(1)];
        throw new Error(`mock judge cannot answer a ${q.type} question`);
      }),
    ),
  }));
}
