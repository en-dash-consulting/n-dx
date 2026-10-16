import { describe, it, expect } from "vitest";
import { withoutLevel } from "../../../src/core/layer-projection.js";

describe("withoutLevel", () => {
  it("drops level at every depth and keeps the rest", () => {
    const node = {
      id: "c",
      type: "change",
      level: "epic",
      children: [{ id: "t", type: "task", level: "task", children: [{ id: "s", type: "subtask", level: "subtask" }] }],
    };
    expect(withoutLevel(node)).toEqual({
      id: "c",
      type: "change",
      children: [{ id: "t", type: "task", children: [{ id: "s", type: "subtask" }] }],
    });
  });

  it("leaves a node without children childless", () => {
    expect(withoutLevel({ id: "x", level: "task" })).toEqual({ id: "x" });
  });
});
