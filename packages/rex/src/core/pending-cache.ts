/**
 * Pending proposal cache infrastructure for smart prune operations.
 *
 * Provides save/load/clear operations for caching LLM-generated reshape
 * proposals between dry-run and accept passes, avoiding redundant LLM calls.
 * Includes PRD hash validation to detect stale caches.
 *
 * @module core/pending-cache
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { toCanonicalJSON } from "./canonical.js";
import type { ReshapeProposal } from "./reshape.js";
import type { PRDItem } from "../schema/index.js";

const REX_DIR = ".rex";

export const PENDING_SMART_PRUNE_FILE = "pending-smart-prune.json";

export interface PendingSmartPruneCache {
  generatedAt: string;
  prdHash: string;
  proposals: ReshapeProposal[];
}

/**
 * Compute a truncated SHA-256 hash of the PRD items array.
 *
 * Uses canonical JSON serialization to ensure deterministic output
 * regardless of object key ordering.
 */
export function hashPRD(items: PRDItem[]): string {
  return createHash("sha256")
    .update(toCanonicalJSON(items))
    .digest("hex")
    .slice(0, 12);
}

export async function savePendingSmartPrune(
  rexDir: string,
  proposals: ReshapeProposal[],
  prdHash: string,
): Promise<void> {
  const cache: PendingSmartPruneCache = {
    generatedAt: new Date().toISOString(),
    prdHash,
    proposals,
  };
  const filePath = join(rexDir, PENDING_SMART_PRUNE_FILE);
  await writeFile(filePath, JSON.stringify(cache, null, 2));
}

export async function loadPendingSmartPrune(
  rexDir: string,
): Promise<PendingSmartPruneCache | null> {
  const filePath = join(rexDir, PENDING_SMART_PRUNE_FILE);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as PendingSmartPruneCache;
  } catch {
    return null;
  }
}

export async function clearPendingSmartPrune(
  rexDir: string,
): Promise<void> {
  try {
    await unlink(join(rexDir, PENDING_SMART_PRUNE_FILE));
  } catch {
    // Already gone
  }
}
