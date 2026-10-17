import { describe, expect, it } from "vitest";

// The helpers behind scripts/java-scip-compare.mjs (a manual measurement tool).
import { compareEdges, edgeKey, proposeThreshold, readScipDocuments, scipEdges } from "../../../scripts/java-scip.mjs";

const varint = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};
const lenField = (field: number, bytes: number[] | Buffer): number[] => [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
const str = (field: number, s: string): number[] => lenField(field, Buffer.from(s));
const occurrence = (symbol: string, roles: number): number[] => [
  ...lenField(1, [0, 0, 1]), // packed range, ignored
  ...str(2, symbol),
  ...varint(3 * 8),
  ...varint(roles),
];
const document = (path: string, occs: number[][]): number[] =>
  lenField(2, [...str(1, path), ...occs.flatMap((o) => lenField(2, o)), ...str(4, "Java")]);
const index = (docs: number[][]): Buffer => Buffer.from([...lenField(1, str(1, "metadata")), ...docs.flat()]);

const A = "maven . . 1 com/x/A#";
const B = "maven . . 1 com/x/B#";

describe("readScipDocuments / scipEdges", () => {
  const buf = index([
    document("src/A.java", [occurrence(A, 1), occurrence(B, 0), occurrence("maven . . 1 com/x/B#run().", 0), occurrence("local 3", 0), occurrence("maven . . 1 java/lang/String#", 0)]),
    document("src/B.java", [occurrence(B, 1), occurrence(B, 0), occurrence(A, 0)]),
  ]);

  it("decodes paths, symbols and the definition role", () => {
    const docs = readScipDocuments(buf);
    expect(docs.map((d) => d.path)).toEqual(["src/A.java", "src/B.java"]);
    expect(docs[0]!.occurrences[0]).toEqual({ symbol: A, definition: true });
    expect(docs[0]!.occurrences[1]).toEqual({ symbol: B, definition: false });
  });

  it("keeps cross-file type references inside the repository only", () => {
    const edges = scipEdges(readScipDocuments(buf), ["src/A.java", "src/B.java"]);
    expect([...edges].sort()).toEqual([edgeKey("src/A.java", "src/B.java"), edgeKey("src/B.java", "src/A.java")]);
  });

  it("rejects a truncated buffer", () => {
    expect(() => readScipDocuments(buf.subarray(0, buf.length - 3))).toThrow();
  });
});

describe("compareEdges", () => {
  it("scores precision and recall and groups the unmatched edges", () => {
    const ab = edgeKey("p/A.java", "p/B.java");
    const ac = edgeKey("p/A.java", "q/C.java");
    const ad = edgeKey("p/A.java", "p/D.java");
    const result = compareEdges(new Set([ab, ad]), new Set([ab, ac]));
    expect(result).toMatchObject({ resolver: 2, scip: 2, matched: 1, precision: 0.5, recall: 0.5 });
    expect(result.extra.byKind).toEqual({ "same-directory": 1 });
    expect(result.missed.byKind).toEqual({ "cross-directory": 1 });
    expect(result.missed.topTargets[0]).toEqual({ target: "q/C.java", count: 1, sampleFrom: "p/A.java" });
  });

  it("does not divide by zero on empty sets", () => {
    expect(compareEdges(new Set(), new Set())).toMatchObject({ precision: 0, recall: 0 });
  });
});

describe("proposeThreshold", () => {
  it("takes the lowest value less the margin, rounded down", () => {
    expect(proposeThreshold([0.97, 0.915])).toBe(0.89);
    expect(proposeThreshold([])).toBeUndefined();
  });
});
