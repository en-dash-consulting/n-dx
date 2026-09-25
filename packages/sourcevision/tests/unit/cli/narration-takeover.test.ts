import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carryNarration, takeOverNarration } from "../../../src/cli/commands/narrate.js";
import type { NarrationState } from "../../../src/schema/index.js";

let dir: string;

function writeNarration(narration: NarrationState | undefined): void {
  writeFileSync(
    join(dir, ".sourcevision", "manifest.json"),
    JSON.stringify({ schemaVersion: "1.0.0", toolVersion: "0", analyzedAt: "t", targetPath: dir, modules: {}, ...(narration ? { narration } : {}) }),
  );
}

function readNarration(): NarrationState | undefined {
  return JSON.parse(readFileSync(join(dir, ".sourcevision", "manifest.json"), "utf-8")).narration;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sv-narration-"));
  mkdirSync(join(dir, ".sourcevision"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("takeOverNarration", () => {
  it("returns nothing when there is no narration or it finished", () => {
    writeNarration(undefined);
    expect(takeOverNarration(dir)).toEqual({ zones: [], names: [] });
    writeNarration({ status: "done", zones: ["a"], startedAt: "t" });
    expect(takeOverNarration(dir)).toEqual({ zones: [], names: [] });
  });

  it("stops a live narrator, records it superseded, and returns its work", () => {
    writeNarration({ status: "pending", zones: ["a"], names: ["b"], startedAt: "t", pid: 4242 });
    const kill = vi.fn();
    const taken = takeOverNarration(dir, { isAlive: () => true, kill });
    expect(kill).toHaveBeenCalledWith(4242);
    expect(taken).toEqual({ zones: ["a"], names: ["b"], stopped: 4242 });
    expect(readNarration()).toMatchObject({ status: "failed", reason: "superseded by a newer analysis" });
    expect(readNarration()?.finishedAt).toBeTruthy();
  });

  it("records a pending narration whose process is gone as exited, and returns its work", () => {
    writeNarration({ status: "pending", zones: ["a"], startedAt: "t", pid: 4242 });
    const kill = vi.fn();
    const taken = takeOverNarration(dir, { isAlive: () => false, kill });
    expect(kill).not.toHaveBeenCalled();
    expect(taken).toEqual({ zones: ["a"], names: [] });
    expect(readNarration()).toMatchObject({ status: "failed", reason: "narrator exited without finishing" });
  });

  it("retries a superseded or unspawned narration but not a failed narration call", () => {
    writeNarration({ status: "failed", zones: ["a"], startedAt: "t", reason: "superseded by a newer analysis" });
    expect(takeOverNarration(dir).zones).toEqual(["a"]);
    writeNarration({ status: "failed", zones: ["a"], startedAt: "t", reason: "could not spawn narrator: EACCES" });
    expect(takeOverNarration(dir).zones).toEqual(["a"]);
    writeNarration({ status: "failed", zones: ["a"], startedAt: "t", reason: "narration call failed or returned nothing parsable" });
    expect(takeOverNarration(dir).zones).toEqual([]);
  });
});

describe("carryNarration", () => {
  it("adds carried ids that still exist and counts the ones that do not", () => {
    const merged = carryNarration(
      { zones: ["a", "gone"], names: ["b", "c"] },
      { zones: ["x"], names: ["c"] },
      new Set(["a", "b", "c", "x"]),
    );
    expect(merged.zones.sort()).toEqual(["a", "x"]);
    expect(merged.names.sort()).toEqual(["b", "c"]);
    expect(merged.carried).toBe(2);
    expect(merged.dropped).toBe(1);
  });
});
