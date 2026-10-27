import { describe, expect, it } from "vitest";

import { BOUNDED_TEST_TIMEOUT_MS, CALL_BUDGET_MS, callWithinBudget } from "../helpers/call-within-budget.js";

const SUBJECTS = new URL("../fixtures/budget-subjects.mjs", import.meta.url);

// The linearity tests rely on this helper to turn a hang into a named failure;
// if it stopped terminating an overrun, they would hang again and pass otherwise.
describe("callWithinBudget", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
  it("terminates a call that never returns and rejects naming the overrun", async () => {
    await expect(callWithinBudget<() => never>(SUBJECTS, "spinForever")).rejects.toThrow(
      `spinForever: the call did not finish within ${CALL_BUDGET_MS} ms; worker terminated`,
    );
  });

  it("rejects with the worker's error when the call throws", async () => {
    await expect(callWithinBudget<(m: string) => never>(SUBJECTS, "fail", "boom")).rejects.toThrow(
      /fail threw in the worker:\nError: boom/,
    );
  });

  it("rejects when the module has no such export", async () => {
    await expect(callWithinBudget<() => void>(SUBJECTS, "missing")).rejects.toThrow(/has no exported function missing/);
  });
});
