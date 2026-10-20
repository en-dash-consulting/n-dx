/**
 * The Spring Boot rules' text helpers on repository input: the results they
 * give, and that they stay linear on the inputs a backtracking regex would not
 * (CodeQL js/polynomial-redos on #788). The adversarial calls run under
 * lang-kit's `callWithinBudget`, so a regression fails here by name instead of
 * hanging the suite.
 */

import { describe, expect, it } from "vitest";

import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../lang-kit/tests/helpers/call-within-budget.js";
import { joinRoutePath, simpleName } from "../../src/spring-boot.js";

const SPRING_BOOT = new URL("../../src/spring-boot.ts", import.meta.url);
const MIB = 1024 * 1024;

describe("simpleName", () => {
  it.each([
    ["RestTemplate", "RestTemplate"],
    ["org.springframework.web.client.RestTemplate", "RestTemplate"],
    ["List<String>", "List"],
    ["Map<String, List<X>>", "Map"],
    ["java.util.Map<String, java.util.List<a.b.X>>", "Map"],
    ["String[]", "String"],
    ["byte [ ] []", "byte"],
    ["List<String>[]", "List"],
    ["Map<K, V> . Entry", "Entry"],
    // First `<` to the last `>`: the greedy cut the regex made, kept as it was.
    ["Outer<A>.Inner<B>", "Outer"],
    ["a.b<", "b<"],
    ["a>b.C", "C"],
    ["x>y<z", "x>y<z"],
    ["", ""],
  ])("%j gives %j", (text, expected) => {
    expect(simpleName(text)).toBe(expected);
  });
});

describe("joinRoutePath", () => {
  it.each([
    ["", "", "/"],
    ["/", "", "/"],
    ["///", "", "/"],
    ["/", "/x", "/x"],
    ["///", "///x", "/x"],
    ["/api//", "//v1/", "/api/v1/"],
    ["api/", "", "/api"],
    ["a//b//", "c", "/a//b/c"],
  ])("%j + %j gives %j", (prefix, path, expected) => {
    expect(joinRoutePath(prefix, path)).toBe(expected);
  });
});

describe("on adversarial repository input", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
  it("simpleName is linear on many `<` with no `>`", async () => {
    const text = "<".repeat(MIB);
    await expect(callWithinBudget<typeof simpleName>(SPRING_BOOT, "simpleName", text)).resolves.toBe(text);
  });

  it("joinRoutePath is linear on many `/` then another character", async () => {
    const prefix = `${"/".repeat(MIB)}x`;
    await expect(callWithinBudget<typeof joinRoutePath>(SPRING_BOOT, "joinRoutePath", prefix, "")).resolves.toBe(prefix);
  });
});
