/**
 * Zone id and name derivation: the directory segment, path discriminator or
 * filename theme a community's files share, and the title-cased name an id
 * starts with. Pure functions over file paths.
 *
 * Split out of `zones.ts`, which re-exports the public ones. Imports nothing
 * from `zones.ts`, so the naming pass can use {@link deriveZoneName} without
 * a cycle.
 *
 * @module sourcevision/analyzers/zone-id-derivation
 */

import { basename, dirname } from "node:path";
import { idFromStems } from "./zone-identity.js";

export const GENERIC_SEGMENTS = new Set([
  "src",
  "lib",
  "app",
  "packages",
  "internal",
  "pkg",
]);

/** Segments skipped during zone ID derivation (generic + test directories). */
export const SKIPPABLE_SEGMENTS = new Set([
  ...GENERIC_SEGMENTS,
  "tests", "test", "spec", "specs", "mocks",
]);

/**
 * Derive a zone ID from the most common directory segment among files.
 * Root-level files → "root".
 *
 * When `parentId` is provided (for sub-zone derivation), the parent's ID
 * segments are treated as generic and skipped, producing deeper, more
 * specific names (e.g., "agent" instead of "hench").
 */
export function deriveZoneId(files: string[], parentId?: string, extraSkip?: ReadonlySet<string>): string {
  // When deriving sub-zone IDs, treat parent's ID segments as generic
  const skip = parentId || extraSkip?.size
    ? new Set([...SKIPPABLE_SEGMENTS, ...(extraSkip ?? []), ...(parentId ? parentId.split("/").map(s => s.toLowerCase()) : [])])
    : SKIPPABLE_SEGMENTS;

  const segmentCounts = new Map<string, number>();

  for (const file of files) {
    const dir = dirname(file);
    if (dir === ".") {
      segmentCounts.set("root", (segmentCounts.get("root") ?? 0) + 1);
      continue;
    }

    const parts = dir.split("/");
    // Find first non-skip segment
    let found = false;
    for (const part of parts) {
      const normalized = part.toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
      if (!normalized || skip.has(part) || skip.has(normalized)) continue;
      segmentCounts.set(
        normalized,
        (segmentCounts.get(normalized) ?? 0) + 1
      );
      found = true;
      break;
    }
    // If all segments were skipped, use the last one
    if (!found && parts.length > 0) {
      const last = parts[parts.length - 1];
      const normalized = last.toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
      if (normalized) {
        segmentCounts.set(normalized, (segmentCounts.get(normalized) ?? 0) + 1);
      }
    }
  }

  if (segmentCounts.size === 0) return "root";

  // Most common segment, tie-break lexicographic
  let bestSegment = "root";
  let bestCount = 0;
  for (const [seg, count] of segmentCounts) {
    if (count > bestCount || (count === bestCount && seg < bestSegment)) {
      bestSegment = seg;
      bestCount = count;
    }
  }

  return bestSegment;
}

/**
 * Disambiguate a zone ID by finding the most common path segment that
 * appears AFTER the baseId segment in file paths. Returns `${baseId}-${next}`
 * (e.g., "routes-admin") or just `baseId` if no discriminator found.
 */
export function disambiguateZoneId(
  baseId: string,
  files: string[],
  parentId?: string,
  extraSkip?: ReadonlySet<string>,
): string {
  const parentSegments = new Set([
    ...(parentId ? parentId.split("/").map(s => s.toLowerCase()) : []),
    ...(extraSkip ?? []),
  ]);

  const nextCounts = new Map<string, number>();

  for (const file of files) {
    const parts = dirname(file).split("/");
    // Find the index of the baseId segment
    let baseIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      const normalized = parts[i].toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
      if (normalized === baseId) {
        baseIdx = i;
        break;
      }
    }
    if (baseIdx === -1) continue;

    // Look for the first meaningful segment after baseId
    for (let i = baseIdx + 1; i < parts.length; i++) {
      const normalized = parts[i].toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
      if (
        !normalized ||
        SKIPPABLE_SEGMENTS.has(normalized) ||
        parentSegments.has(normalized)
      ) {
        continue;
      }
      nextCounts.set(normalized, (nextCounts.get(normalized) ?? 0) + 1);
      break;
    }
  }

  if (nextCounts.size === 0) return baseId;

  // Pick the most common next segment, tie-break lexicographic
  let bestSegment = "";
  let bestCount = 0;
  for (const [seg, count] of nextCounts) {
    if (count > bestCount || (count === bestCount && seg < bestSegment)) {
      bestSegment = seg;
      bestCount = count;
    }
  }

  return bestSegment ? `${baseId}-${bestSegment}` : baseId;
}

/** Words skipped during filename-based zone ID derivation (too generic). */
const FILENAME_SKIP_WORDS = new Set([
  "test", "spec", "index", "utils", "helpers", "types",
  "config", "constants", "main", "app", "mod", "lib",
]);

/**
 * Derive a zone ID from the dominant theme word in filename stems.
 * Used as a fallback when directory-based derivation produces duplicate IDs.
 *
 * Algorithm:
 * 1. Filter out test files (*.test.ts, *.spec.ts)
 * 2. Extract filename stems, split by `-`, `_`, and camelCase boundaries
 * 3. Skip generic words (index, utils, types, etc.)
 * 4. Count word frequency (deduplicated per file)
 * 5. Return the most common word if it appears in ≥30% of source files (min 2 files)
 * 6. Tie-break lexicographically for determinism
 */
export function deriveZoneIdFromFilenames(files: string[]): string | null {
  // Filter out test files
  const sourceFiles = files.filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".spec.ts")
      && !f.endsWith(".test.js") && !f.endsWith(".spec.js")
      && !f.endsWith(".test.tsx") && !f.endsWith(".spec.tsx")
  );
  if (sourceFiles.length < 2) return null;

  const wordCounts = new Map<string, number>();

  for (const file of sourceFiles) {
    const stem = basename(file).replace(/\.[^.]+$/, "");
    // Split by `-`, `_`, and camelCase boundaries
    const words = stem
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[-_\s]+/)
      .filter((w) => w.length > 1 && !FILENAME_SKIP_WORDS.has(w));

    // Deduplicate per file
    const unique = new Set(words);
    for (const word of unique) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }

  if (wordCounts.size === 0) return null;

  // Find the most common word, tie-break lexicographically
  let bestWord = "";
  let bestCount = 0;
  for (const [word, count] of wordCounts) {
    if (count > bestCount || (count === bestCount && word < bestWord)) {
      bestWord = word;
      bestCount = count;
    }
  }

  // Must appear in ≥30% of source files and at least 2 files
  const threshold = Math.max(2, Math.ceil(sourceFiles.length * 0.3));
  if (bestCount < threshold) return null;

  return bestWord;
}

export function deriveZoneIdFromFileStems(
  files: string[],
  excludedWords: Iterable<string> = [],
): string | null {
  const SMALL_COMMUNITY_STEM_SKIP_WORDS = new Set(["index", "test", "spec"]);
  const sourceFiles = files.filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".spec.ts")
      && !f.endsWith(".test.js") && !f.endsWith(".spec.js")
      && !f.endsWith(".test.tsx") && !f.endsWith(".spec.tsx")
  );

  if (sourceFiles.length < 2 || sourceFiles.length > 3) return null;

  const skipWords = new Set(
    [...excludedWords]
      .flatMap((word) => word.split("/"))
      .map((word) => word.toLowerCase())
  );

  const stems = [...new Set(
    sourceFiles
      .map((file) => basename(file).replace(/\.[^.]+$/, ""))
      .filter((stem) => {
        const norm = stem.toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
        return norm && !SMALL_COMMUNITY_STEM_SKIP_WORDS.has(norm) && !skipWords.has(norm);
      })
      .sort()
  )];

  if (stems.length < 2) return null;
  // Words, not raw stems: camelCase split and route syntax stripped, so
  // CosmicCallout + DashboardGrid → cosmic-callout-dashboard-grid rather
  // than cosmiccallout-dashboardgrid.
  return idFromStems(stems.slice(0, 2));
}

/**
 * Title-case a zone ID: "detail-panel" → "Detail Panel"
 */
export function deriveZoneName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

