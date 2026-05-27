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
export { tryParseJSON, extractFindings, mergeZonesByName, deduplicateFindings, classifyFinding } from "./enrich-parsing.js";
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
  ProjectProfile,
} from "../schema/index.js";

import {
  ZONES_PER_BATCH,
  getPassConfig,
} from "./enrich-config.js";
import { computeGlobalContentHash } from "./zone-hash.js";
import { extractFindings, mergeZonesByName, deduplicateZoneIds, findPrevZone, extractZoneInsights } from "./enrich-parsing.js";
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
  projectProfile?: ProjectProfile,
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
      const preserved = zones.map((zone) => {
        const prev = findPrevZone(previousZones.zones, zone);
        return prev
          ? { ...zone, id: prev.id, name: prev.name, description: prev.description }
          : zone;
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

  // 2a. Structural-zone bypass. A zone whose files are entirely non-source
  //     (build scripts, assets, docs, config) has nothing for the LLM to
  //     analyze — the zone description is the file list paraphrased and the
  //     name comes from the directory. Templating these saves a meaningful
  //     fraction of LLM cost on a typical repo (gotobed: 4 of 9 zones).
  const templatedZones: Zone[] = [];
  const llmCandidates: Zone[] = [];
  const inventoryByPath = new Map(inventory.files.map((f) => [f.path, f]));
  for (const zone of zones) {
    if (isStructuralZone(zone, inventoryByPath)) {
      templatedZones.push(applyStructuralTemplate(zone, inventoryByPath));
    } else {
      llmCandidates.push(zone);
    }
  }
  if (templatedZones.length > 0) {
    console.log(`  [enrich] ${templatedZones.length} structural zone(s) templated without LLM (build/asset/docs/config only)`);
  }

  // 2. Per-zone content filtering: identify changed vs unchanged zones
  //    Only applies when we have previous data and per-zone content hashes.
  //    Unchanged zones preserve previous enrichment; only changed zones go to LLM.
  let zonesToEnrich = llmCandidates;
  let unchangedZones: Zone[] = [];

  if (currentContentHashes && previousZones?.zoneContentHashes && prevEnrichPass > 0) {
    const changed: Zone[] = [];
    for (const zone of llmCandidates) {
      if (currentContentHashes[zone.id] !== previousZones.zoneContentHashes[zone.id]) {
        changed.push(zone);
      } else {
        const prev = findPrevZone(previousZones.zones, zone);
        if (prev) {
          unchangedZones.push({
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
    if (changed.length > 0 && unchangedZones.length > 0) {
      console.log(`  [enrich] ${changed.length}/${llmCandidates.length} zones changed — skipping ${unchangedZones.length} unchanged`);
      zonesToEnrich = changed;
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

  // 5. Process batches in parallel. The previous sequential loop fed an
  //    `enrichedNames` map forward to dedupe zone names between batches —
  //    that was only a HINT to the LLM, not a correctness requirement. We
  //    fix any name collisions post-hoc in mergeZonesByName / dedupe steps,
  //    so the parallel speedup (≈2× per pass with 2 batches, more for big
  //    repos) is worth losing the cross-batch naming hint. Each batch is
  //    still an independent LLM call. If ANY batch reports an auth error
  //    we short-circuit the whole pass (no point sending another call to a
  //    broken token).
  const settled = await Promise.allSettled(
    batches.map((batch, bi) =>
      enrichBatch(
        batch, zones, sortedCrossingsArr,
        passNumber, passConfig, previousZones, bi, batches.length,
        new Map<string, string>(), fileArchetypes, hints, projectProfile,
      ),
    ),
  );

  const allBatchResults: BatchResult[] = [];
  let authFailed = false;
  for (let bi = 0; bi < settled.length; bi++) {
    const s = settled[bi];
    if (s.status === "rejected") {
      console.error(`  [enrich] batch ${bi + 1} rejected:`, s.reason instanceof Error ? s.reason.message : s.reason);
      continue;
    }
    const result = s.value;
    if (result && "authError" in result) {
      authFailed = true;
      continue;
    }
    if (result) allBatchResults.push(result);
  }

  if (allBatchResults.length === 0) {
    if (authFailed) {
      // auth error already logged upstream
    } else if (batches.length === 0 && (unchangedZones.length > 0 || templatedZones.length > 0)) {
      // No LLM work to do — everything preserved or templated.
      return { ...empty, zones: [...unchangedZones, ...templatedZones], pass: prevEnrichPass };
    } else if (batches.length > 0) {
      console.warn("  [enrich] All batches failed — using algorithmic names");
    }
    if (templatedZones.length > 0) {
      return { ...empty, zones: templatedZones, pass: prevEnrichPass };
    }
    return empty;
  }

  // 6. Aggregate and apply results, merging unchanged + templated zones back in
  const agg = aggregateBatchResults(allBatchResults);
  const result = applyEnrichResults(zonesToEnrich, agg, passNumber, passConfig, previousZones);
  if (unchangedZones.length > 0) {
    result.zones = [...result.zones, ...unchangedZones];
  }
  if (templatedZones.length > 0) {
    result.zones = [...result.zones, ...templatedZones];
  }
  return result;
}

// ── Structural-zone templating ───────────────────────────────────────────────

/**
 * A zone is "structural" if none of its files are source code — entirely
 * build scripts / assets / docs / config / generated / other. There's nothing
 * for the LLM to architecturally analyze; the zone description is the file
 * list paraphrased and the name comes from the directory shape. Templating
 * these saves a meaningful chunk of LLM cost.
 */
function isStructuralZone(
  zone: Zone,
  inventoryByPath: Map<string, { role: string }>,
): boolean {
  for (const f of zone.files) {
    const entry = inventoryByPath.get(f);
    if (entry?.role === "source") return false;
  }
  return zone.files.length > 0;
}

function applyStructuralTemplate(
  zone: Zone,
  inventoryByPath: Map<string, { role: string }>,
): Zone {
  // Tally roles. Whatever role dominates picks the noun.
  const roleCounts = new Map<string, number>();
  for (const f of zone.files) {
    const r = inventoryByPath.get(f)?.role ?? "other";
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  }
  const dominantRole = [...roleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";

  // Identify a top-level directory (the part before the first slash). All
  // files at the repo root collapse to "root".
  const topDirs = new Map<string, number>();
  for (const f of zone.files) {
    const slash = f.indexOf("/");
    const top = slash === -1 ? "root" : f.slice(0, slash);
    topDirs.set(top, (topDirs.get(top) ?? 0) + 1);
  }
  const topDir = [...topDirs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const titleCaseDir = topDir === "root"
    ? "Project Root"
    : topDir.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  let name: string;
  let descriptor: string;
  switch (dominantRole) {
    case "build":
      name = topDir === "scripts" ? "Build & CI Scripts" : `${titleCaseDir} Scripts`;
      descriptor = "Build, packaging, and CI scripts";
      break;
    case "asset":
      name = topDir === "root" ? "Project Assets" : `${titleCaseDir} Assets`;
      descriptor = "Bundle assets and resources";
      break;
    case "docs":
      name = topDir === "docs" ? "Documentation Site" : `${titleCaseDir} Documentation`;
      descriptor = "Documentation and static-site assets";
      break;
    case "config":
      name = topDir === "root" ? "Project Root" : `${titleCaseDir} Config`;
      descriptor = "Project configuration and manifest files";
      break;
    case "generated":
      name = `${titleCaseDir} Generated`;
      descriptor = "Machine-generated artifacts";
      break;
    default:
      name = titleCaseDir || zone.name || zone.id;
      descriptor = `Non-source files in ${topDir || "the project"}`;
  }

  // Short description that names a few representative files.
  const sample = zone.files.slice(0, 3).map((f) => {
    const idx = f.lastIndexOf("/");
    return idx === -1 ? f : f.slice(idx + 1);
  });
  const more = zone.files.length > 3 ? ` (+${zone.files.length - 3} more)` : "";
  const description = `${descriptor}: ${sample.join(", ")}${more}`;

  return {
    ...zone,
    name,
    description,
  };
}

// ── Result application (private) ─────────────────────────────────────────────

/** Apply enrichment results (pass 1 renames zones; pass 2+ preserves names). */
function applyEnrichResults(
  zones: Zone[],
  agg: ReturnType<typeof aggregateBatchResults>,
  passNumber: number,
  passConfig: { expectedTypes: FindingType[] },
  previousZones?: Zones,
): EnrichResult {
  const { allParsedZones, dedupedInsights, allParsedFindings, totalTokenUsage, successfulBatchIds } = agg;
  const isFirstPass = passNumber === 1;

  // Apply parsed data to zones
  let enriched: Zone[] = zones.map((zone) => {
    if (isFirstPass && !successfulBatchIds.has(zone.id)) return zone;
    const prev = isFirstPass ? undefined : findPrevZone(previousZones?.zones, zone);
    const e = allParsedZones.find((x: any) =>
      isFirstPass
        ? x?.algorithmicId === zone.id
        : x?.id === prev?.id || x?.id === zone.id
    );
    if (!e) return zone;
    if (isFirstPass) {
      if (!e.id || !e.name || !e.description) return zone;
      return { ...zone, id: e.id, name: e.name, description: e.description };
    }
    // Pass 2+: preserve previous names
    return prev ? { ...zone, id: prev.id, name: prev.name, description: prev.description } : zone;
  });

  // Merge duplicates only on first pass
  if (isFirstPass) {
    enriched = mergeZonesByName(enriched);
    if (enriched.length < zones.length) {
      console.log(`  [enrich] Merged ${zones.length - enriched.length} duplicate zones (${zones.length} → ${enriched.length})`);
    }
  }
  deduplicateZoneIds(enriched);

  // Extract per-zone insights
  const newZoneInsights = new Map<string, string[]>();
  for (const zone of enriched) {
    const prev = isFirstPass ? undefined : findPrevZone(previousZones?.zones, zone);
    const entry = allParsedZones.find((x: any) =>
      isFirstPass
        ? x?.algorithmicId === zone.id || x?.id === zone.id
        : x?.id === zone.id || x?.id === prev?.id
    );
    const insightField = isFirstPass ? "insights" : "newInsights";
    const insights = extractZoneInsights(entry, insightField);
    newZoneInsights.set(zone.id, insights);
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
