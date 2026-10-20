/**
 * The env-key split and the prefix join on repository input: the results they
 * give, and that they stay linear on the inputs a backtracking regex would not
 * (CodeQL js/polynomial-redos on #796). The adversarial calls run under
 * lang-kit's `callWithinBudget`, so a regression fails here by name instead of
 * hanging the suite.
 */

import { describe, expect, it } from "vitest";

import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../lang-kit/tests/helpers/call-within-budget.js";
import { applied } from "../../src/python-clients.js";
import { joinPrefix } from "../../src/python-web.js";

const CLIENTS = new URL("../../src/python-clients.ts", import.meta.url);
const WEB = new URL("../../src/python-web.ts", import.meta.url);
const MIB = 1024 * 1024;

// Every expected value below is what the regexes `envKey` used before gave:
// /^([A-Za-z_][\w.\s]*?)\s*\[([\s\S]*)\]$/ and its `(`…`)` twin.
describe("applied", () => {
  it.each([
    ['os.environ["X"]', "[", { name: "os.environ", inner: '"X"' }],
    ['os.environ .get ( "X" )', "(", { name: "os.environ .get", inner: ' "X" ' }],
    ['os . getenv("X")', "(", { name: "os . getenv", inner: '"X"' }],
    ['os.getenv("X", "d")', "(", { name: "os.getenv", inner: '"X", "d"' }],
    ["os.environ[key]", "[", { name: "os.environ", inner: "key" }],
    ["os.getenv(f(x))", "(", { name: "os.getenv", inner: "f(x)" }],
    ["os.environ[]", "[", { name: "os.environ", inner: "" }],
    ['os.environ["a"]["b"]', "[", { name: "os.environ", inner: '"a"]["b"' }],
    ['os.environ["X"', "[", undefined],
    ['os.environ"X"]', "[", undefined],
    ['os.getenv("X") + y', "(", undefined],
    ['f(a)(b)', "(", { name: "f", inner: "a)(b" }],
    ['1os.getenv("X")', "(", undefined],
    [' os.getenv("X")', "(", undefined],
    ['os-x.getenv("X")', "(", undefined],
    ['os.environ\n\t["X"]', "[", { name: "os.environ", inner: '"X"' }],
    ["[]", "[", undefined],
    ["", "(", undefined],
  ] as const)("%j at %j gives %j", (text, open, expected) => {
    expect(applied(text, open)).toEqual(expected);
  });
});

describe("joinPrefix", () => {
  it.each([
    ["/api", "items", "/api/items"],
    ["/api///", "//items", "/api/items"],
    ["///", "x", "/x"],
    ["/", "/", "/"],
    ["a//b//", "c", "a//b/c"],
    ["/api/", "", "/api/"],
    ["", "/x/", "/x/"],
  ])("%j + %j gives %j", (prefix, path, expected) => {
    expect(joinPrefix(prefix, path)).toBe(expected);
  });
});

describe("on adversarial repository input", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
  it("applied is linear on a name followed by many spaces and no bracket", async () => {
    const text = `a${" ".repeat(MIB)}`;
    await expect(callWithinBudget<typeof applied>(CLIENTS, "applied", text, "[")).resolves.toBeUndefined();
    await expect(callWithinBudget<typeof applied>(CLIENTS, "applied", text, "(")).resolves.toBeUndefined();
  });

  it("applied is linear on a name followed by many spaces before the bracket", async () => {
    const text = `a${" ".repeat(MIB)}(x)`;
    await expect(callWithinBudget<typeof applied>(CLIENTS, "applied", text, "(")).resolves.toEqual({ name: "a", inner: "x" });
  });

  it("joinPrefix is linear on many `/` then another character", async () => {
    const prefix = `${"/".repeat(MIB)}x`;
    await expect(callWithinBudget<typeof joinPrefix>(WEB, "joinPrefix", prefix, "y")).resolves.toBe(`${prefix}/y`);
  });
});
