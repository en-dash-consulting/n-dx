/**
 * The Java resolver's dotted-name reader on repository input: the results it
 * gives, that they match the regex implementation it replaced, and that it stays
 * linear where that one did not (CodeQL js/polynomial-redos, alert 73). The
 * adversarial calls run under lang-kit's `callWithinBudget`, so a regression
 * fails here by name instead of hanging the suite.
 */

import { describe, expect, it } from "vitest";

import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../lang-kit/tests/helpers/call-within-budget.js";
import { dottedSegments } from "../../src/java-resolver.js";

const RESOLVER = new URL("../../src/java-resolver.ts", import.meta.url);
const MIB = 1024 * 1024;

/** The implementation before the fix: quadratic on some inputs, the reference for results. */
function regexDottedSegments(text: string): string[] {
  let stripped = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  for (let prev = ""; prev !== stripped; ) {
    prev = stripped;
    stripped = stripped.replace(/<[^<>]*>/g, "");
  }
  return stripped
    .replace(/@[\w$.]+/g, "")
    .replace(/\s+/g, "")
    .split(".")
    .filter((s) => s.length > 0);
}

/** mulberry32: a fixed seed keeps the randomized cases the same on every run. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("dottedSegments", () => {
  it.each([
    ["java.util.Map<K, V>.Entry", ["java", "util", "Map", "Entry"]],
    ["a . b /* c.d */ . e", ["a", "b", "e"]],
    ["a.b // c.d\n.e", ["a", "b", "e"]],
    ["@Nullable java.lang.String", ["java", "lang", "String"]],
    ["Map<String, List<X>>.Entry", ["Map", "Entry"]],
    ["a/*b.c", ["a/*b", "c"]],
    ["/*/x*/y", ["y"]],
    ["a<b<c>d", ["a<bd"]],
    [">a<b>.c", [">a", "c"]],
    ["", []],
  ])("%j gives %j", (text, expected) => {
    expect(dottedSegments(text)).toEqual(expected);
  });

  it("matches the regex implementation on random comment and bracket text", () => {
    const random = seededRandom(73);
    const alphabet = ["<", ">", "/", "*", "\n", "a", "b", ".", " ", "@"];
    for (let n = 0; n < 20_000; n++) {
      const length = Math.floor(random() * 24);
      let text = "";
      for (let i = 0; i < length; i++) text += alphabet[Math.floor(random() * alphabet.length)];
      expect(dottedSegments(text), JSON.stringify(text)).toEqual(regexDottedSegments(text));
    }
  });
});

describe("on adversarial repository input", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
  it("is linear on many unterminated `/*`", async () => {
    const text = "/*" + "a/*".repeat(MIB / 3);
    await expect(callWithinBudget<typeof dottedSegments>(RESOLVER, "dottedSegments", text)).resolves.toEqual([text]);
  });

  it("is linear on deeply nested generics", async () => {
    const text = "a" + "<".repeat(MIB / 2) + ">".repeat(MIB / 2) + ".b";
    await expect(callWithinBudget<typeof dottedSegments>(RESOLVER, "dottedSegments", text)).resolves.toEqual(["a", "b"]);
  });
});
