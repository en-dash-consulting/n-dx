/**
 * Record what an analysis left in `.sourcevision/`, so the next one can be
 * measured against it.
 *
 * Every run overwrites the data files, so "what changed since last time" has
 * no previous side to compare with once the writing is done. The answer is not
 * to keep a second copy of the data — it is large and almost all of it is
 * irrelevant to the question. What a diff needs is identity: how many files and
 * import edges there were, which zones existed, and which findings were open.
 * {@link readAnalysisOutcome} reduces the files on disk to exactly that, and
 * `analyze` records it on the run, where it costs a line of `analyses.jsonl`
 * and no LLM call at all.
 *
 * Reading only: this module is called after the phases have written, and it
 * never writes anything itself.
 *
 * @module sourcevision/analyzers/analysis-outcome
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_FILES } from "../schema/data-files.js";
import type { AnalysisOutcome, Finding } from "../schema/index.js";

/** A finding with no severity is an observation; `zones.json` leaves the field off. */
const DEFAULT_SEVERITY = "info";

/**
 * A finding's identity across runs.
 *
 * Its wording is generated, so two runs describe the same problem with the
 * same text only when nothing about it moved — which is what makes the text
 * usable as the key. `pass` is deliberately not part of it: the same finding
 * reached by a different pass is still the same finding, and including the
 * pass would report every one of them as resolved-and-re-added whenever the
 * enrichment route changed.
 *
 * Hashed rather than kept whole because the text is a sentence and this is
 * written once per finding per run; ten hex characters is 40 bits, far more
 * than the few hundred findings a run produces needs.
 */
export function findingKey(finding: Pick<Finding, "type" | "scope" | "text">): string {
  return createHash("sha1").update(`${finding.type}\u0000${finding.scope}\u0000${finding.text}`).digest("hex").slice(0, 10);
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function countOf(data: Record<string, unknown> | null, field: string): number {
  const summary = data?.summary;
  if (!summary || typeof summary !== "object") return 0;
  const value = (summary as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Every zone id in the tree, sub-zones included — the same walk `currentZoneIds` does. */
function zoneIdsOf(zones: Record<string, unknown> | null): string[] {
  type Z = { id?: unknown; subZones?: Z[] };
  const ids: string[] = [];
  const walk = (zone: Z): void => {
    if (typeof zone.id === "string") ids.push(zone.id);
    for (const sub of Array.isArray(zone.subZones) ? zone.subZones : []) walk(sub);
  };
  for (const zone of Array.isArray(zones?.zones) ? zones.zones as Z[] : []) walk(zone);
  return ids;
}

function findingsOf(zones: Record<string, unknown> | null): Record<string, string[]> {
  const findings: Record<string, string[]> = {};
  for (const raw of Array.isArray(zones?.findings) ? zones.findings : []) {
    if (!raw || typeof raw !== "object") continue;
    const finding = raw as Partial<Finding>;
    if (typeof finding.type !== "string" || typeof finding.scope !== "string" || typeof finding.text !== "string") continue;
    const severity = finding.severity ?? DEFAULT_SEVERITY;
    (findings[severity] ??= []).push(findingKey({ type: finding.type, scope: finding.scope, text: finding.text }));
  }
  return findings;
}

/**
 * Reduce the analysis files in `svDir` to what a later diff needs.
 *
 * Null when `zones.json` is unreadable: a run whose zone phase never wrote has
 * no partition and no findings to compare, and recording zero of each would
 * read to the next run as "every zone was removed".
 */
export function readAnalysisOutcome(svDir: string): AnalysisOutcome | null {
  const zones = readJson(join(svDir, DATA_FILES.zones));
  if (!zones) return null;
  return {
    files: countOf(readJson(join(svDir, DATA_FILES.inventory)), "totalFiles"),
    importEdges: countOf(readJson(join(svDir, DATA_FILES.imports)), "totalEdges"),
    zoneIds: zoneIdsOf(zones),
    findings: findingsOf(zones),
  };
}
