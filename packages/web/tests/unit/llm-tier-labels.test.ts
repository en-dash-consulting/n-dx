import { describe, it, expect } from "vitest";
import { DEFAULT_ROUTES } from "@n-dx/llm-client";
import { TASK_CLASS_LABELS } from "../../src/server/llm-tiers.js";

describe("task class labels", () => {
  it("covers every DEFAULT_ROUTES key", () => {
    const missing = Object.keys(DEFAULT_ROUTES).filter((k) => !TASK_CLASS_LABELS[k]);
    expect(missing).toEqual([]);
  });

  it("has no label for a class DEFAULT_ROUTES no longer routes", () => {
    const stale = Object.keys(TASK_CLASS_LABELS).filter((k) => !(k in DEFAULT_ROUTES));
    expect(stale).toEqual([]);
  });
});
