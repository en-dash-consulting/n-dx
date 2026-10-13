import { describe, expect, it } from "vitest";

import type { Capture, SourcePosition } from "../../../src/language/pack.js";
import { groupCalls } from "../../../src/language/pack-calls.js";

let reads = 0;

/** A capture on one line whose position reads are counted. */
function capture(name: string, text: string, line: number, from: number, to: number): Capture {
  const start: SourcePosition = { line, column: from };
  const end: SourcePosition = { line, column: to };
  return {
    name,
    nodeType: "x",
    text,
    get start() {
      reads++;
      return start;
    },
    get end() {
      reads++;
      return end;
    },
  };
}

/** `db.Query("s<i>")` on line i, captured as the Go and Java calls queries capture it. */
function call(i: number): Capture[] {
  return [
    capture("call.invocation", `db.Query("s${i}")`, i, 0, 15),
    capture("call.receiver", "db", i, 0, 2),
    capture("call.name", "Query", i, 3, 8),
    capture("call.arguments", `("s${i}")`, i, 8, 15),
    capture("call.string_argument", `"s${i}"`, i, 9, 14),
  ];
}

describe("groupCalls", () => {
  it("pairs each call with its name, receiver and own string arguments", () => {
    const calls = groupCalls([...call(1), ...call(2)]);
    expect(calls).toEqual([
      { callee: "Query", receiver: "db", strings: [{ text: '"s1"', start: { line: 1, column: 9 }, end: { line: 1, column: 14 } }] },
      { callee: "Query", receiver: "db", strings: [{ text: '"s2"', start: { line: 2, column: 9 }, end: { line: 2, column: 14 } }] },
    ]);
  });

  it("does work quadratic, not cubic, in the number of calls", () => {
    const n = 200;
    const captures = Array.from({ length: n }, (_, i) => call(i + 1)).flat();
    reads = 0;
    const calls = groupCalls(captures);
    expect(calls.every((c, i) => c.strings.length === 1 && c.strings[0]!.text === `"s${i + 1}"`)).toBe(true);
    // Cubic pairing (each list scanning every string against every list) reads
    // positions about 8 × n³ = 64M times; the pairing done once per string
    // reads under 60 × n² = 2.4M.
    expect(reads).toBeLessThan(60 * n * n);
  });
});
