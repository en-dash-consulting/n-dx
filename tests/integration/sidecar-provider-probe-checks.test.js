import { expect, it } from "vitest";
import { shellCheckPassed, threadContinued } from "../../packages/web/scripts/sidecar-provider-probe-checks.mjs";

it("requires the current call's result and a real thread id for host evidence", () => {
  const prior = { type: "function_call_output", call_id: "old", output: "PR9_PROVIDER_HEADERS_HIDDEN" };
  expect(shellCheckPassed([prior, { ...prior, call_id: "new", output: "exit 1" }], "new")).toBe(false);
  expect(shellCheckPassed([{ ...prior, call_id: "new" }], "new")).toBe(true);
  expect(threadContinued(undefined, undefined)).toBe(false);
  expect(threadContinued("another", "first")).toBe(false);
  expect(threadContinued("first", "first")).toBe(true);
});
