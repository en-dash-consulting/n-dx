/**
 * Cross-tier contract: the primer fingerprint means the same thing in all
 * three tiers that touch it.
 *
 * `.sourcevision/PRIMER.md` is written by one package and read by two others:
 *
 * | Tier          | Function                            | Role     |
 * |---------------|-------------------------------------|----------|
 * | sourcevision  | `primerFingerprint` / `stampPrimer` | stamps   |
 * | core          | `sourcevisionAnalysisFingerprint`   | verifies |
 * | hench         | `sourcevisionFingerprint`           | verifies |
 *
 * None of them may import the others — core is orchestration-tier (spawn-only)
 * and hench has no sourcevision gateway — so the hash is implemented three
 * times and this test is the only thing holding the copies in agreement.
 *
 * The agreement is worth a dedicated test because a divergence is *silent*.
 * Nothing throws and nothing warns: the hashes simply stop matching, every
 * primer is judged stale forever, and both consumers fall back to the slower
 * path they were built to avoid. That is exactly what a stray edit to the
 * separator produced once already — a NUL byte on one side against a space on
 * the other, so the two could never agree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Compiled artifacts, so this tests the boundary as it actually ships.
const sv = await import("../../packages/sourcevision/dist/analyzers/primer.js");
const hench = await import("../../packages/hench/dist/agent/lifecycle/primer.js");
const henchCache = await import("../../packages/hench/dist/agent/lifecycle/session-cache.js");
// core is plain JS — no build step, imported from source.
const core = await import("../../packages/core/pair-programming.js");

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ndx-primer-contract-"));
  mkdirSync(join(dir, ".sourcevision"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeManifest(manifest) {
  writeFileSync(
    join(dir, ".sourcevision", "manifest.json"),
    JSON.stringify(manifest),
    "utf-8",
  );
  return manifest;
}

const writePrimer = (content) =>
  writeFileSync(join(dir, ".sourcevision", "PRIMER.md"), content, "utf-8");

/**
 * Manifest shapes the three implementations must agree on. `gitSha` is absent
 * outside a git checkout and `analyzedAt` is absent from a hand-edited or
 * truncated manifest, so neither is safe to assume present.
 */
const MANIFESTS = [
  ["a complete manifest", { analyzedAt: "2026-08-17T13:41:10.697Z", gitSha: "abc123" }],
  ["no gitSha (not a git checkout)", { analyzedAt: "2026-08-17T13:41:10.697Z" }],
  ["no analyzedAt", { gitSha: "abc123" }],
  ["neither field", {}],
  ["non-string fields", { analyzedAt: 17, gitSha: null }],
];

describe("primer fingerprint — three implementations, one value", () => {
  for (const [label, manifest] of MANIFESTS) {
    it(`agrees on ${label}`, async () => {
      writeManifest(manifest);

      const stamped = sv.primerFingerprint(manifest);
      expect(core.sourcevisionAnalysisFingerprint(dir)).toBe(stamped);
      expect(await henchCache.sourcevisionFingerprint(dir)).toBe(stamped);
    });
  }

  it("agrees when there is no manifest at all", async () => {
    const stamped = sv.primerFingerprint(null);
    expect(core.sourcevisionAnalysisFingerprint(dir)).toBe(stamped);
    expect(await henchCache.sourcevisionFingerprint(dir)).toBe(stamped);
  });

  it("distinguishes analyses that differ only in one field", () => {
    const base = { analyzedAt: "2026-08-17T13:41:10.697Z", gitSha: "abc123" };
    const fingerprints = new Set([
      sv.primerFingerprint(base),
      sv.primerFingerprint({ ...base, analyzedAt: "2026-08-28T09:00:00.000Z" }),
      sv.primerFingerprint({ ...base, gitSha: "def456" }),
    ]);
    expect(fingerprints.size).toBe(3);
  });

  it("cannot be satisfied by a field-concatenation collision", () => {
    // A separator-free join would hash "ab"+"c" and "a"+"bc" identically.
    expect(sv.primerFingerprint({ analyzedAt: "ab", gitSha: "c" })).not.toBe(
      sv.primerFingerprint({ analyzedAt: "a", gitSha: "bc" }),
    );
  });
});

describe("primer marker — what sourcevision stamps, both consumers read", () => {
  const BODY = "src/ holds production code. Build with `pnpm build`.";

  it("accepts a primer stamped from the current analysis", async () => {
    const manifest = writeManifest({
      analyzedAt: "2026-08-17T13:41:10.697Z",
      gitSha: "abc123",
    });
    writePrimer(sv.stampPrimer(BODY, sv.primerFingerprint(manifest)));

    expect(core.readContextMd(dir).source).toBe("primer");
    expect(
      await hench.readFreshPrimer(dir, await henchCache.sourcevisionFingerprint(dir)),
    ).toContain(BODY);
  });

  it("rejects a primer stamped from an earlier analysis", async () => {
    writeManifest({ analyzedAt: "2026-08-28T09:00:00.000Z", gitSha: "def456" });
    writePrimer(
      sv.stampPrimer(
        BODY,
        sv.primerFingerprint({ analyzedAt: "2026-08-17T13:41:10.697Z", gitSha: "abc123" }),
      ),
    );

    expect(core.readContextMd(dir).source).not.toBe("primer");
    expect(
      await hench.readFreshPrimer(dir, await henchCache.sourcevisionFingerprint(dir)),
    ).toBeUndefined();
  });

  it("reads back the fingerprint each tier stamped or parsed", () => {
    const fingerprint = sv.primerFingerprint({
      analyzedAt: "2026-08-17T13:41:10.697Z",
      gitSha: "abc123",
    });
    const stamped = sv.stampPrimer(BODY, fingerprint);

    expect(sv.readPrimerFingerprint(stamped)).toBe(fingerprint);
    expect(core.readPrimerFingerprint(stamped)).toBe(fingerprint);
    expect(hench.readPrimerFingerprint(stamped)).toBe(fingerprint);
  });

  it("agrees that the artifact is called PRIMER.md", () => {
    expect(hench.PRIMER_FILE).toBe(sv.PRIMER_FILE);
  });
});
