/**
 * AI enrichment for zone analysis.
 * Orchestrator — delegates to enrich-config, enrich-batch, claude-client, and enrich-parsing.
 */

// ── Barrel re-exports (keep consumers' imports stable) ───────────────────────

export { PASS_CONFIGS, getPassConfig, buildMetaPrompt, computeAttemptConfigs, computePerZoneAttemptConfigs, MAX_CONCURRENT_ZONES, PER_ZONE_MAX_FILES, PER_ZONE_MAX_CROSSINGS } from "./enrich-config.js";
export type { PassConfig } from "./enrich-config.js";
export {
  callClaude,
  callLLM,
  setClaudeConfig,
  setLLMConfig,
  setClaudeClient,
  setLLMClient,
  getAuthMode,
  getLLMVendor,
  ClaudeClientError,
  DEFAULT_MODEL,
  DEFAULT_CODEX_MODEL,
} from "./claude-client.js";
export type { CallClaudeResult } from "./claude-client.js";
export { tryParseJSON, extractFindings, mergeZonesByName, deduplicateFindings } from "./enrich-parsing.js";
export type { EnrichResult } from "./enrich-parsing.js";
export { emptyAnalyzeTokenUsage, accumulateTokenUsage, formatTokenUsage } from "./token-usage.js";
export { enrichZonesPerZone, computeZoneStructureHash } from "./enrich-per-zone.js";
export type { PerZoneEnrichResult } from "./enrich-per-zone.js";

// ── Imports ──────────────────────────────────────────────────────────────────

import type {
  Inventory,
  Imports,
  Zone,
  ZoneCrossing,
  Zones,
  FindingType,
} from "../schema/index.js";

import {
  ZONES_PER_BATCH,
  getPassConfig,
} from "./enrich-config.js";
import { computeGlobalContentHash } from "./zone-hash.js";
import { extractFindings, mergeZonesByName, deduplicateZoneIds } from "./enrich-parsing.js";
import type { EnrichResult } from "./enrich-parsing.js";
import {
  enrichBatch,
  runMetaEvaluation,
  aggregateBatchResults,
} from "./enrich-batch.js";
import type { BatchResult } from "./enrich-batch.js";

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Enrich zones using the Claude CLI with iterative deepening.
 * Pass 1: names, describes, and provides initial insights.
 * Pass 2+: adds deeper insights, preserving previous naming.
 *
 * Zones are processed in batches of ZONES_PER_BATCH to avoid timeout
 * on larger codebases. If a batch fails, previously-completed batches
 * are preserved. For <= ZONES_PER_BATCH zones, uses a single-batch fast path.
 */
export async function enrichZonesWithAI(
  zones: Zone[],
  crossings: ZoneCrossing[],
  inventory: Inventory,
  imports: Imports,
  previousZones?: Zones,
  fileArchetypes?: Map<string, string | null>,
  currentContentHashes?: Record<string, string>,
  hints?: string,
): Promise<EnrichResult> {
  const prevEnrichPass = previousZones?.enrichmentPass ?? 0;
  const passNumber = prevEnrichPass + 1;
  const isFirstPass = passNumber === 1;
  const isMetaPass = passNumber >= 5;

  const existingFindings = previousZones?.findings ?? [];
  const passConfig = getPassConfig(passNumber, existingFindings.length);
  const empty: EnrichResult = {
    zones,
    newZoneInsights: new Map(),
    newGlobalInsights: [],
    newFindings: [],
    pass: previousZones?.enrichmentPass ?? 0,
  };

  // 0. Content-hash skip: if nothing changed since last enrichment, skip entirely
  if (currentContentHashes && previousZones?.zoneContentHashes && prevEnrichPass > 0) {
    const prevGlobalHash = computeGlobalContentHash(previousZones.zoneContentHashes);
    const curGlobalHash = computeGlobalContentHash(currentContentHashes);
    if (prevGlobalHash === curGlobalHash && passNumber <= prevEnrichPass) {
      console.log(`  [enrich] Content unchanged — skipping enrichment (pass ${prevEnrichPass} preserved)`);
      // Preserve previous names/descriptions on current zones
      const prevZones = previousZones.zones;
      const preserved: Zone[] = zones.map((zone) => {
        const prev = prevZones.find(
          (p) => p.files.length > 0 && p.files.some((f) => zone.files.includes(f))
        );
        if (prev) {
          return { ...zone, id: prev.id, name: prev.name, description: prev.description };
        }
        return zone;
      });
      return {
        zones: preserved,
        newZoneInsights: new Map(),
        newGlobalInsights: [],
        newFindings: [],
        pass: prevEnrichPass,
      };
    }
  }

  // 1. Meta-evaluation path (pass 5+) — single prompt, no batching
  if (isMetaPass && existingFindings.length > 0) {
    const metaResult = await runMetaEvaluation(
      zones, existingFindings, crossings, passNumber, passConfig, hints,
    );
    if (!metaResult) return empty;

    return {
      zones,
      newZoneInsights: metaResult.newZoneInsights,
      newGlobalInsights: metaResult.newGlobalInsights,
      newFindings: metaResult.newFindings,
      pass: passNumber,
      _updatedFindings: metaResult.updatedFindings,
      tokenUsage: metaResult.tokenUsage,
    };
  }

  // 2. Per-zone content filtering: identify changed vs unchanged zones
  //    Only applies when we have previous data and per-zone content hashes.
  //    Unchanged zones preserve previous enrichment; only changed zones go to LLM.
  let zonesToEnrich = zones;
  let unchangedZones: Zone[] = [];

  if (currentContentHashes && previousZones?.zoneContentHashes && passNumber <= prevEnrichPass) {
    const changed: Zone[] = [];
    const unchanged: Zone[] = [];
    for (const zone of zones) {
      if (currentContentHashes[zone.id] !== previousZones.zoneContentHashes[zone.id]) {
        changed.push(zone);
      } else {
        const prev = previousZones.zones.find(
          (p) => p.files.length > 0 && p.files.some((f) => zone.files.includes(f))
        );
        if (prev) {
          unchanged.push({
            ...zone,
            id: prev.id,
            name: prev.name,
            description: prev.description,
          });
        } else {
          changed.push(zone);
        }
      }
    }
    if (changed.length < zones.length) {
      console.log(`  [enrich] ${changed.length}/${zones.length} zones changed — skipping ${unchanged.length} unchanged`);
      zonesToEnrich = changed;
      unchangedZones = unchanged;
    }
  }

  // 3. Build cross-zone summary (shared across all batches — includes ALL zones for context)
  const crossingSummary = new Map<string, number>();
  for (const c of crossings) {
    const key = `${c.fromZone} \u2192 ${c.toZone}`;
    crossingSummary.set(key, (crossingSummary.get(key) ?? 0) + 1);
  }
  const sortedCrossingsArr: [string, number][] = [...crossingSummary.entries()]
    .sort((a, b) => b[1] - a[1]);

  // 4. Split changed zones into batches
  const batches: Zone[][] = [];
  for (let i = 0; i < zonesToEnrich.length; i += ZONES_PER_BATCH) {
    batches.push(zonesToEnrich.slice(i, i + ZONES_PER_BATCH));
  }

  if (batches.length > 1) {
    console.log(`  [enrich] Processing ${zonesToEnrich.length} zones in ${batches.length} batches of up to ${ZONES_PER_BATCH}`);
  }

  // 5. Process batches sequentially, feeding enriched names forward
  const allBatchResults: BatchResult[] = [];
  const enrichedNames = new Map<string, string>();
  let authFailed = false;

  for (let bi = 0; bi < batches.length; bi++) {
    if (authFailed) break;

    try {
      const result = await enrichBatch(
        batches[bi], zones, sortedCrossingsArr,
        passNumber, passConfig, previousZones, bi, batches.length,
        enrichedNames, fileArchetypes, hints,
      );
      if (result && "authError" in result) {
        authFailed = true;
      } else if (result) {
        allBatchResults.push(result);

        // Track enriched names so subsequent batches can avoid duplicates
        if (isFirstPass && Array.isArray(result.parsed.zones)) {
          for (const z of result.parsed.zones) {
            if (z?.algorithmicId && typeof z.name === "string") {
              enrichedNames.set(z.algorithmicId, z.name);
            }
          }
        }
      }
    } catch (err) {
      console.error(`  [enrich] batch ${bi + 1} rejected:`, err instanceof Error ? err.message : err);
    }
  }

  if (allBatchResults.length === 0) {
    if (authFailed) {
      // auth error already logged upstream
    } else if (batches.length === 0 && unchangedZones.length > 0) {
      // All zones preserved from previous enrichment — return them
      return { ...empty, zones: unchangedZones, pass: prevEnrichPass };
    } else if (batches.length > 0) {
      console.warn("  [enrich] All batches failed — using algorithmic names");
    }
    return empty;
  }

  // 6. Aggregate and apply results, merging unchanged zones back in
  const agg = aggregateBatchResults(allBatchResults);

  if (isFirstPass) {
    const result = applyFirstPassResults(zonesToEnrich, agg, passConfig);
    if (unchangedZones.length > 0) {
      result.zones = [...result.zones, ...unchangedZones];
    }
    return result;
  }

  const result = applyLaterPassResults(zonesToEnrich, agg, passNumber, passConfig, previousZones);
  if (unchangedZones.length > 0) {
    result.zones = [...result.zones, ...unchangedZones];
  }
  return result;
}

// ── Result application (private) ─────────────────────────────────────────────

/** Apply pass 1 results: rename zones, extract insights and findings. */
function applyFirstPassResults(
  zones: Zone[],
  agg: ReturnType<typeof aggregateBatchResults>,
  passConfig: { expectedTypes: FindingType[] },
): EnrichResult {
  const { allParsedZones, dedupedInsights, allParsedFindings, totalTokenUsage, successfulBatchIds } = agg;

  const enrichedRaw: Zone[] = zones.map((zone) => {
    if (!successfulBatchIds.has(zone.id)) return zone;
    const e = allParsedZones.find((x: any) => x?.algorithmicId === zone.id);
    if (
      !e ||
      typeof e.id !== "string" ||
      typeof e.name !== "string" ||
      typeof e.description !== "string"
    ) {
      return zone;
    }
    return { ...zone, id: e.id, name: e.name, description: e.description };
  });

  // Merge zones the LLM identified as semantically identical across batches
  const enriched = mergeZonesByName(enrichedRaw);
  if (enriched.length < enrichedRaw.length) {
    console.log(`  [enrich] Merged ${enrichedRaw.length - enriched.length} duplicate zones (${enrichedRaw.length} → ${enriched.length})`);
  }
  deduplicateZoneIds(enriched);

  const newZoneInsights = new Map<string, string[]>();
  for (const zone of enriched) {
    const e = allParsedZones.find((x: any) =>
      x?.algorithmicId === zone.id || x?.id === zone.id
    );
    const aiInsights = Array.isArray(e?.insights)
      ? e.insights.filter((s: any) => typeof s === "string")
      : [];
    newZoneInsights.set(zone.id, aiInsights);
  }

  const combinedParsed = { zones: allParsedZones, insights: dedupedInsights, findings: allParsedFindings };
  const newFindings = extractFindings(combinedParsed, 1, passConfig.expectedTypes);

  return {
    zones: enriched,
    newZoneInsights,
    newGlobalInsights: dedupedInsights,
    newFindings,
    pass: 1,
    tokenUsage: totalTokenUsage,
  };
}

/** Apply pass 2+ results: preserve previous names, extract new insights. */
function applyLaterPassResults(
  zones: Zone[],
  agg: ReturnType<typeof aggregateBatchResults>,
  passNumber: number,
  passConfig: { expectedTypes: FindingType[] },
  previousZones?: Zones,
): EnrichResult {
  const { allParsedZones, dedupedInsights, allParsedFindings, totalTokenUsage } = agg;
  const prevZones = previousZones?.zones ?? [];

  const enriched: Zone[] = zones.map((zone) => {
    const prev = prevZones.find(
      (p) => p.files.length > 0 && p.files.some((f) => zone.files.includes(f))
    );
    if (prev) {
      return { ...zone, id: prev.id, name: prev.name, description: prev.description };
    }
    return zone;
  });
  deduplicateZoneIds(enriched);

  const newZoneInsights = new Map<string, string[]>();
  for (const zone of enriched) {
    const entry = allParsedZones.find((n: any) => n?.id === zone.id);
    const newInsights = Array.isArray(entry?.newInsights)
      ? entry.newInsights.filter((s: any) => typeof s === "string")
      : [];
    newZoneInsights.set(zone.id, newInsights);
  }

  const combinedParsed = { zones: allParsedZones, insights: dedupedInsights, findings: allParsedFindings };
  const newFindings = extractFindings(combinedParsed, passNumber, passConfig.expectedTypes);

  return {
    zones: enriched,
    newZoneInsights,
    newGlobalInsights: dedupedInsights,
    newFindings,
    pass: passNumber,
    tokenUsage: totalTokenUsage,
  };
}
