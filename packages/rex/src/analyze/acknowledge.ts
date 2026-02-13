import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────

export interface AcknowledgedFinding {
  hash: string;
  reason: string;
  text: string;
  acknowledgedAt: string;
  acknowledgedBy: string;
}

export interface AcknowledgedStore {
  version: 1;
  findings: AcknowledgedFinding[];
}

// ── Constants ────────────────────────────────────────────────────────

const STORE_FILE = "acknowledged-findings.json";

// ── Hash computation ─────────────────────────────────────────────────

/**
 * Compute a stable content hash for a finding.
 *
 * Normalizes volatile numbers (call counts, file counts) and lowercases
 * so that the same conceptual finding produces the same hash even when
 * thresholds shift counts between analysis runs.
 */
export function computeFindingHash(finding: { type: string; scope: string; text: string }): string {
  const normalized = finding.text.replace(/\d+/g, "N").toLowerCase().trim();
  const input = `${finding.type}:${finding.scope}:${normalized}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

// ── Store I/O ────────────────────────────────────────────────────────

function emptyStore(): AcknowledgedStore {
  return { version: 1, findings: [] };
}

/** Load acknowledged findings store. Returns empty store if file missing. */
export async function loadAcknowledged(rexDir: string): Promise<AcknowledgedStore> {
  try {
    const raw = await readFile(join(rexDir, STORE_FILE), "utf-8");
    const data = JSON.parse(raw) as AcknowledgedStore;
    if (data.version !== 1 || !Array.isArray(data.findings)) return emptyStore();
    return data;
  } catch {
    return emptyStore();
  }
}

/** Save acknowledged findings store to disk. */
export async function saveAcknowledged(rexDir: string, store: AcknowledgedStore): Promise<void> {
  await writeFile(join(rexDir, STORE_FILE), JSON.stringify(store, null, 2) + "\n");
}

// ── Pure operations ──────────────────────────────────────────────────

/** Add or update an acknowledged finding. Pure — returns new store, caller saves. */
export function acknowledgeFinding(
  store: AcknowledgedStore,
  hash: string,
  text: string,
  reason: string,
  by: string,
): AcknowledgedStore {
  const existing = store.findings.filter((f) => f.hash !== hash);
  return {
    ...store,
    findings: [
      ...existing,
      { hash, reason, text, acknowledgedAt: new Date().toISOString(), acknowledgedBy: by },
    ],
  };
}

/** Check if a finding hash is acknowledged. */
export function isAcknowledged(store: AcknowledgedStore, hash: string): boolean {
  return store.findings.some((f) => f.hash === hash);
}
