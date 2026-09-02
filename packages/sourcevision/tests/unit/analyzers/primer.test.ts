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

describe("primer fingerprint and staleness", () => {
  it("is stable for the same analysis", () => {
    expect(primerFingerprint(MANIFEST)).toBe(primerFingerprint(MANIFEST));
  });

  it("changes when the analysis is re-run or the commit differs", () => {
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
