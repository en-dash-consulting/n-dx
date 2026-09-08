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
import { tryParseJSON, extractFindings, deduplicateZoneIds, formatFileLabel, extractZoneInsights, findPrevZone } from "./enrich-parsing.js";
import {emptyAnalyzeTokenUsage} from "./token-usage.js";import { startSpinner } from "../cli/output.js";
import type { PromptEnvelope } from "@n-dx/llm-client";
import {
  section,
  svPromptEnvelope,
  svPrompt,
  logSvPromptSections,
  JSON_OBJECT_ONLY,
  ONLY_NEW_INSIGHTS,
  findingsContract,
} from "./prompt-envelope.js";

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
/** Everything the two per-zone prompts read, already rendered. */
interface SingleZonePromptContext {
  zone: Zone;
  config: { maxFiles: number; maxCrossings: number };
  passConfig: PassConfig;
  /** Rendered file list for this attempt's sampling budget. */
  filesStr: string;
  /** One-line summaries of the other zones. */
  otherContext: string;
  /** Rendered boundary-crossing table. */
  crossingLines: string;
  /** Operator hints from config. */
  hints?: string;
  /** Which enrichment pass this is (later-pass only). */
  passNumber?: number;
  /** What the previous pass concluded about this zone (later-pass only). */
  previousZone?: Zone;
}

/**
 * First-pass prompt for a single zone — name it and describe it.
 *
 * Extracted from {@link enrichSingleZone}, which built both prompts inline in
 * its retry loop. Exported so their section costs appear in the same report as
 * every other prompt surface: per-zone enrichment is the fallback path for
 * repositories where batch enrichment is too coarse, so it runs once per zone
 * and its cost scales with the repository.
 */
export function buildSingleZoneFirstPassEnvelope(
  ctx: SingleZonePromptContext,
): PromptEnvelope {
  const { zone, config, passConfig } = ctx;
  const entryLine = config.maxFiles >= 8
    ? `\nEntry points: ${zone.entryPoints.map((f) => `"${f}"`).join(", ") || "none"}`
    : "";

  return svPromptEnvelope([
    section(
      "role",
      "Analyze this code zone. It was discovered by import-graph community detection.",
    ),
    section("rules", passConfig.focus),
    section(
      "input",
      `Zone: "${zone.id}" (cohesion: ${zone.cohesion}, coupling: ${zone.coupling}, ${zone.files.length} files)\n` +
        `Files: ${ctx.filesStr}${entryLine}`,
    ),
    section("other-zones", ctx.otherContext),
    section("hints", ctx.hints ? `Project context from the developer:\n${ctx.hints}` : ""),
    section("crossings", `Boundary crossings:\n${ctx.crossingLines || "  (none)"}`),
    section(
      "output",
      [
        findingsContract(false),
        "",
        JSON_OBJECT_ONLY,
        `{"id":"kebab-case-id","name":"Title Case Name","description":"One sentence describing the zone's purpose.","insights":["actionable insight about this zone"],"findings":[{"type":"observation","scope":"${zone.id}","text":"finding text","severity":"info"}]}`,
        "",
        `Use finding types: ${passConfig.expectedTypes.join(", ")}.`,
      ].join("\n"),
    ),
  ]);
}

/** Later-pass prompt for a single zone — add only what pass 1 missed. */
export function buildSingleZoneLaterPassEnvelope(
  ctx: SingleZonePromptContext,
): PromptEnvelope {
  const { zone, config, passConfig } = ctx;
  const prevInsights = ctx.previousZone?.insights ?? [];
  const maxInsights = config.maxFiles >= 8
    ? prevInsights.length
    : Math.min(prevInsights.length, 3);
  const shown = prevInsights.slice(0, maxInsights);

  return svPromptEnvelope([
    section("role", "You previously analyzed this zone. Here is the current state:"),
    section(
      "input",
      [
        `Zone: "${zone.id}" (cohesion: ${zone.cohesion}, coupling: ${zone.coupling}, ${zone.files.length} files)`,
        `Files: ${ctx.filesStr}`,
        `Known insights: ${shown.length > 0 ? shown.map((i) => `"${i}"`).join("; ") : "(none)"}`,
      ].join("\n"),
    ),
    section("other-zones", ctx.otherContext),
    section("hints", ctx.hints ? `Project context from the developer:\n${ctx.hints}` : ""),
    section("crossings", `Boundary crossings:\n${ctx.crossingLines || "  (none)"}`),
    section(
      "rules",
      `This is enrichment pass ${ctx.passNumber}. ${passConfig.focus}`,
    ),
    section(
      "output",
      [
        ONLY_NEW_INSIGHTS,
        "",
        findingsContract(false),
        "",
        // Was "Respond with ONLY a JSON object:" — the one builder of four that
        // dropped the parenthetical, so this path alone did not forbid markdown.
        JSON_OBJECT_ONLY,
        `{"id":"${zone.id}","newInsights":["new insight"],"findings":[{"type":"${passConfig.expectedTypes[0]}","scope":"${zone.id}","text":"finding text","severity":"info"}]}`,
        "",
        `Use finding types: ${passConfig.expectedTypes.join(", ")}. Empty arrays are fine if nothing new to add.`,
      ].join("\n"),
    ),
  ]);
}

async function enrichSingleZone(
  zone: Zone,
  allZones: Zone[],
  crossings: ZoneCrossing[],
  inventory: Inventory,
  passNumber: number,
  passConfig: PassConfig,
  previousZone?: Zone,
  fileArchetypes?: Map<string, string | null>,
  hints?: string,
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

    const filesSample = zone.files.length > config.maxFiles + 2
      ? [...zone.files.slice(0, config.maxFiles), `... and ${zone.files.length - config.maxFiles} more`]
      : zone.files;
    const filesStr = filesSample.map((f) => formatFileLabel(f, fileArchetypes)).join(", ");

    const envelope = isFirstPass
      ? buildSingleZoneFirstPassEnvelope({
        zone,
        config,
        passConfig,
        filesStr,
        otherContext,
        crossingLines,
        hints,
      })
      : buildSingleZoneLaterPassEnvelope({
        zone,
        config,
        passConfig,
        passNumber,
        filesStr,
        otherContext,
        crossingLines,
        previousZone,
        hints,
      });
    const prompt = svPrompt(envelope);

    const promptLevel = config.maxFiles >= PER_ZONE_MAX_FILES ? "full" : config.maxFiles >= 8 ? "medium" : "minimal";
    console.log(`  [enrich] Zone "${zone.id}" (attempt ${attempt + 1}/${ATTEMPT_CONFIGS.length}, ${promptLevel} prompt)...`);
    logSvPromptSections(`enrichSingleZone "${zone.id}" pass ${passNumber} (${promptLevel})`, envelope);

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
      if (!candidate.id || !candidate.name || !candidate.description) {
        const label = attempt < ATTEMPT_CONFIGS.length - 1 ? "retrying" : "giving up";
        console.warn(`  [enrich] Zone "${zone.id}" attempt ${attempt + 1}: missing id/name/description — ${label}`);
        continue;
      }
      const enrichedZone: Zone = {
        ...zone,
        id: candidate.id,
        name: candidate.name,
        description: candidate.description,
      };
      const newInsights = extractZoneInsights(candidate, "insights");
      const newFindings = extractFindings({ zones: [candidate], findings: candidate.findings ?? [] }, passNumber, passConfig.expectedTypes);
      return { zone: enrichedZone, newInsights, newFindings, tokenUsage: zoneTokenUsage, success: true };
    }

    // Pass 2+: preserve zone identity, extract new insights
    const newInsights = extractZoneInsights(candidate, "newInsights");
    const newFindings = extractFindings({ zones: [candidate], findings: candidate.findings ?? [] }, passNumber, passConfig.expectedTypes);
    return { zone, newInsights, newFindings, tokenUsage: zoneTokenUsage, success: true };
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
  hints?: string,
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
    const prevZone = findPrevZone(previousZones?.zones, zone);

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
          const prevZone = findPrevZone(previousZones?.zones, zone);
          return enrichSingleZone(zone, zones, crossings, inventory, passNumber, passConfig, prevZone, fileArchetypes, hints);
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
    enrichedZones.push({
      ...result.zone,
      structureHash: hash,
      tokenUsage: result.tokenUsage,
    });
    newZoneInsights.set(result.zone.id, result.newInsights);
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
