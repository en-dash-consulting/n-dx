import { describe, it, expect } from "vitest";
import {
  RESHAPE_FEW_SHOT,
  parseReshapeResponse,
} from "../../../src/analyze/reshape-reason.js";

const REQUIRED_ACTIONS = [
  "merge",
  "update",
  "reparent",
  "obsolete",
  "split",
] as const;

describe("RESHAPE_FEW_SHOT", () => {
  it("contains a schema-valid example for every action type", () => {
    const start = RESHAPE_FEW_SHOT.indexOf("[");
    expect(start, "JSON array not found in few-shot prompt").toBeGreaterThan(-1);
    const json = RESHAPE_FEW_SHOT.slice(start);

    const proposals = parseReshapeResponse(json);
    const seenActions = new Set(proposals.map((p) => p.action.action));

    const missing = REQUIRED_ACTIONS.filter((a) => !seenActions.has(a));
    expect(missing, `few-shot is missing examples for: ${missing.join(", ")}`).toEqual([]);
  });
});
