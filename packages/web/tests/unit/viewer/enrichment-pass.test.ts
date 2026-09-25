import { describe, expect, it } from "vitest";
import { effectiveEnrichmentPass, FULL_ENRICHMENT_PASS } from "../../../src/viewer/enrichment-pass.js";

describe("effectiveEnrichmentPass", () => {
  it("is the raw pass for a generative analysis", () => {
    expect(effectiveEnrichmentPass({ enrichmentPass: 2, enrichmentMode: "generative" })).toBe(2);
    expect(effectiveEnrichmentPass({ enrichmentPass: 3 }, { lastAnalysis: { mode: "generative" } })).toBe(3);
  });

  it("counts a cascade pass as complete, so pass-gated views unlock", () => {
    expect(effectiveEnrichmentPass({ enrichmentPass: 1, enrichmentMode: "cascade" })).toBe(FULL_ENRICHMENT_PASS);
  });

  it("falls back to the manifest's last run mode for zones.json files that predate the field", () => {
    expect(effectiveEnrichmentPass({ enrichmentPass: 1 }, { lastAnalysis: { mode: "cascade" } })).toBe(FULL_ENRICHMENT_PASS);
  });

  it("stays 0 without any enrichment", () => {
    expect(effectiveEnrichmentPass(null)).toBe(0);
    expect(effectiveEnrichmentPass({ enrichmentPass: 0, enrichmentMode: "cascade" })).toBe(0);
  });
});
