import { describe, expect, it } from "vitest";
import { fileTable, lineHits } from "../../scripts/coverage-lines.mjs";

const at = (line) => ({ start: { line, column: 0 }, end: { line, column: 10 } });

describe("lineHits", () => {
  it("counts each line by the busiest statement starting on it", () => {
    const hits = lineHits({
      statementMap: { 0: at(3), 1: at(3), 2: at(1), 3: at(7) },
      s: { 0: 2, 1: 9, 2: 1, 3: 0 },
    });
    expect([...hits]).toEqual([[1, 1], [3, 9], [7, 0]]);
  });

  it("treats a statement with no recorded count as never run", () => {
    expect([...lineHits({ statementMap: { 0: at(4) }, s: {} })]).toEqual([[4, 0]]);
  });

  it("keeps a zero-hit line that shares no statement with a hit one", () => {
    const hits = lineHits({ statementMap: { 0: at(2), 1: at(5) }, s: { 0: 0, 1: 4 } });
    expect(hits.get(2)).toBe(0);
    expect(hits.get(5)).toBe(4);
  });
});

describe("fileTable", () => {
  it("totals lines per file with the most missed first", () => {
    const coverage = {
      "/p/src/a.ts": { statementMap: { 0: at(1), 1: at(2) }, s: { 0: 1, 1: 1 } },
      "/p/src/b.ts": { statementMap: { 0: at(1), 1: at(2), 2: at(3) }, s: { 0: 0, 1: 0, 2: 5 } },
    };
    const rows = fileTable(coverage, (p) => p.replace("/p/", ""));
    expect(rows).toEqual([
      { file: "src/b.ts", lines: 3, hit: 1, missed: 2 },
      { file: "src/a.ts", lines: 2, hit: 2, missed: 0 },
    ]);
  });
});
