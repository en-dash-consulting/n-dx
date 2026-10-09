import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSpawnClaude } = vi.hoisted(() => ({ mockSpawnClaude: vi.fn() }));

vi.mock("../../../src/analyze/llm-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/analyze/llm-bridge.js")>();
  return { ...actual, spawnClaude: mockSpawnClaude };
});

import { createTextSpecModel, SPEC_DRAFT_TASK_CLASS } from "../../../src/analyze/spec-draft-reason.js";
import type { SpecQuestion } from "../../../src/migrations/v1-to-v2/spec-pass.js";

const question: SpecQuestion = {
  kind: "spec",
  capability: { id: "f1", title: "Task selection", description: "Picks the next task." },
  history: [{ id: "t1", title: "Add priority ordering", acceptanceCriteria: ["Tasks follow priority"] }],
  codeFiles: ["packages/rex/src/core/next-task.ts"],
  tests: ["packages/rex/tests/unit/core/priority-ordering.test.ts"],
};

const reply = (text: string) => mockSpawnClaude.mockResolvedValueOnce({ text });

describe("text spec drafter", () => {
  beforeEach(() => mockSpawnClaude.mockReset());

  it("asks under the prd.spec task class with only the question's items, code and tests in the prompt", async () => {
    const answer = { statement: "Picks the next task.", criteria: [{ text: "The system shall follow priority.", source: "t1" }] };
    reply(JSON.stringify(answer));
    const { model, draft } = createTextSpecModel("model-x");
    expect(model).toBe("model-x");
    expect(await draft(question)).toEqual(answer);
    const [prompt, sentModel, , route] = mockSpawnClaude.mock.calls[0]!;
    expect(sentModel).toBe("model-x");
    expect(route).toEqual({ taskClass: SPEC_DRAFT_TASK_CLASS });
    for (const text of ["Task selection", "Add priority ordering", "next-task.ts", "priority-ordering.test.ts"]) expect(prompt).toContain(text);
  });

  it("throws on a reply that is not a spec draft", async () => {
    const { draft } = createTextSpecModel("model-x");
    reply("It picks tasks.");
    await expect(draft(question)).rejects.toThrow(/not JSON/);
    reply('{"statement": "x"}');
    await expect(draft(question)).rejects.toThrow(/wrong shape/);
  });
});
