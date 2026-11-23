import { describe, expect, it } from "vitest";

import { normalizeFlagName } from "../../src/pack-contract.js";
import { trimChar, trimLeading, trimTrailing } from "../../src/text-trim.js";
import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../helpers/call-within-budget.js";

const TEXT_TRIM = new URL("../../src/text-trim.ts", import.meta.url);
const PACK_CONTRACT = new URL("../../src/pack-contract.ts", import.meta.url);

describe("trimTrailing / trimLeading / trimChar", () => {
  it("drops the run of one character at the end, the start or both", () => {
    expect(trimTrailing("a/b//", "/")).toBe("a/b");
    expect(trimTrailing("///", "/")).toBe("");
    expect(trimTrailing("a/b", "/")).toBe("a/b");
    expect(trimLeading("__a_b", "_")).toBe("a_b");
    expect(trimChar("__a_b__", "_")).toBe("a_b");
    expect(trimChar("", "_")).toBe("");
  });

  // CodeQL js/polynomial-redos #125/#126/#130: /\/+$/ on many `/` then another character.
  it(
    "runs in linear time on a long run of the character followed by another",
    async () => {
      // The regex took ~4.6 s at 100,000, under the call budget; at 300,000 it takes ~40 s.
      const text = `${"/".repeat(300_000)}a`;
      expect(await callWithinBudget<typeof trimTrailing>(TEXT_TRIM, "trimTrailing", text, "/")).toBe(text);
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );
});

describe("normalizeFlagName on repository input", () => {
  // CodeQL js/polynomial-redos #124: /^_+|_+$/g on many `_` then another character.
  it(
    "runs in linear time on a long run of separators",
    async () => {
      const name = `${"_".repeat(300_000)}x${"_".repeat(300_000)}y`;
      expect(await callWithinBudget<typeof normalizeFlagName>(PACK_CONTRACT, "normalizeFlagName", name)).toBe("x_y");
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );
});
