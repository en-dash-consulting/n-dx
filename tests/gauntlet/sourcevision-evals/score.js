/**
 * Scoring functions for sourcevision eval goldens.
 *
 * Each scorer takes a (golden, actual) pair of minimal structures —
 * NOT raw sv-analyze output — and returns a score in [0, 1]. Callers
 * are responsible for extracting the relevant fields from
 * classifications.json / zones.json before scoring.
 *
 * Exported shape:
 *   { files: [{ path, archetype }], zones: [{ id, files: string[] }] }
 */

/**
 * % of files where actual archetype matches golden archetype.
 *
 * Files present only on one side are ignored (denominator counts only
 * files present on both sides) so that adding/removing fixture files
 * doesn't drag the score down — only archetype shifts on existing
 * files matter.
 *
 * @param {{ files: Array<{ path: string, archetype: string | null }> }} golden
 * @param {{ files: Array<{ path: string, archetype: string | null }> }} actual
 * @returns {number} score in [0, 1]
 */
export function archetypeAccuracy(golden, actual) {
  const goldenMap = new Map(golden.files.map((f) => [f.path, f.archetype ?? null]));
  let matched = 0;
  let total = 0;
  for (const f of actual.files) {
    const g = goldenMap.get(f.path);
    if (g === undefined) continue;
    total++;
    if ((f.archetype ?? null) === g) matched++;
  }
  return total === 0 ? 1 : matched / total;
}

/**
 * Average Jaccard similarity of zone file-membership, matching each
 * golden zone to the actual zone with greatest overlap.
 *
 * This scores the *partition* (how files are grouped), not zone names
 * or descriptions — so it survives LLM nondeterminism on zone labels.
 *
 * @param {{ zones: Array<{ id: string, files: string[] }> }} golden
 * @param {{ zones: Array<{ id: string, files: string[] }> }} actual
 * @returns {number} score in [0, 1]
 */
export function zonePartitionSimilarity(golden, actual) {
  if (golden.zones.length === 0) return actual.zones.length === 0 ? 1 : 0;

  const actualSets = actual.zones.map((z) => new Set(z.files));
  let total = 0;

  for (const g of golden.zones) {
    const gSet = new Set(g.files);
    let best = 0;
    for (const aSet of actualSets) {
      const intersection = countIntersection(gSet, aSet);
      const union = gSet.size + aSet.size - intersection;
      const jaccard = union === 0 ? 0 : intersection / union;
      if (jaccard > best) best = jaccard;
    }
    total += best;
  }

  return total / golden.zones.length;
}

function countIntersection(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/**
 * Reduce raw sv-analyze output files to the minimal shape scorers accept.
 * Exposed so eval tests and the recorder share one projection.
 */
export function projectForScoring({ classifications, zones }) {
  return {
    files: classifications.files.map((f) => ({
      path: f.path,
      archetype: f.archetype ?? null,
    })),
    zones: zones.zones.map((z) => ({
      id: z.id,
      files: [...z.files],
    })),
  };
}
