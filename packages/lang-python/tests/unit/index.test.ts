import { describe, expect, it } from "vitest";

describe("@n-dx/lang-python barrel", () => {
  it("loads", async () => {
    await expect(import("../../src/index.js")).resolves.toBeDefined();
  });
});
