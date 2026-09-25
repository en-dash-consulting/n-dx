import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJSON,
  referencedPaths,
  resolvePath,
  judgmentKey,
  configureJudgmentCache,
  isJudgmentCacheConfigured,
  lookupJudgments,
  storeJudgments,
  JUDGMENT_CACHE_FILE,
} from "../../../src/analyzers/judgment-cache.js";
import { choice, noul } from "../../../src/analyzers/jev-client.js";

const state = {
  project: { languages: ["TypeScript"] },
  files: { f0: { path: "a.ts", partialSignals: [] }, f1: { path: "b.ts", partialSignals: ["utility (0.3)"] } },
};
const qa = choice("Which archetype best describes the source file at `files.f0`?", { service: "x", none: "y" });
const qb = noul("Is `files.f1` a test helper?");

describe("keys", () => {
  it("canonicalJSON is order-independent at every level", () => {
    expect(canonicalJSON({ b: { d: 1, c: 2 }, a: [3, { z: 1, y: 2 }] })).toBe(canonicalJSON({ a: [3, { y: 2, z: 1 }], b: { c: 2, d: 1 } }));
  });

  it("referencedPaths reads backticked state paths and resolvePath walks them", () => {
    expect(referencedPaths(qa)).toEqual(["files.f0"]);
    expect(resolvePath(state, "files.f1.partialSignals[0]")).toBe("utility (0.3)");
    expect(resolvePath(state, "files.f9")).toBeUndefined();
  });

  it("keys on the referenced slice only, so unrelated state changes keep the key", () => {
    const k1 = judgmentKey(state, qa, "jev-latest");
    const changedOther = { ...state, files: { ...state.files, f1: { path: "changed.ts", partialSignals: [] } } };
    expect(judgmentKey(changedOther, qa, "jev-latest")).toBe(k1);
    const changedSelf = { ...state, files: { ...state.files, f0: { path: "moved.ts", partialSignals: [] } } };
    expect(judgmentKey(changedSelf, qa, "jev-latest")).not.toBe(k1);
    expect(judgmentKey(state, qa, "jev-2")).not.toBe(k1);
    expect(judgmentKey(state, choice("Other wording about `files.f0`?", { service: "x", none: "y" }), "jev-latest")).not.toBe(k1);
  });

  it("falls back to the whole state when no path resolves", () => {
    const q = noul("Is this codebase healthy?");
    const k1 = judgmentKey(state, q, "jev-latest");
    expect(judgmentKey({ ...state, project: { languages: ["Go"] } }, q, "jev-latest")).not.toBe(k1);
  });
});

describe("lookup and store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-judgments-"));
    configureJudgmentCache({ svDir: dir });
  });
  afterEach(() => {
    configureJudgmentCache(undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it("is inert when unconfigured: everything misses and nothing is written", () => {
    configureJudgmentCache(undefined);
    expect(isJudgmentCacheConfigured()).toBe(false);
    const l = lookupJudgments(state, { a: qa, b: qb }, "jev-latest");
    expect(Object.keys(l.misses)).toEqual(["a", "b"]);
    storeJudgments(l.keys, { a: { type: "choice", choice: "service", probabilities: { service: 1 }, confidence: 1 } }, "jev-1");
    expect(existsSync(join(dir, ".cache", JUDGMENT_CACHE_FILE))).toBe(false);
  });

  it("stores answers and serves them on the next lookup, per question", () => {
    const first = lookupJudgments(state, { a: qa, b: qb }, "jev-latest");
    expect(Object.keys(first.hits)).toEqual([]);
    storeJudgments(first.keys, { a: { type: "choice", choice: "service", probabilities: { service: 1 }, confidence: 1 } }, "jev-1.13.0");
    expect(existsSync(join(dir, ".cache", JUDGMENT_CACHE_FILE))).toBe(true);

    // A fresh process reads the file back.
    configureJudgmentCache({ svDir: dir });
    const second = lookupJudgments(state, { a: qa, b: qb }, "jev-latest");
    expect(Object.keys(second.hits)).toEqual(["a"]);
    expect(Object.keys(second.misses)).toEqual(["b"]);
    expect(second.model).toBe("jev-1.13.0");
  });

  it("ignores a stored answer whose type does not match the question", () => {
    const l = lookupJudgments(state, { a: qa }, "jev-latest");
    storeJudgments(l.keys, { a: { type: "noul", noul: 0.5 } }, "jev");
    expect(Object.keys(lookupJudgments(state, { a: qa }, "jev-latest").misses)).toEqual(["a"]);
  });

  it("treats a corrupt file as empty", () => {
    const path = join(dir, ".cache", JUDGMENT_CACHE_FILE);
    const l = lookupJudgments(state, { a: qa }, "jev-latest");
    storeJudgments(l.keys, { a: { type: "choice", choice: "service", probabilities: { service: 1 }, confidence: 1 } }, "jev");
    expect(JSON.parse(readFileSync(path, "utf-8")).version).toBe(1);
    configureJudgmentCache({ svDir: dir });
    writeFileSync(path, "{not json");
    expect(Object.keys(lookupJudgments(state, { a: qa }, "jev-latest").misses)).toEqual(["a"]);
  });
});
