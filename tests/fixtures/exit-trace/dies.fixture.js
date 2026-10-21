import { it, expect } from "vitest";

it("passes, then the worker exits", () => {
  expect(1).toBe(1);
  setTimeout(() => process.exit(1), 0);
});
