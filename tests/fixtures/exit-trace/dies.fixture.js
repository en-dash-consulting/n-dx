import { it, expect } from "vitest";

it("passes, then the worker exits", async () => {
  expect(1).toBe(1);
  setTimeout(() => process.exit(1), 0);
  // Stay open until the exit timer has fired (timers run in order), so vitest
  // reports the error it raises instead of sometimes finishing the run first.
  await new Promise((resolve) => setTimeout(resolve, 50));
});
