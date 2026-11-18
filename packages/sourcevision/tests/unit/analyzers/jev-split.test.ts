import { describe, it, expect } from "vitest";
import { ClaudeClientError } from "@n-dx/llm-client";
import { askSplittingWhenTooLarge, isJevTooLarge } from "../../../src/analyzers/jev-split.js";

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
});
