/**
 * Per-zone AI enrichment — enriches each zone individually instead of batching.
 *
 * Benefits:
 * - Smaller context per call → cheaper, faster, more focused
 * - Incremental: change one file → re-enrich only its zone
 * - Parallelizable: enrich multiple zones concurrently
 */

import { createHash } from "node:crypto";
import type {
  Inventory,
  Imports,
  Zone,
  ZoneCrossing,
  Zones,
  Finding,
  ZoneTokenUsage,
  AnalyzeTokenUsage,
} from "../schema/index.js";
import {
  MAX_CONCURRENT_ZONES,
  PER_ZONE_MAX_FILES,
  PER_ZONE_MAX_CROSSINGS,
  getPassConfig,
  computePerZoneAttemptConfigs,
} from "./enrich-config.js";
import type { PassConfig } from "./enrich-config.js";
import { callClaude, ClaudeClientError } from "./claude-client.js";
import { tryParseJSON, extractFindings, deduplicateZoneIds } from "./enrich-parsing.js";
import { emptyAnalyzeTokenUsage, accumulateTokenUsage } from "./token-usage.js";
import { startSpinner } from "../cli/output.js";

// ── Per-zone structure hash ──────────────────────────────────────────────────

/** Compute a hash of a single zone's file list for change detection. */
export function computeZoneStructureHash(zone: Zone): string {
  const data = [...zone.files].sort().join("\n");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// ── Single zone enrichment ───────────────────────────────────────────────────

interface SingleZoneResult {
  zone: Zone;
  newInsights: string[];
  newFindings: Finding[];
  tokenUsage: ZoneTokenUsage;
  success: boolean;
}

/**
 * Enrich a single zone with the active LLM vendor.
 * Sends only this zone's files + entry points + boundary crossings.
 * Includes 1-line summaries of other zones for context.
 */
async function enrichSingleZone(
  zone: Zone,
  allZones: Zone[],
  crossings: ZoneCrossing[],
  inventory: Inventory,
  passNumber: number,
  passConfig: PassConfig,
  previousZone?: Zone,
  fileArchetypes?: Map<string, string | null>,
): Promise<SingleZoneResult> {
  const ATTEMPT_CONFIGS = computePerZoneAttemptConfigs(zone.files.length, passNumber);
  const isFirstPass = passNumber === 1;
  const zoneTokenUsage: ZoneTokenUsage = { calls: 0, input: 0, output: 0 };

  // Build 1-line summaries of OTHER zones for context
  const otherSummaries = allZones
    .filter((z) => z.id !== zone.id)
    .map((z) => `"${z.name}" (${z.files.length} files, cohesion: ${z.cohesion})`)
    .join("; ");
  const otherContext = otherSummaries
    ? `\nOther zones in this codebase: ${otherSummaries}`
    : "";

  // Boundary crossings for this zone
  const zoneCrossings = crossings.filter(
    (c) => c.fromZone === zone.id || c.toZone === zone.id
  );
  const crossingSummary = new Map<string, number>();
  for (const c of zoneCrossings) {
    const key = c.fromZone === zone.id
      ? `${zone.id} → ${c.toZone}`
      : `${c.fromZone} → ${zone.id}`;
    crossingSummary.set(key, (crossingSummary.get(key) ?? 0) + 1);
  }
  const sortedCrossings = [...crossingSummary.entries()]
    .sort((a, b) => b[1] - a[1]);

  for (let attempt = 0; attempt < ATTEMPT_CONFIGS.length; attempt++) {
    const config = ATTEMPT_CONFIGS[attempt];

    const crossingLines = sortedCrossings
      .slice(0, config.maxCrossings)
      .map(([pair, count]) => `  ${pair}: ${count} imports`)
      .join("\n");

    let prompt: string;

    if (isFirstPass) {
      const filesSample = zone.files.length > config.maxFiles + 2
        ? [...zone.files.slice(0, config.maxFiles), `... and ${zone.files.length - config.maxFiles} more`]
        : zone.files;
      const entryLine = config.maxFiles >= 8
        ? `\nEntry points: ${zone.entryPoints.map((f) => `"${f}"`).join(", ") || "none"}`
        : "";

      prompt = `Analyze this code zone. It was discovered by import-graph community detection.

${passConfig.focus}

Zone: "${zone.id}" (cohesion: ${zone.cohesion}, coupling: ${zone.coupling}, ${zone.files.length} files)
Files: ${filesSample.map((f) => { const a = fileArchetypes?.get(f); return a ? `"${f}" [${a}]` : `"${f}"`; }).join(", ")}${entryLine}
${otherContext}

Boundary crossings:
${crossingLines || "  (none)"}

Each finding MUST include a "severity" field: "info" (informational), "warning" (should fix), or "critical" (must fix).

Respond with ONLY a JSON object (no markdown, no explanation):
{"id":"kebab-case-id","name":"Title Case Name","description":"One sentence describing the zone's purpose.","insights":["actionable insight about this zone"],"findings":[{"type":"observation","scope":"${zone.id}","text":"finding text","severity":"info"}]}

Use finding types: ${passConfig.expectedTypes.join(", ")}.`;
    } else {
      // Pass 2+: only new insights
      const prevInsights = previousZone?.insights ?? [];
      const filesSample = zone.files.length > config.maxFiles + 2
        ? [...zone.files.slice(0, config.maxFiles), `... and ${zone.files.length - config.maxFiles} more`]
        : zone.files;
      const maxInsights = config.maxFiles >= 8 ? prevInsights.length : Math.min(prevInsights.length, 3);

      prompt = `You previously analyzed this zone. Here is the current state:

Zone: "${zone.id}" (cohesion: ${zone.cohesion}, coupling: ${zone.coupling}, ${zone.files.length} files)
Files: ${filesSample.map((f: string) => { const a = fileArchetypes?.get(f); return a ? `"${f}" [${a}]` : `"${f}"`; }).join(", ")}
Known insights: ${prevInsights.slice(0, maxInsights).length > 0 ? prevInsights.slice(0, maxInsights).map((i) => `"${i}"`).join("; ") : "(none)"}
${otherContext}

Boundary crossings:
${crossingLines || "  (none)"}

This is enrichment pass ${passNumber}. ${passConfig.focus}

Add ONLY NEW insights not already captured above. Do not repeat or rephrase existing observations.

Each finding MUST include a "severity" field: "info" (informational), "warning" (should fix), or "critical" (must fix).

Respond with ONLY a JSON object:
{"id":"${zone.id}","newInsights":["new insight"],"findings":[{"type":"${passConfig.expectedTypes[0]}","scope":"${zone.id}","text":"finding text","severity":"info"}]}

Use finding types: ${passConfig.expectedTypes.join(", ")}. Empty arrays are fine if nothing new to add.`;
    }

    const promptLevel = config.maxFiles >= PER_ZONE_MAX_FILES ? "full" : config.maxFiles >= 8 ? "medium" : "minimal";
    console.log(`  [enrich] Zone "${zone.id}" (attempt ${attempt + 1}/${ATTEMPT_CONFIGS.length}, ${promptLevel} prompt)...`);

    let callText: string;
    try {
      const callResult = await callClaude(prompt);
      zoneTokenUsage.calls++;
      if (callResult.tokenUsage) {
        zoneTokenUsage.input += callResult.tokenUsage.input;
        zoneTokenUsage.output += callResult.tokenUsage.output;
      }
      callText = callResult.text;
    } catch (err) {
      if (err instanceof ClaudeClientError) {
        zoneTokenUsage.calls++;
        if (err.reason === "auth" || err.reason === "not-found") {
          console.warn(`  [enrich] ${err.reason === "auth" ? "Authentication error — run 'ndx config' and verify vendor credentials" : "LLM CLI not found"}`);
          return { zone, newInsights: [], newFindings: [], tokenUsage: zoneTokenUsage, success: false };
        }
        const label = attempt < ATTEMPT_CONFIGS.length - 1 ? "retrying" : "giving up";
        console.warn(`  [enrich] Zone "${zone.id}" attempt ${attempt + 1} failed (${err.reason}) — ${label}`);
        continue;
      }
      throw err;
    }

    const candidate = tryParseJSON(callText);
    if (!candidate) {
      const label = attempt < ATTEMPT_CONFIGS.length - 1 ? "retrying" : "giving up";
      console.warn(`  [enrich] Zone "${zone.id}" attempt ${attempt + 1}: invalid JSON — ${label}`);
      continue;
    }

    // Apply result
    if (isFirstPass) {
      if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.description !== "string") {
        const label = attempt < ATTEMPT_CONFIGS.length - 1 ? "retrying" : "giving up";
        console.warn(`  [enrich] Zone "${zone.id}" attempt ${attempt + 1}: missing id/name/description — ${label}`);
        continue;
      }

      const newInsights = Array.isArray(candidate.insights)
        ? candidate.insights.filter((s: any) => typeof s === "string")
        : [];
      const newFindings = extractFindings({ zones: [candidate], findings: candidate.findings ?? [] }, passNumber, passConfig.expectedTypes);

      const enrichedZone: Zone = {
        ...zone,
        id: candidate.id,
        name: candidate.name,
        description: candidate.description,
      };

      return { zone: enrichedZone, newInsights, newFindings, tokenUsage: zoneTokenUsage, success: true };
    } else {
      // Pass 2+
      const newInsights = Array.isArray(candidate.newInsights)
        ? candidate.newInsights.filter((s: any) => typeof s === "string")
        : [];
      const newFindings = extractFindings({ zones: [candidate], findings: candidate.findings ?? [] }, passNumber, passConfig.expectedTypes);

      return { zone, newInsights, newFindings, tokenUsage: zoneTokenUsage, success: true };
    }
  }

  console.warn(`  [enrich] Zone "${zone.id}" all attempts exhausted — keeping algorithmic data`);
  return { zone, newInsights: [], newFindings: [], tokenUsage: zoneTokenUsage, success: false };
}

// ── Public entry point ───────────────────────────────────────────────────────

export interface PerZoneEnrichResult {
  zones: Zone[];
  newZoneInsights: Map<string, string[]>;
  newGlobalInsights: string[];
  newFindings: Finding[];
  pass: number;
  tokenUsage?: AnalyzeTokenUsage;
}

/**
 * Enrich zones using per-zone mode.
 * Each zone is enriched individually, allowing:
 * - Smaller context per call
 * - Incremental enrichment (only re-enrich zones whose structure changed)
 * - Concurrent processing
 */
export async function enrichZonesPerZone(
  zones: Zone[],
  crossings: ZoneCrossing[],
  inventory: Inventory,
  imports: Imports,
  previousZones?: Zones,
  fileArchetypes?: Map<string, string | null>,
): Promise<PerZoneEnrichResult> {
  const prevEnrichPass = previousZones?.enrichmentPass ?? 0;
  const passNumber = prevEnrichPass + 1;
  const isFirstPass = passNumber === 1;
  const passConfig = getPassConfig(passNumber, (previousZones?.findings ?? []).length);

  const empty: PerZoneEnrichResult = {
    zones,
    newZoneInsights: new Map(),
    newGlobalInsights: [],
    newFindings: [],
    pass: previousZones?.enrichmentPass ?? 0,
  };

  // Compute per-zone structure hashes
  const zoneHashes = new Map<string, string>();
  for (const zone of zones) {
    zoneHashes.set(zone.id, computeZoneStructureHash(zone));
  }

  // Determine which zones need enrichment
  const zonesToEnrich: Zone[] = [];
  const unchangedZones: Zone[] = [];

  for (const zone of zones) {
    const hash = zoneHashes.get(zone.id)!;
    const prevZone = previousZones?.zones.find(
      (p) => p.files.length > 0 && p.files.some((f) => zone.files.includes(f))
    );

    // Skip if structure unchanged and already enriched
    if (prevZone?.structureHash === hash && prevEnrichPass > 0) {
      unchangedZones.push({
        ...zone,
        id: prevZone.id,
        name: prevZone.name,
        description: prevZone.description,
        insights: prevZone.insights,
        structureHash: hash,
        tokenUsage: prevZone.tokenUsage,
      });
    } else {
      zonesToEnrich.push(zone);
    }
  }

  if (zonesToEnrich.length === 0) {
    console.log(`  [enrich] All ${zones.length} zones unchanged — skipping enrichment`);
    return {
      zones: unchangedZones,
      newZoneInsights: new Map(),
      newGlobalInsights: [],
      newFindings: [],
      pass: prevEnrichPass,
    };
  }

  console.log(`  [enrich] Per-zone mode: ${zonesToEnrich.length} zones to enrich (${unchangedZones.length} unchanged)`);

  // Process zones with limited concurrency
  const totalTokenUsage = emptyAnalyzeTokenUsage();
  const results: SingleZoneResult[] = [];
  const totalBatches = Math.ceil(zonesToEnrich.length / MAX_CONCURRENT_ZONES);

  // Process in batches of MAX_CONCURRENT_ZONES
  for (let i = 0; i < zonesToEnrich.length; i += MAX_CONCURRENT_ZONES) {
    const batch = zonesToEnrich.slice(i, i + MAX_CONCURRENT_ZONES);
    const batchIndex = Math.floor(i / MAX_CONCURRENT_ZONES);
    const batchLabel = totalBatches > 1 ? ` batch ${batchIndex + 1}/${totalBatches}` : "";
    const spinner = startSpinner(
      `  [enrich] Enriching ${batch.length} zone${batch.length === 1 ? "" : "s"}${batchLabel}...`,
    );
    let batchResults: SingleZoneResult[];
    try {
      batchResults = await Promise.all(
        batch.map((zone) => {
          const prevZone = previousZones?.zones.find(
            (p) => p.files.length > 0 && p.files.some((f) => zone.files.includes(f))
          );
          return enrichSingleZone(zone, zones, crossings, inventory, passNumber, passConfig, prevZone, fileArchetypes);
        })
      );
    } finally {
      spinner.stop();
    }
    results.push(...batchResults);
  }

  // Aggregate results
  const enrichedZones: Zone[] = [];
  const newZoneInsights = new Map<string, string[]>();
  const allNewFindings: Finding[] = [];

  for (const result of results) {
    const hash = zoneHashes.get(result.zone.id) ?? computeZoneStructureHash(result.zone);
    const enrichedZone: Zone = {
      ...result.zone,
      structureHash: hash,
      tokenUsage: result.tokenUsage,
    };
    enrichedZones.push(enrichedZone);
    newZoneInsights.set(enrichedZone.id, result.newInsights);
    allNewFindings.push(...result.newFindings);

    // Accumulate token usage
    totalTokenUsage.calls += result.tokenUsage.calls;
    totalTokenUsage.inputTokens += result.tokenUsage.input;
    totalTokenUsage.outputTokens += result.tokenUsage.output;
  }

  // Combine enriched + unchanged zones
  const allZones = [...enrichedZones, ...unchangedZones];
  deduplicateZoneIds(allZones);

  // Any failures?
  const anySuccess = results.some((r) => r.success);
  if (!anySuccess) {
    console.warn("  [enrich] All zones failed enrichment — using algorithmic data");
    return empty;
  }

  return {
    zones: allZones,
    newZoneInsights,
    newGlobalInsights: [], // Per-zone mode doesn't produce global insights on its own
    newFindings: allNewFindings,
    pass: passNumber,
    tokenUsage: totalTokenUsage,
  };
}
