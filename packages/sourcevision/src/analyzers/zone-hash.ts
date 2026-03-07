/**
 * Zone content hashing utility.
 *
 * Extracted from zones.ts to break the circular dependency between
 * zones.ts and enrich.ts. Both modules need this function: zones.ts
 * uses it during zone analysis, and enrich.ts uses it for cache
 * invalidation checks.
 *
 * @module sourcevision/analyzers/zone-hash
 */

import { createHash } from "node:crypto";

/**
 * Hash all zone content hashes into a single global content hash.
 * Changes when any zone's content changes.
 */
export function computeGlobalContentHash(
  zoneContentHashes: Record<string, string>
): string {
  const data = Object.keys(zoneContentHashes)
    .sort()
    .map((id) => `${id}\0${zoneContentHashes[id]}`)
    .join("\n");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}
