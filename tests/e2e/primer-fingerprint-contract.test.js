/**
 * The primer fingerprint is computed in three tiers that cannot import each
 * other, so the formula is duplicated three times:
 *
 *   - sourcevision `primerFingerprint()`      — writes the stamp
 *   - core `currentPrimerFingerprint()`       — reads it in `ndx work` context assembly
 *   - hench `sourcevisionFingerprint()`       — reads it in the orientation pass
 *
 * If they drift, the readers reject every primer the writer produces and the
 * distilled startup context silently stops being used — no error, just a
 * quietly larger bill. This test holds the three together by computing all of
 * them from one manifest and asserting they agree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { primerFingerprint } from "../../packages/sourcevision/dist/analyzers/primer.js";
import { sourcevisionFingerprint } from "../../packages/hench/dist/agent/lifecycle/session-cache.js";
import { currentPrimerFingerprint } from "../../packages/core/pair-programming.js";

const MANIFEST = { analyzedAt: "2026-09-01T12:00:00.000Z", gitSha: "abc1234def5678" };

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-primer-fp-"));
  await mkdir(join(dir, ".sourcevision"), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("primer fingerprint cross-tier contract", () => {
  it("all three tiers derive the same fingerprint from one manifest", async () => {
    await writeFile(join(dir, ".sourcevision", "manifest.json"), JSON.stringify(MANIFEST));

    const written = primerFingerprint(MANIFEST);
    expect(currentPrimerFingerprint(dir)).toBe(written);
    expect(await sourcevisionFingerprint(dir)).toBe(written);
  });

  it("all three change together when the analysis changes", async () => {
    const reanalyzed = { ...MANIFEST, analyzedAt: "2026-09-02T12:00:00.000Z" };
    await writeFile(join(dir, ".sourcevision", "manifest.json"), JSON.stringify(reanalyzed));

    const written = primerFingerprint(reanalyzed);
    expect(written).not.toBe(primerFingerprint(MANIFEST));
    expect(currentPrimerFingerprint(dir)).toBe(written);
    expect(await sourcevisionFingerprint(dir)).toBe(written);
  });

  it("all three change together when the commit changes", async () => {
    const moved = { ...MANIFEST, gitSha: "9999999999999" };
    await writeFile(join(dir, ".sourcevision", "manifest.json"), JSON.stringify(moved));

    const written = primerFingerprint(moved);
    expect(written).not.toBe(primerFingerprint(MANIFEST));
    expect(currentPrimerFingerprint(dir)).toBe(written);
    expect(await sourcevisionFingerprint(dir)).toBe(written);
  });

  it("each tier reports an incomparable sentinel when no manifest exists", async () => {
    // The sentinels differ by tier and are never valid stamps; each reader
    // treats its own as "cannot compare" rather than as a mismatch.
    expect(currentPrimerFingerprint(dir)).toBe("unknown");
    expect(await sourcevisionFingerprint(dir)).toBe("sv-absent");
    expect(primerFingerprint(null)).toBe("unknown");
  });
});
