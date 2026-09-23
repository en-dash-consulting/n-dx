/**
 * The enrichment pass the viewer gates sourcevision views on.
 */

/** The last pass any view requires; a cascade analysis counts as this. */
export const FULL_ENRICHMENT_PASS = 4;

/**
 * The enrichment pass views should gate on. A cascade analysis produces, in
 * one judged pass, every finding kind the generative passes 2–4 add one at a
 * time — and never runs those passes — so gating it on the raw pass number
 * would lock Architecture, Problems and Suggestions forever. Older zones.json
 * files predate `enrichmentMode`; the manifest's last run mode covers them.
 */
export function effectiveEnrichmentPass(
  zones: { enrichmentPass?: number; enrichmentMode?: string } | null | undefined,
  manifest?: { lastAnalysis?: { mode?: string } } | null,
): number {
  const pass = zones?.enrichmentPass ?? 0;
  if (pass < 1) return pass;
  const cascade = zones?.enrichmentMode === "cascade"
    || (zones?.enrichmentMode === undefined && manifest?.lastAnalysis?.mode === "cascade");
  return cascade ? Math.max(pass, FULL_ENRICHMENT_PASS) : pass;
}
