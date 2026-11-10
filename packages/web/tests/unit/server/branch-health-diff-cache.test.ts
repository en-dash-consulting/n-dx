/**
 * @see packages/web/src/server/branch-health/diff-cache.ts
 */

import { describe, it, expect } from "vitest";
import { WorktreeDiffCache } from "../../../src/server/branch-health/diff-cache.js";

/** A reader that counts calls and answers `[tip]`. */
function reader(): { read: (tip: string) => () => Promise<string[]>; calls: () => number } {
  let calls = 0;
  return {
    read: (tip) => async () => {
      calls++;
      return [tip];
    },
    calls: () => calls,
  };
}

describe("WorktreeDiffCache", () => {
  it("reads a (base, tip) pair once and keys a moved base or tip apart", async () => {
    const cache = new WorktreeDiffCache();
    const { read, calls } = reader();

    expect(await cache.changed("b1", "t1", read("t1"))).toEqual(["t1"]);
    expect(await cache.changed("b1", "t1", read("t1"))).toEqual(["t1"]);
    expect(calls()).toBe(1);

    expect(await cache.changed("b1", "t2", read("t2"))).toEqual(["t2"]);
    expect(await cache.changed("b2", "t1", read("t1-new-base"))).toEqual(["t1-new-base"]);
    expect(calls()).toBe(3);
  });

  it("drops the least recently used entry past its cap", async () => {
    const cache = new WorktreeDiffCache(2);
    const { read, calls } = reader();
    await cache.changed("b", "t1", read("t1"));
    await cache.changed("b", "t2", read("t2"));
    await cache.changed("b", "t1", read("t1")); // t1 is now the most recent
    await cache.changed("b", "t3", read("t3")); // evicts t2
    expect(cache.size).toBe(2);
    expect(calls()).toBe(3);

    await cache.changed("b", "t1", read("t1"));
    expect(calls()).toBe(3);
    await cache.changed("b", "t2", read("t2"));
    expect(calls()).toBe(4);
  });

  it("does not keep a failed read", async () => {
    const cache = new WorktreeDiffCache();
    let calls = 0;
    const failing = async () => {
      calls++;
      return null;
    };
    expect(await cache.changed("b", "t", failing)).toBeNull();
    expect(cache.size).toBe(0);
    await cache.changed("b", "t", failing);
    expect(calls).toBe(2);

    await expect(cache.changed("b", "t", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(cache.size).toBe(0);
  });
});
