/**
 * Tests for the distilled repo primer.
 *
 * The primer replaces an untrimmed CONTEXT.md pipe on the hot path — every
 * task, every retry — so two properties carry it: the output contract (a
 * mangled primer would be inherited by every task in the loop), and the
 * fingerprint cache (regenerating per task would cost more than the pipe it
 * replaces).
 *
 * Rejection is the correct failure mode throughout, because consumers fall
 * back to CONTEXT.md: no primer is a known-good state.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildPrimerPrompt,
  validatePrimer,
  generatePrimer,
  computeAnalysisFingerprint,
  legacyManifestFingerprint,
  primerFingerprint,
  stampPrimer,
  readPrimerFingerprint,
  isPrimerFresh,
  PRIMER_MAX_CHARS,
  PRIMER_MIN_CHARS,
} from "../../../src/analyzers/primer.js";
import type { Manifest } from "../../../src/schema/v1.js";

const MANIFEST = {
  analyzedAt: "2026-08-17T13:41:10.697Z",
  gitSha: "abc123",
} as unknown as Manifest;

const GOOD_PRIMER = "Layout: src holds production code, tests holds tests. ".repeat(10);

describe("buildPrimerPrompt", () => {
  it("asks for the four things a task actually needs", () => {
    const prompt = buildPrimerPrompt("ANALYSIS").toLowerCase();
    expect(prompt).toContain("layout");
    expect(prompt).toContain("build and test commands");
    expect(prompt).toContain("conventions");
  });

  it("forbids reproducing what CONTEXT.md already carries", () => {
    // Restating metrics and findings would defeat the point of distilling.
    const prompt = buildPrimerPrompt("ANALYSIS").toLowerCase();
    expect(prompt).toContain("do not include");
    expect(prompt).toMatch(/cohesion|coupling/);
    expect(prompt).toMatch(/route table|file inventor/);
  });

  it("embeds the analysis it is distilling", () => {
    expect(buildPrimerPrompt("MY-ANALYSIS-MARKER")).toContain("MY-ANALYSIS-MARKER");
  });

  it("is deterministic for the same input", () => {
    expect(buildPrimerPrompt("A")).toBe(buildPrimerPrompt("A"));
  });
});

describe("validatePrimer", () => {
  it("accepts a reasonable primer", () => {
    expect(validatePrimer(GOOD_PRIMER)).toBe(GOOD_PRIMER.trim());
  });

  it("strips code fences", () => {
    expect(validatePrimer("```\n" + GOOD_PRIMER + "\n```")).toBe(GOOD_PRIMER.trim());
  });

  it("rejects output too short to be an answer", () => {
    expect(() => validatePrimer("Sure!")).toThrow(/too short/i);
    expect(() => validatePrimer("")).toThrow(/too short/i);
  });

  it("rejects a distillation that did not distil", () => {
    expect(() => validatePrimer("x".repeat(PRIMER_MAX_CHARS + 1))).toThrow(/too long/i);
  });

  it("accepts output exactly at the bounds", () => {
    expect(() => validatePrimer("y".repeat(PRIMER_MIN_CHARS))).not.toThrow();
    expect(() => validatePrimer("y".repeat(PRIMER_MAX_CHARS))).not.toThrow();
  });
});

describe("computeAnalysisFingerprint", () => {
  const CONTEXT = "# proj — CONTEXT\n\nFiles: 12, Lines: 400\n";

  it("is equal for two analyses that found the same thing", () => {
    // The property the whole fix rests on. `analyzedAt` is deliberately not an
    // input: every analysis rewrites it, so including it made the stamp go
    // stale on runs that changed nothing — and a run with no LLM call cannot
    // re-stamp, which orphaned the primer until the next paid analysis.
    expect(computeAnalysisFingerprint({ gitSha: "abc123", contextMd: CONTEXT })).toBe(
      computeAnalysisFingerprint({ gitSha: "abc123", contextMd: CONTEXT }),
    );
  });

  it("changes when the analysis found something different", () => {
    const base = computeAnalysisFingerprint({ gitSha: "abc123", contextMd: CONTEXT });
    expect(
      computeAnalysisFingerprint({ gitSha: "abc123", contextMd: `${CONTEXT}Zones: 3\n` }),
    ).not.toBe(base);
    expect(computeAnalysisFingerprint({ gitSha: "def456", contextMd: CONTEXT })).not.toBe(base);
  });

  it("treats a missing gitSha as absent rather than throwing", () => {
    // Not every analysed tree is a git checkout.
    expect(computeAnalysisFingerprint({ contextMd: CONTEXT })).toBe(
      computeAnalysisFingerprint({ gitSha: null, contextMd: CONTEXT }),
    );
  });

  it("cannot be satisfied by a field-concatenation collision", () => {
    expect(computeAnalysisFingerprint({ gitSha: "ab", contextMd: "c" })).not.toBe(
      computeAnalysisFingerprint({ gitSha: "a", contextMd: "bc" }),
    );
  });
});

describe("primer fingerprint and staleness", () => {
  const STAMPED = {
    ...MANIFEST,
    analysisFingerprint: "0123456789abcdef",
  } as unknown as Manifest;

  it("is stable for the same analysis", () => {
    expect(primerFingerprint(MANIFEST)).toBe(primerFingerprint(MANIFEST));
  });

  it("reads the manifest's published fingerprint when it has one", () => {
    expect(primerFingerprint(STAMPED)).toBe("0123456789abcdef");
  });

  it("ignores analyzedAt once the manifest publishes a fingerprint", () => {
    // A re-analysis that found the same thing keeps the cached primer fresh.
    expect(
      primerFingerprint({ ...STAMPED, analyzedAt: "2026-09-24T22:05:00.000Z" } as never),
    ).toBe(primerFingerprint(STAMPED));
  });

  it("falls back to the legacy hash for a manifest written before the field", () => {
    expect(primerFingerprint(MANIFEST)).toBe(legacyManifestFingerprint(MANIFEST));

    const base = primerFingerprint(MANIFEST);
    expect(primerFingerprint({ ...MANIFEST, analyzedAt: "2026-08-30T00:00:00.000Z" } as never)).not.toBe(base);
    expect(primerFingerprint({ ...MANIFEST, gitSha: "def456" } as never)).not.toBe(base);
  });

  it("round-trips through the stamp", () => {
    const fp = primerFingerprint(MANIFEST);
    const stamped = stampPrimer(GOOD_PRIMER, fp);

    expect(readPrimerFingerprint(stamped)).toBe(fp);
    expect(isPrimerFresh(stamped, fp)).toBe(true);
    expect(stamped).toContain(GOOD_PRIMER.trim());
  });

  it("treats an unstamped or mismatched primer as stale", () => {
    expect(isPrimerFresh("no marker here", "abc")).toBe(false);
    expect(isPrimerFresh(stampPrimer(GOOD_PRIMER, "old"), "new")).toBe(false);
    expect(isPrimerFresh(null, "abc")).toBe(false);
  });

  it("does not throw on a manifest with no usable fields", () => {
    expect(primerFingerprint(null)).toBe("unknown");
    expect(primerFingerprint({} as never)).toBe("unknown");
  });
});

describe("generatePrimer", () => {
  const baseArgs = {
    contextMd: "# CONTEXT\n\nsrc/ holds code. Run pnpm test.",
    manifest: MANIFEST,
  };

  it("generates and stamps a primer on a cache miss", async () => {
    const call = vi.fn().mockResolvedValue({ text: GOOD_PRIMER });
    const result = await generatePrimer({ ...baseArgs, call });

    expect(result.status).toBe("generated");
    expect(call).toHaveBeenCalledTimes(1);
    if (result.status === "generated") {
      expect(isPrimerFresh(result.primer, primerFingerprint(MANIFEST))).toBe(true);
    }
  });

  it("reuses a fresh cached primer without calling the model", async () => {
    const call = vi.fn();
    const cached = stampPrimer(GOOD_PRIMER, primerFingerprint(MANIFEST));

    const result = await generatePrimer({ ...baseArgs, cachedPrimer: cached, call });

    expect(result.status).toBe("cached");
    expect(call).not.toHaveBeenCalled();
  });

  it("does not pay for a re-distillation when the analysis found the same thing", async () => {
    // Before the content fingerprint this was the steady state: every
    // LLM-enabled analyse rewrote analyzedAt, so the cache never hit and every
    // run bought a context.distill call it did not need.
    const contextMd = baseArgs.contextMd;
    const fingerprint = computeAnalysisFingerprint({ gitSha: "abc123", contextMd });
    const cached = stampPrimer(GOOD_PRIMER, fingerprint);
    const call = vi.fn();

    const result = await generatePrimer({
      contextMd,
      manifest: {
        analyzedAt: "2026-09-24T22:05:00.000Z",
        gitSha: "abc123",
        analysisFingerprint: fingerprint,
      } as unknown as Manifest,
      cachedPrimer: cached,
      call,
    });

    expect(result.status).toBe("cached");
    expect(call).not.toHaveBeenCalled();
  });

  it("regenerates when the analysis fingerprint moved on", async () => {
    const call = vi.fn().mockResolvedValue({ text: GOOD_PRIMER });
    const stale = stampPrimer(GOOD_PRIMER, "stale-fingerprint");

    const result = await generatePrimer({ ...baseArgs, cachedPrimer: stale, call });

    expect(result.status).toBe("generated");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("skips rather than throwing when the model fails", async () => {
    const call = vi.fn().mockRejectedValue(new Error("no LLM configured"));
    const result = await generatePrimer({ ...baseArgs, call });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toMatch(/no LLM/);
  });

  it("skips when the output breaks its contract", async () => {
    const call = vi.fn().mockResolvedValue({ text: "nope" });
    const result = await generatePrimer({ ...baseArgs, call });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toMatch(/too short/i);
  });

  it("skips when there is no analysis to distil, without calling the model", async () => {
    const call = vi.fn();
    const result = await generatePrimer({ ...baseArgs, contextMd: "   ", call });

    expect(result.status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
  });
});
