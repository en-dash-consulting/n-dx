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
 * and hench has no sourcevision gateway.
 *
 * The current contract is a *published field*: sourcevision computes
 * `analysisFingerprint` from CONTEXT.md and writes it into `manifest.json`, and
 * both consumers read that field rather than recomputing anything. The older
 * contract — three independent `analyzedAt + gitSha` hashes — survives only as a
 * fallback for manifests written before the field existed, and is still pinned
 * here because a manifest and the primer beside it are stamped as a pair: if the
 * copies drifted, an old pair would stop matching itself.
 *
 * The agreement is worth a dedicated test because a divergence is *silent*.
 * Nothing throws and nothing warns: the values simply stop matching, every
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
 * Manifest shapes the three implementations must agree on, for manifests
 * written before `analysisFingerprint` existed. `gitSha` is absent outside a
 * git checkout and `analyzedAt` is absent from a hand-edited or truncated
 * manifest, so neither is safe to assume present.
 */
const LEGACY_MANIFESTS = [
  ["a complete manifest", { analyzedAt: "2026-08-17T13:41:10.697Z", gitSha: "abc123" }],
  ["no gitSha (not a git checkout)", { analyzedAt: "2026-08-17T13:41:10.697Z" }],
  ["no analyzedAt", { gitSha: "abc123" }],
  ["neither field", {}],
  ["non-string fields", { analyzedAt: 17, gitSha: null }],
];

/** Manifest shapes where `analysisFingerprint` is present but unusable. */
const UNUSABLE_FIELD = [
  ["an empty string", ""],
  ["a non-string", 17],
  ["null", null],
];

describe("primer fingerprint — the published field is the contract", () => {
  it("has all three tiers read analysisFingerprint verbatim", async () => {
    const manifest = writeManifest({
      analyzedAt: "2026-08-17T13:41:10.697Z",
      gitSha: "abc123",
      analysisFingerprint: "0123456789abcdef",
    });

    expect(sv.primerFingerprint(manifest)).toBe("0123456789abcdef");
    expect(core.sourcevisionAnalysisFingerprint(dir)).toBe("0123456789abcdef");
    expect(await henchCache.sourcevisionFingerprint(dir)).toBe("0123456789abcdef");
  });

  it("ignores analyzedAt entirely once the field is present", async () => {
    // The defect this field exists to fix: every analysis rewrites analyzedAt,
    // so a timestamp-derived value went stale on runs that changed nothing.
    const base = { gitSha: "abc123", analysisFingerprint: "0123456789abcdef" };
    writeManifest({ ...base, analyzedAt: "2026-08-17T13:41:10.697Z" });
    const first = await henchCache.sourcevisionFingerprint(dir);

    writeManifest({ ...base, analyzedAt: "2026-09-24T22:05:00.000Z" });

    expect(await henchCache.sourcevisionFingerprint(dir)).toBe(first);
    expect(core.sourcevisionAnalysisFingerprint(dir)).toBe(first);
  });

  for (const [label, value] of UNUSABLE_FIELD) {
    it(`falls back to the legacy hash when the field is ${label}`, async () => {
      const legacy = { analyzedAt: "2026-08-17T13:41:10.697Z", gitSha: "abc123" };
      const manifest = writeManifest({ ...legacy, analysisFingerprint: value });
      const expected = sv.legacyManifestFingerprint(legacy);

      expect(sv.primerFingerprint(manifest)).toBe(expected);
      expect(core.sourcevisionAnalysisFingerprint(dir)).toBe(expected);
      expect(await henchCache.sourcevisionFingerprint(dir)).toBe(expected);
    });
  }
});

describe("primer fingerprint — the legacy fallback still agrees", () => {
  for (const [label, manifest] of LEGACY_MANIFESTS) {
    it(`agrees on ${label}`, async () => {
      writeManifest(manifest);

      const stamped = sv.primerFingerprint(manifest);
      expect(stamped).toBe(sv.legacyManifestFingerprint(manifest));
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

  it("keeps a primer valid across a re-analysis that found the same thing", async () => {
    // The whole defect in one case: `ndx ci` (or any run with no reachable
    // vendor) re-analyses, rewrites analyzedAt, and cannot re-distil. Both
    // consumers must still accept the primer the previous analysis left.
    const analysisFingerprint = "0123456789abcdef";
    writeManifest({
      analyzedAt: "2026-08-17T13:41:10.697Z",
      gitSha: "abc123",
      analysisFingerprint,
    });
    writePrimer(sv.stampPrimer(BODY, analysisFingerprint));

    // Re-analysis: new timestamp, same finding, no LLM call and so no restamp.
    writeManifest({
      analyzedAt: "2026-09-24T22:05:00.000Z",
      gitSha: "abc123",
      analysisFingerprint,
    });

    expect(core.readContextMd(dir).source).toBe("primer");
    expect(
      await hench.readFreshPrimer(dir, await henchCache.sourcevisionFingerprint(dir)),
    ).toContain(BODY);
  });

  it("rejects a primer stamped from an analysis that found something else", async () => {
    writeManifest({
      analyzedAt: "2026-08-17T13:41:10.697Z",
      gitSha: "abc123",
      analysisFingerprint: "ffffffffffffffff",
    });
    writePrimer(sv.stampPrimer(BODY, "0123456789abcdef"));

    expect(core.readContextMd(dir).source).not.toBe("primer");
    expect(
      await hench.readFreshPrimer(dir, await henchCache.sourcevisionFingerprint(dir)),
    ).toBeUndefined();
  });

  it("rejects a primer stamped from an earlier analysis (legacy manifest)", async () => {
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
