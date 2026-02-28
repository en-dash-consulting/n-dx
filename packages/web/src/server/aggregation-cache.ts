/**
 * Aggregation result cache with filesystem-based invalidation.
 *
 * Caches computed aggregation results (summary, events, by-command, etc.)
 * and automatically invalidates when the underlying data sources change.
 *
 * ## Change Detection
 *
 * Three data sources feed the token usage aggregation:
 * - Hench run files (`.hench/runs/*.json`) — tracked via directory mtime + file count
 * - Rex execution log (`.rex/execution-log.jsonl`) — tracked via mtime + size
 * - Sourcevision manifest (`.sourcevision/manifest.json`) — tracked via mtime + size
 *
 * On each cache access, the current filesystem state is compared against the
 * last-known fingerprint. If any source has changed, all cached results are
 * invalidated and the fingerprint is updated.
 *
 * ## Memory Bounding
 *
 * Cache entries are bounded by a configurable `maxEntries` limit. When full,
 * the oldest entry (by insertion order) is evicted. This prevents unbounded
 * growth from diverse query parameter combinations.
 *
 * @module web/server/aggregation-cache
 */

import { join } from "node:path";
import { stat, readdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Filesystem metadata snapshot for the three token usage data sources.
 * Used to detect when source data has changed and cached results need
 * to be invalidated.
 */
export interface SourceFingerprint {
  /** Hench runs directory modification time (changes on add/delete). */
  henchDirMtimeMs: number;
  /** Number of JSON files in the hench runs directory. */
  henchFileCount: number;
  /** Rex execution log modification time. */
  rexLogMtimeMs: number;
  /** Rex execution log size in bytes. */
  rexLogSize: number;
  /** Sourcevision manifest modification time. */
  svManifestMtimeMs: number;
  /** Sourcevision manifest size in bytes. */
  svManifestSize: number;
}

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

/**
 * Take a fingerprint of the current filesystem state of all aggregation
 * data sources. Missing files/directories produce zero values rather than
 * errors — this allows the cache to work even when some sources haven't
 * been initialized yet.
 */
export async function takeFingerprint(
  projectDir: string,
  rexDir: string,
): Promise<SourceFingerprint> {
  const henchRunsDir = join(projectDir, ".hench", "runs");
  const rexLogPath = join(rexDir, "execution-log.jsonl");
  const svManifestPath = join(projectDir, ".sourcevision", "manifest.json");

  // Run all stat operations in parallel for performance
  const [henchDirResult, henchFilesResult, rexLogResult, svManifestResult] =
    await Promise.all([
      stat(henchRunsDir).catch(() => null),
      readdir(henchRunsDir)
        .then((files) => files.filter((f) => f.endsWith(".json") && !f.startsWith(".")))
        .catch(() => [] as string[]),
      stat(rexLogPath).catch(() => null),
      stat(svManifestPath).catch(() => null),
    ]);

  return {
    henchDirMtimeMs: henchDirResult?.mtimeMs ?? 0,
    henchFileCount: henchFilesResult.length,
    rexLogMtimeMs: rexLogResult?.mtimeMs ?? 0,
    rexLogSize: rexLogResult?.size ?? 0,
    svManifestMtimeMs: svManifestResult?.mtimeMs ?? 0,
    svManifestSize: svManifestResult?.size ?? 0,
  };
}

/** Compare two fingerprints for equality. */
export function fingerprintsMatch(
  a: SourceFingerprint,
  b: SourceFingerprint,
): boolean {
  return (
    a.henchDirMtimeMs === b.henchDirMtimeMs &&
    a.henchFileCount === b.henchFileCount &&
    a.rexLogMtimeMs === b.rexLogMtimeMs &&
    a.rexLogSize === b.rexLogSize &&
    a.svManifestMtimeMs === b.svManifestMtimeMs &&
    a.svManifestSize === b.svManifestSize
  );
}

// ---------------------------------------------------------------------------
// AggregationResultCache
// ---------------------------------------------------------------------------

/**
 * Caches aggregation results with automatic filesystem-based invalidation.
 *
 * Usage:
 * ```ts
 * const cache = new AggregationResultCache(projectDir, rexDir);
 *
 * const events = await cache.getOrCompute(
 *   "events:::",
 *   () => collectAllEvents(ctx),
 * );
 * ```
 *
 * Cache keys should encode all parameters that affect the result
 * (e.g. `"summary:2026-01-01:2026-02-01"` for a date-scoped summary).
 */
export class AggregationResultCache {
  private readonly projectDir: string;
  private readonly rexDir: string;
  private readonly maxEntries: number;

  /** Last-known filesystem fingerprint. */
  private fingerprint: SourceFingerprint | null = null;

  /** Cached results keyed by scope string. */
  private entries = new Map<string, unknown>();

  constructor(
    projectDir: string,
    rexDir: string,
    options?: { maxEntries?: number },
  ) {
    this.projectDir = projectDir;
    this.rexDir = rexDir;
    this.maxEntries = options?.maxEntries ?? 64;
  }

  /**
   * Get a cached result or compute and cache it.
   *
   * Before returning a cached value, checks whether any source data has
   * changed since the last fingerprint. If so, all entries are invalidated
   * and the value is recomputed.
   *
   * @param key - Cache key encoding the query scope (e.g. `"summary:since:until"`)
   * @param compute - Synchronous function that produces the result
   */
  async getOrCompute<T>(key: string, compute: () => T): Promise<T> {
    await this.ensureFresh();

    if (this.entries.has(key)) {
      return this.entries.get(key) as T;
    }

    const result = compute();
    this.put(key, result);
    return result;
  }

  /** Number of cached entries (for monitoring/testing). */
  get size(): number {
    return this.entries.size;
  }

  /** Current fingerprint (for testing/debugging). */
  get currentFingerprint(): SourceFingerprint | null {
    return this.fingerprint;
  }

  /** Force invalidation of all cached results and fingerprint. */
  invalidate(): void {
    this.fingerprint = null;
    this.entries.clear();
  }

  // ---- Internal -------------------------------------------------------------

  /**
   * Check source freshness. If stale or uninitialized, clear all entries
   * and update the fingerprint.
   */
  private async ensureFresh(): Promise<void> {
    const current = await takeFingerprint(this.projectDir, this.rexDir);

    if (this.fingerprint && fingerprintsMatch(this.fingerprint, current)) {
      return; // Sources unchanged — cache is still valid
    }

    // Sources changed (or first access) — invalidate everything
    this.entries.clear();
    this.fingerprint = current;
  }

  /** Store a value, evicting the oldest entry if at capacity. */
  private put(key: string, value: unknown): void {
    // If key already exists, just update it (no eviction needed)
    if (this.entries.has(key)) {
      this.entries.set(key, value);
      return;
    }

    // Evict oldest entries until under capacity
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }

    this.entries.set(key, value);
  }
}
