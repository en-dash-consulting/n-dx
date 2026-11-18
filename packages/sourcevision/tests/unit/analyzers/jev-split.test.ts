import { describe, it, expect, afterEach } from "vitest";
import { ClaudeClientError } from "@n-dx/llm-client";
import {
  askSplittingWhenTooLarge,
  isJevTooLarge,
  JEV_REQUEST_BYTE_CEILING,
  jevRequestByteCeiling,
  packBySize,
  setJevRequestByteCeiling,
} from "../../../src/analyzers/jev-split.js";

const tooLarge = () =>
  new ClaudeClientError('TypeSafe returned 400: {"detail":{"error_type":"max_tokens_exceeded"}}', "unknown", false);

describe("isJevTooLarge", () => {
  it("recognises TypeSafe's max_tokens_exceeded refusal and nothing else", () => {
    expect(isJevTooLarge(tooLarge())).toBe(true);
    expect(isJevTooLarge(new ClaudeClientError("TypeSafe returned 400: bad request", "unknown", false))).toBe(false);
    expect(isJevTooLarge(new Error("max_tokens_exceeded"))).toBe(false);
  });
});

describe("askSplittingWhenTooLarge", () => {
  it("asks once when the request fits", async () => {
    const asked: Array<[string[], number]> = [];
    const left = await askSplittingWhenTooLarge(["a", "b", "c"], async (slice, offset) => {
      asked.push([slice, offset]);
    });
    expect(asked).toEqual([[["a", "b", "c"], 0]]);
    expect(left).toEqual([]);
  });

  it("halves a refused range, first half first and one longer when odd, with offsets into the input", async () => {
    const asked: Array<[string[], number]> = [];
    const left = await askSplittingWhenTooLarge(["a", "b", "c", "d", "e"], async (slice, offset) => {
      asked.push([slice, offset]);
      if (slice.length > 2) throw tooLarge();
    });
    expect(asked).toEqual([
      [["a", "b", "c", "d", "e"], 0],
      [["a", "b", "c"], 0],
      [["a", "b"], 0],
      [["c"], 2],
      [["d", "e"], 3],
    ]);
    expect(left).toEqual([]);
  });

  it("returns an item too large on its own and still asks about the rest", async () => {
    const asked: string[][] = [];
    const left = await askSplittingWhenTooLarge(["a", "b", "c"], async (slice) => {
      asked.push(slice);
      if (slice.includes("b")) throw tooLarge();
    });
    expect(left).toEqual(["b"]);
    expect(asked).toEqual([["a", "b", "c"], ["a", "b"], ["a"], ["b"], ["c"]]);
  });

  it("propagates any other error without splitting", async () => {
    let calls = 0;
    const failure = new ClaudeClientError("TypeSafe returned 400: bad request", "unknown", false);
    await expect(askSplittingWhenTooLarge(["a", "b"], async () => {
      calls++;
      throw failure;
    })).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it("makes no request for no items", async () => {
    let calls = 0;
    expect(await askSplittingWhenTooLarge([], async () => { calls++; })).toEqual([]);
    expect(calls).toBe(0);
  });

  it("asks a lone refused item again at trim levels 1, 2, … until one is answered", async () => {
    const asked: string[][] = [];
    const left = await askSplittingWhenTooLarge(
      ["a", "big", "c"],
      async (slice) => {
        asked.push(slice);
        if (slice.some((s) => s.startsWith("big") && s !== "big@2")) throw tooLarge();
      },
      (item, level) => `${item}@${level}`,
    );
    expect(left).toEqual([]);
    expect(asked).toEqual([["a", "big", "c"], ["a", "big"], ["a"], ["big"], ["big@1"], ["big@2"], ["c"]]);
  });

  it("leaves an item out only after trim returns undefined, never trimming one that fits", async () => {
    const asked: string[][] = [];
    const left = await askSplittingWhenTooLarge(
      ["a", "big"],
      async (slice) => {
        asked.push(slice);
        if (slice.some((s) => s.startsWith("big"))) throw tooLarge();
      },
      (item, level) => (level > 2 ? undefined : `${item}@${level}`),
    );
    expect(left).toEqual(["big"]);
    expect(asked).toEqual([["a", "big"], ["a"], ["big"], ["big@1"], ["big@2"]]);
  });

  it("propagates another error from a trimmed request", async () => {
    const failure = new ClaudeClientError("TypeSafe returned 400: bad request", "unknown", false);
    await expect(askSplittingWhenTooLarge(
      ["big"],
      async (slice) => {
        throw slice[0] === "big" ? tooLarge() : failure;
      },
      (item, level) => `${item}@${level}`,
    )).rejects.toBe(failure);
  });
});

describe("packBySize", () => {
  const size = (s: string) => s.length;

  it("keeps order and puts everything in one chunk when it fits", () => {
    expect(packBySize(["aa", "bb", "cc"], size, 10)).toEqual([["aa", "bb", "cc"]]);
  });

  it("keeps each chunk's summed size at or under the ceiling", () => {
    expect(packBySize(["aaaa", "bbbb", "cc", "dddddd"], size, 10)).toEqual([["aaaa", "bbbb", "cc"], ["dddddd"]]);
  });

  it("caps each chunk at the count", () => {
    expect(packBySize(["a", "b", "c", "d", "e"], size, 100, { maxCount: 2 })).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("gives an item over the ceiling a chunk of its own", () => {
    expect(packBySize(["aa", "x".repeat(20), "bb"], size, 10)).toEqual([["aa"], ["x".repeat(20)], ["bb"]]);
  });

  it("counts shared state once per chunk", () => {
    // Each item is 1 byte and needs its zone's 4 bytes; a zone is carried once per chunk.
    const zoneOf = (s: string): Array<readonly [string, number]> => [[s[0], 4]];
    const chunks = packBySize(["a1", "a2", "a3", "b1", "b2"], () => 1, 8, { shared: zoneOf });
    // a1+a2+a3 = 3 + 4 (zone a once) = 7; b1 would add 1 + 4 = 12 > 8.
    expect(chunks).toEqual([["a1", "a2", "a3"], ["b1", "b2"]]);
  });

  it("counts a shared key again in the next chunk", () => {
    const chunks = packBySize(["a1", "a2", "a3"], () => 3, 8, { shared: () => [["a", 4] as const] });
    expect(chunks).toEqual([["a1"], ["a2"], ["a3"]]);
  });

  it("returns no chunks for no items", () => {
    expect(packBySize([], size, 10)).toEqual([]);
  });
});

describe("jevRequestByteCeiling", () => {
  afterEach(() => setJevRequestByteCeiling(undefined));

  it("is the default until a project overrides it", () => {
    expect(jevRequestByteCeiling()).toBe(JEV_REQUEST_BYTE_CEILING);
    setJevRequestByteCeiling(5000);
    expect(jevRequestByteCeiling()).toBe(5000);
    setJevRequestByteCeiling(undefined);
    expect(jevRequestByteCeiling()).toBe(JEV_REQUEST_BYTE_CEILING);
  });
});
