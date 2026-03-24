import { describe, it, expect } from "vitest";
import { parseReshapeResponse } from "../../../src/analyze/reshape-reason.js";

describe("parseReshapeResponse", () => {
  it("parses a valid array of actions", () => {
    const raw = JSON.stringify([
      { action: "merge", survivorId: "a", mergedIds: ["b"], reason: "duplicate" },
    ]);
    const result = parseReshapeResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].action.action).toBe("merge");
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseReshapeResponse("[]")).toEqual([]);
  });

  it("handles single object instead of array", () => {
    const raw = JSON.stringify(
      { action: "update", itemId: "x", updates: { title: "New" }, reason: "clarity" },
    );
    const result = parseReshapeResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].action.action).toBe("update");
  });

  it("normalizes common action type aliases", () => {
    const raw = JSON.stringify([
      { action: "delete", itemId: "x", reason: "no longer needed" },
    ]);
    const result = parseReshapeResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].action.action).toBe("obsolete");
  });

  it("normalizes move to reparent", () => {
    const raw = JSON.stringify([
      { action: "move", itemId: "x", newParentId: "y", reason: "wrong parent" },
    ]);
    const result = parseReshapeResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].action.action).toBe("reparent");
  });

  it("skips invalid items in lenient mode and keeps valid ones", () => {
    const raw = JSON.stringify([
      { action: "merge", survivorId: "a", mergedIds: ["b"], reason: "dup" },
      { action: "bogus_action", foo: "bar" },
      { action: "update", itemId: "x", updates: { title: "New" }, reason: "fix" },
    ]);
    const result = parseReshapeResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].action.action).toBe("merge");
    expect(result[1].action.action).toBe("update");
  });

  it("extracts JSON from markdown fences", () => {
    const raw = `Here are my proposals:\n\`\`\`json\n[{"action":"obsolete","itemId":"x","reason":"done"}]\n\`\`\``;
    const result = parseReshapeResponse(raw);
    expect(result).toHaveLength(1);
  });

  it("throws with descriptive error when all items are invalid", () => {
    const raw = JSON.stringify([{ bad: "data" }]);
    expect(() => parseReshapeResponse(raw)).toThrow(/failed validation/);
  });

  it("throws when response is pure prose", () => {
    expect(() => parseReshapeResponse("I think the PRD looks great!")).toThrow();
  });

  it("repairs truncated JSON", () => {
    const raw = '[{"action":"merge","survivorId":"a","mergedIds":["b"],"reason":"dup"';
    const result = parseReshapeResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].action.action).toBe("merge");
  });
});
