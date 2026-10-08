import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSpawnClaude } = vi.hoisted(() => ({ mockSpawnClaude: vi.fn() }));

vi.mock("../../../src/analyze/llm-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/analyze/llm-bridge.js")>();
  return { ...actual, spawnClaude: mockSpawnClaude };
});

import { createTextPlacementModel, PLACEMENT_TASK_CLASS } from "../../../src/analyze/place-reason.js";

const input = {
  change: { title: "Tune selection speed" },
  shortlist: [{ target: "f1", relation: "touches" as const, score: 1, reasons: ["words: selection"] }],
  nodes: [{ id: "f1", title: "Task selection" }],
  areas: [{ id: "e1", title: "Planning" }],
};

const reply = (text: string) => mockSpawnClaude.mockResolvedValueOnce({ text });

describe("text placement model", () => {
  beforeEach(() => mockSpawnClaude.mockReset());

  it("asks under the prd.place task class with the shortlist and areas in the prompt", async () => {
    reply('{"pick": "f1"}');
    const { model, place } = createTextPlacementModel("model-x");
    expect(model).toBe("model-x");
    expect(await place(input)).toBe("f1");
    const [prompt, sentModel, , route] = mockSpawnClaude.mock.calls[0]!;
    expect(sentModel).toBe("model-x");
    expect(route).toEqual({ taskClass: PLACEMENT_TASK_CLASS });
    expect(prompt).toContain("Tune selection speed");
    expect(prompt).toContain("Task selection");
    expect(prompt).toContain("Planning");
  });

  it("returns a decline and a proposal as placeChange expects them", async () => {
    const { place } = createTextPlacementModel("model-x");
    reply("```json\n{\"pick\": null}\n```");
    expect(await place(input)).toBeNull();
    reply('{"propose": {"delta": "added", "type": "capability", "target": "speed", "under": "e1", "title": "Speed", "summary": "s"}}');
    expect(await place(input)).toEqual({ propose: { delta: "added", type: "capability", target: "speed", under: "e1", title: "Speed", summary: "s" } });
  });

  it("throws on a reply that is not a placement", async () => {
    const { place } = createTextPlacementModel("model-x");
    reply("I think f1.");
    await expect(place(input)).rejects.toThrow(/not JSON/);
    reply('{"choice": "f1"}');
    await expect(place(input)).rejects.toThrow(/wrong shape/);
  });
});
