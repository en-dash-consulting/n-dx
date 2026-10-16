import { describe, expect, it } from "vitest";

import type { Capture, SourcePosition } from "../../src/pack.js";
import { callSites, groupCalls, innermostEach } from "../../src/pack-calls.js";

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

  it("keeps each call's captures as call sites, for rules that need positions", () => {
    const [site] = callSites(call(3));
    expect(site?.invocation?.text).toBe('db.Query("s3")');
    expect([site?.receiver?.text, site?.name?.text, site?.arguments.text]).toEqual(["db", "Query", '("s3")']);
    expect(site?.strings.map((s) => s.text)).toEqual(['"s3"']);
  });

  it("does work n log n, not quadratic, in the number of calls", () => {
    const n = 2000;
    const captures = Array.from({ length: n }, (_, i) => call(i + 1)).flat();
    reads = 0;
    const calls = groupCalls(captures);
    expect(calls.every((c, i) => c.strings.length === 1 && c.strings[0]!.text === `"s${i + 1}"`)).toBe(true);
    // Pairing each list or string by scanning every invocation, name or list
    // reads positions at least n² = 4M times, which made a 16k-line Python file
    // take seconds per framework; sorted sweeps and position lookups read about
    // 30 × n log₂ n.
    expect(reads).toBeLessThan(60 * n * Math.log2(n));
  });
});

describe("innermostEach", () => {
  /** Spans on one line: nested, disjoint, sharing a start, and two with the same span. */
  const spans: Array<[string, number, number]> = [
    ["file", 0, 100],
    ["a", 0, 40],
    ["a1", 0, 10],
    ["a2", 12, 40],
    ["a2x", 12, 40],
    ["a2i", 20, 30],
    ["b", 50, 90],
    ["b1", 60, 70],
  ];
  const all = spans.map(([text, from, to]) => capture("x", text, 1, from, to));

  /** The innermost containing owner by scanning, as `innermost` does, optionally skipping a same-span owner. */
  const scan = (owners: readonly Capture[], c: Capture, strict: boolean): string | undefined => {
    let best: Capture | undefined;
    for (const o of owners) {
      const contains = o.start.column <= c.start.column && c.end.column <= o.end.column;
      const same = o.start.column === c.start.column && o.end.column === c.end.column;
      if (!contains || (strict && same)) continue;
      if (best === undefined || (best.start.column <= o.start.column && o.end.column <= best.end.column)) best = o;
    }
    return best?.text;
  };

  it("agrees with a scan for every capture, owners given in any order", () => {
    const owners = [...all].reverse();
    for (const strict of [false, true]) {
      const found = innermostEach(owners, all, strict).map((o) => o?.text);
      expect(found, `strict ${strict}`).toEqual(all.map((c) => scan(owners, c, strict)));
    }
    // Strict: a list entry that is itself a list is not its own owner. Of two owners with one span, the later one.
    expect(innermostEach(all, all, true).map((o) => o?.text)).toEqual([undefined, "file", "a", "a", "a", "a2x", "file", "b"]);
  });

  it("reads positions n log n times, not n × m", () => {
    const n = 4000;
    // n sibling owners, each holding one captured node.
    const owners = Array.from({ length: n }, (_, i) => capture("o", `o${i}`, i + 1, 0, 20));
    const captured = Array.from({ length: n }, (_, i) => capture("c", `c${i}`, i + 1, 5, 10));
    reads = 0;
    const found = innermostEach(owners, captured);
    expect(found.every((o, i) => o?.text === `o${i}`)).toBe(true);
    expect(reads).toBeLessThan(60 * n * Math.log2(n));
  });
});
