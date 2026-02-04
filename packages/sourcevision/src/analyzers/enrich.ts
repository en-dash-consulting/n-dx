/**
 * AI enrichment for zone analysis.
 * Orchestrator — delegates to enrich-config, claude-cli, and enrich-parsing.
 */

// ── Barrel re-exports (keep consumers' imports stable) ───────────────────────

export { PASS_CONFIGS, getPassConfig, buildMetaPrompt, computeAttemptConfigs } from "./enrich-config.js";
export type { PassConfig } from "./enrich-config.js";
export { tryCallClaude, parseStreamTokenUsage } from "./claude-cli.js";
export type { ClaudeCallResult } from "./claude-cli.js";
export { tryParseJSON, extractFindings, mergeZonesByName } from "./enrich-parsing.js";
export type { EnrichResult } from "./enrich-parsing.js";
export { emptyAnalyzeTokenUsage, accumulateTokenUsage, formatTokenUsage } from "./token-usage.js";

// ── Imports ──────────────────────────────────────────────────────────────────

import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import type {
  Inventory,
  Imports,
  Zone,
  ZoneCrossing,
  Zones,
  Finding,
  TokenUsage,
  AnalyzeTokenUsage,
} from "../schema/index.js";

import {
  ZONES_PER_BATCH,
  MAX_CONCURRENT_BATCHES,
  IDLE_TIMEOUT_MS,
  OVERALL_TIMEOUT_MS,
  getPassConfig,
  computeAttemptConfigs,
  buildMetaPrompt,
} from "./enrich-config.js";
import type { PassConfig } from "./enrich-config.js";
import { tryCallClaude } from "./claude-cli.js";
import { tryParseJSON, extractFindings, mergeZonesByName, deduplicateZoneIds } from "./enrich-parsing.js";
import type { EnrichResult } from "./enrich-parsing.js";
import { emptyAnalyzeTokenUsage, accumulateTokenUsage } from "./token-usage.js";

// ── Batch processing (private) ───────────────────────────────────────────────

/** Result from enriching a single batch of zones */
interface BatchResult {
  /** Parsed AI response */
  parsed: any;
  /** Which zones were in this batch */
  batchZones: Zone[];
  /** Token usage from Claude calls for this batch */
  tokenUsage: AnalyzeTokenUsage;
}

/**
 * Enrich a single batch of zones via Claude CLI with retry.
 * Returns the parsed response + batch zones, or null on total failure.
 * On auth error, returns { authError: true } to signal caller to stop.
 */
async function enrichBatch(
  batchZones: Zone[],
  allZones: Zone[],
  crossingSummary: [string, number][],
  passNumber: number,
  passConfig: PassConfig,
  previousZones: Zones | undefined,
  batchIndex: number,
  totalBatches: number,
  enrichedNames?: Map<string, string>,
): Promise<BatchResult | null | { authError: true }> {
  const isFirstPass = passNumber === 1;
  const batchFiles = batchZones.reduce((sum, z) => sum + z.files.length, 0);
  const ATTEMPT_CONFIGS = computeAttemptConfigs(batchFiles, batchZones.length, passNumber);

  // Build 1-line summaries for zones NOT in this batch (context)
  // Use enriched names from previous batches when available
  const batchIds = new Set(batchZones.map((z) => z.id));
  const otherSummaries = allZones
    .filter((z) => !batchIds.has(z.id))
    .map((z) => {
      const enrichedName = enrichedNames?.get(z.id);
      if (enrichedName) {
        return `"${enrichedName}" (${z.files.length} files, cohesion: ${z.cohesion})`;
      }
      return `"${z.id}" (${z.files.length} files, cohesion: ${z.cohesion})`;
    })
    .join("; ");
  const otherContext = otherSummaries
    ? `\nOther zones in this codebase (for context, not in this batch): ${otherSummaries}`
    : "";

  const isLastBatch = batchIndex === totalBatches - 1;
  const globalPromptNote = isLastBatch && totalBatches > 1
    ? "\nYou have now seen all zones. Provide any cross-zone architectural observations."
    : "";

  // Tell the LLM about names already assigned by previous batches
  const priorNames = enrichedNames && enrichedNames.size > 0
    ? `\nThe following zone names have already been assigned in previous batches:\n${[...enrichedNames.entries()].map(([algId, n]) => `  - "${n}" (algorithmicId: ${algId})`).join("\n")}\nIf a zone in this batch is semantically the SAME architectural concept as one above, reuse the EXACT same name and id to signal they should be merged. Otherwise, choose a distinct name.\n`
    : "";

  const batchLabel = totalBatches > 1 ? ` batch ${batchIndex + 1}/${totalBatches}` : "";
  const batchTokenUsage = emptyAnalyzeTokenUsage();

  for (let attempt = 0; attempt < ATTEMPT_CONFIGS.length; attempt++) {
    const config = ATTEMPT_CONFIGS[attempt];

    const crossingLines = crossingSummary
      .slice(0, config.maxCrossings)
      .map(([pair, count]) => `  ${pair}: ${count} imports`)
      .join("\n");

    let prompt: string;

    if (isFirstPass) {
      if (config.maxFiles > 0) {
        const zoneList = batchZones
          .map((z) => {
            const filesSample =
              z.files.length > config.maxFiles + 2
                ? [...z.files.slice(0, config.maxFiles), `... and ${z.files.length - config.maxFiles} more`]
                : z.files;
            const entryLine = config.maxFiles >= 8
              ? `\n  entryPoints: ${z.entryPoints.map((f) => `"${f}"`).join(", ") || "none"}`
              : "";
            return `- algorithmicId: "${z.id}" (cohesion: ${z.cohesion}, coupling: ${z.coupling}, ${z.files.length} files)\n  files: ${filesSample.map((f) => `"${f}"`).join(", ")}${entryLine}`;
          })
          .join("\n");

        prompt = `Analyze this codebase's zone structure. Each zone groups related files discovered by import-graph community detection.

${passConfig.focus}

Zones:
${zoneList}
${otherContext}
${priorNames}
Cross-zone imports:
${crossingLines || "  (none)"}
${globalPromptNote}

Each finding MUST include a "severity" field: "info" (informational), "warning" (should fix), or "critical" (must fix).

Respond with ONLY a JSON object (no markdown, no explanation):
{"zones":[{"algorithmicId":"...","id":"kebab-case-id","name":"Title Case","description":"One sentence.","insights":["actionable insight"],"findings":[{"type":"observation","scope":"zone-id","text":"finding text","severity":"info"}]}],"insights":["cross-zone observation"],"findings":[{"type":"observation","scope":"global","text":"finding text","severity":"info"}]}

Return exactly ${batchZones.length} zone entries. Use finding types: ${passConfig.expectedTypes.join(", ")}.`;
      } else {
        const zoneList = batchZones
          .map((z) => {
            const dirCounts = new Map<string, number>();
            for (const f of z.files) {
              const dir = dirname(f).split("/").slice(0, 2).join("/");
              dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
            }
            const topDirs = [...dirCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([d, n]) => `${d}(${n})`)
              .join(", ");
            return `- "${z.id}" (${z.files.length} files, cohesion: ${z.cohesion}) dirs: ${topDirs}`;
          })
          .join("\n");

        prompt = `Name these code zones. Each groups files by import structure.

Zones:
${zoneList}
${otherContext}
${priorNames}
Return ONLY JSON:
{"zones":[{"algorithmicId":"...","id":"kebab-case-id","name":"Title Case","description":"One sentence.","insights":[]}],"insights":[]}

Exactly ${batchZones.length} entries.`;
      }
    } else {
      // Pass 2+
      const prevZones = previousZones?.zones ?? [];
      const prevGlobal = previousZones?.insights ?? [];

      if (config.maxFiles > 0) {
        const zoneContext = batchZones
          .map((z) => {
            const prev = prevZones.find(
              (p) => p.files.length > 0 && p.files.some((f) => z.files.includes(f))
            );
            const prevInsights = prev?.insights ?? [];
            const maxInsights = config.maxFiles >= 8 ? prevInsights.length : Math.min(prevInsights.length, 3);
            const filesSample =
              z.files.length > config.maxFiles + 2
                ? [...z.files.slice(0, config.maxFiles), `... and ${z.files.length - config.maxFiles} more`]
                : z.files;
            return `- "${prev?.id ?? z.id}" (cohesion: ${z.cohesion}, coupling: ${z.coupling}, ${z.files.length} files)\n  files: ${filesSample.map((f) => `"${f}"`).join(", ")}\n  known insights: ${prevInsights.slice(0, maxInsights).length > 0 ? prevInsights.slice(0, maxInsights).map((i) => `"${i}"`).join("; ") : "(none)"}`;
          })
          .join("\n");

        prompt = `You previously analyzed this codebase. Here is the current state:

Zones:
${zoneContext}
${otherContext}

Cross-zone imports:
${crossingLines || "  (none)"}

Previous architecture insights:
${prevGlobal.length > 0 ? prevGlobal.map((i) => `- ${i}`).join("\n") : "(none yet)"}

This is enrichment pass ${passNumber}. ${passConfig.focus}
${globalPromptNote}

Add ONLY NEW insights not already captured above. Do not repeat or rephrase existing observations.

Each finding MUST include a "severity" field: "info" (informational), "warning" (should fix), or "critical" (must fix).

Respond with ONLY a JSON object (no markdown, no explanation):
{"zones":[{"id":"existing-zone-id","newInsights":["new insight"],"findings":[{"type":"${passConfig.expectedTypes[0]}","scope":"zone-id","text":"finding text","severity":"info"}]}],"insights":["new cross-zone observation"],"findings":[{"type":"${passConfig.expectedTypes[0]}","scope":"global","text":"finding text","severity":"info"}]}

Return one entry per zone. Use finding types: ${passConfig.expectedTypes.join(", ")}. Empty arrays are fine if nothing new to add.`;
      } else {
        const zoneContext = batchZones
          .map((z) => {
            const prev = prevZones.find(
              (p) => p.files.length > 0 && p.files.some((f) => z.files.includes(f))
            );
            return `- "${prev?.id ?? z.id}" (${z.files.length} files)`;
          })
          .join("\n");

        prompt = `Enrichment pass ${passNumber} for code zones. ${passConfig.focus}

Zones:
${zoneContext}
${otherContext}

Return ONLY JSON:
{"zones":[{"id":"zone-id","newInsights":[],"findings":[]}],"insights":[],"findings":[]}`;
      }
    }

    const promptLevel = config.maxFiles >= 8 ? "full" : config.maxFiles > 0 ? "compact" : "minimal";
    console.log(`  [enrich]${batchLabel} Calling Claude (attempt ${attempt + 1}/${ATTEMPT_CONFIGS.length}, ${promptLevel} prompt, ${Math.round(IDLE_TIMEOUT_MS / 60_000)}m idle / ${Math.round(OVERALL_TIMEOUT_MS / 60_000)}m max)...`);

    const callResult = await tryCallClaude(prompt, config.timeout);
    accumulateTokenUsage(batchTokenUsage, callResult.ok ? callResult.tokenUsage : undefined);

    if (!callResult.ok) {
      if (callResult.reason === "auth") {
        console.warn("  [enrich] Authentication error — run 'claude login' or check API key");
        if (callResult.detail) console.warn(`  [enrich]   ${callResult.detail.slice(0, 200)}`);
        return { authError: true };
      }
      const label = attempt < ATTEMPT_CONFIGS.length - 1 ? "retrying with simpler prompt" : "giving up on this batch";
      console.warn(`  [enrich]${batchLabel} Attempt ${attempt + 1}/${ATTEMPT_CONFIGS.length} failed (${callResult.reason}) — ${label}`);
      if (callResult.detail) console.warn(`  [enrich]   ${callResult.detail.slice(0, 200)}`);
      continue;
    }

    const candidate = tryParseJSON(callResult.response);
    if (!candidate) {
      const label = attempt < ATTEMPT_CONFIGS.length - 1 ? "retrying with simpler prompt" : "giving up on this batch";
      console.warn(`  [enrich]${batchLabel} Attempt ${attempt + 1}/${ATTEMPT_CONFIGS.length}: invalid JSON response — ${label}`);
      continue;
    }

    if (!Array.isArray(candidate.zones) || candidate.zones.length === 0) {
      const label = attempt < ATTEMPT_CONFIGS.length - 1 ? "retrying" : "giving up on this batch";
      console.warn(`  [enrich]${batchLabel} Attempt ${attempt + 1}/${ATTEMPT_CONFIGS.length}: no zones in response — ${label}`);
      continue;
    }

    if (attempt > 0) {
      console.log(`  [enrich]${batchLabel} Succeeded on attempt ${attempt + 1}`);
    }
    return { parsed: candidate, batchZones, tokenUsage: batchTokenUsage };
  }

  console.warn(`  [enrich]${batchLabel} All attempts exhausted — keeping algorithmic names for this batch`);
  return null;
}

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
  previousZones?: Zones
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

  // 1. Check for claude CLI
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
  } catch {
    console.warn("  [enrich] claude CLI not found — using algorithmic names");
    return empty;
  }

  // 1b. Meta-evaluation path (pass 5+) — single prompt, no batching
  if (isMetaPass && existingFindings.length > 0) {
    console.log(`  [enrich] Meta-evaluation pass (reviewing ${existingFindings.length} existing findings)...`);
    const metaPrompt = buildMetaPrompt(zones, existingFindings, crossings);
    const ATTEMPT_CONFIGS = computeAttemptConfigs(
      zones.reduce((s, z) => s + z.files.length, 0), zones.length, passNumber
    );
    const config = ATTEMPT_CONFIGS[0];
    const metaTokenUsage = emptyAnalyzeTokenUsage();

    const callResult = await tryCallClaude(metaPrompt, config.timeout);
    accumulateTokenUsage(metaTokenUsage, callResult.ok ? callResult.tokenUsage : undefined);
    if (!callResult.ok) {
      console.warn(`  [enrich] Meta-evaluation failed (${callResult.reason})`);
      return { ...empty, tokenUsage: metaTokenUsage };
    }

    const parsed = tryParseJSON(callResult.response);
    if (!parsed) {
      console.warn("  [enrich] Meta-evaluation: invalid JSON response");
      return empty;
    }

    // Apply severity updates to existing findings
    const updatedFindings = [...existingFindings];
    if (Array.isArray(parsed.severityUpdates)) {
      const validSeverities = ["info", "warning", "critical"];
      for (const update of parsed.severityUpdates) {
        if (
          update && typeof update.findingIndex === "number" &&
          update.findingIndex >= 0 && update.findingIndex < updatedFindings.length &&
          validSeverities.includes(update.newSeverity)
        ) {
          updatedFindings[update.findingIndex] = {
            ...updatedFindings[update.findingIndex],
            severity: update.newSeverity,
          };
        }
      }
    }

    // Extract new findings from meta-evaluation
    const newFindings = extractFindings(parsed, passNumber, passConfig.expectedTypes);

    // Extract new zone insights
    const newZoneInsights = new Map<string, string[]>();
    if (Array.isArray(parsed.zones)) {
      for (const z of parsed.zones) {
        if (z && typeof z === "object" && typeof z.id === "string") {
          const newInsights = Array.isArray(z.newInsights)
            ? z.newInsights.filter((s: any) => typeof s === "string")
            : [];
          newZoneInsights.set(z.id, newInsights);
        }
      }
    }

    const newGlobalInsights: string[] = Array.isArray(parsed.insights)
      ? parsed.insights.filter((s: any) => typeof s === "string")
      : [];

    return {
      zones,
      newZoneInsights,
      newGlobalInsights,
      newFindings: newFindings,
      pass: passNumber,
      _updatedFindings: updatedFindings,
      tokenUsage: metaTokenUsage,
    };
  }

  // 2. Build cross-zone summary (shared across all batches)
  const crossingSummary = new Map<string, number>();
  for (const c of crossings) {
    const key = `${c.fromZone} \u2192 ${c.toZone}`;
    crossingSummary.set(key, (crossingSummary.get(key) ?? 0) + 1);
  }
  const sortedCrossingsArr: [string, number][] = [...crossingSummary.entries()]
    .sort((a, b) => b[1] - a[1]);

  // 3. Split zones into batches
  const batches: Zone[][] = [];
  for (let i = 0; i < zones.length; i += ZONES_PER_BATCH) {
    batches.push(zones.slice(i, i + ZONES_PER_BATCH));
  }

  if (batches.length > 1) {
    console.log(`  [enrich] Processing ${zones.length} zones in ${batches.length} batches of up to ${ZONES_PER_BATCH}`);
  }

  // 4. Process batches sequentially, feeding enriched names forward
  const allBatchResults: BatchResult[] = [];
  const enrichedNames = new Map<string, string>();
  let authFailed = false;

  for (let bi = 0; bi < batches.length; bi++) {
    if (authFailed) break;

    try {
      const result = await enrichBatch(
        batches[bi], zones, sortedCrossingsArr,
        passNumber, passConfig, previousZones, bi, batches.length,
        enrichedNames,
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

  // If auth failed and no batches succeeded, return empty
  if (authFailed && allBatchResults.length === 0) {
    return empty;
  }

  // If no batches succeeded at all, return empty
  if (allBatchResults.length === 0) {
    console.warn("  [enrich] All batches failed — using algorithmic names");
    return empty;
  }

  // 5. Aggregate token usage across all batches
  const totalTokenUsage = emptyAnalyzeTokenUsage();
  for (const br of allBatchResults) {
    totalTokenUsage.calls += br.tokenUsage.calls;
    totalTokenUsage.inputTokens += br.tokenUsage.inputTokens;
    totalTokenUsage.outputTokens += br.tokenUsage.outputTokens;
    if (br.tokenUsage.cacheCreationInputTokens) {
      totalTokenUsage.cacheCreationInputTokens =
        (totalTokenUsage.cacheCreationInputTokens ?? 0) + br.tokenUsage.cacheCreationInputTokens;
    }
    if (br.tokenUsage.cacheReadInputTokens) {
      totalTokenUsage.cacheReadInputTokens =
        (totalTokenUsage.cacheReadInputTokens ?? 0) + br.tokenUsage.cacheReadInputTokens;
    }
  }

  // 6. Merge all batch results
  // Build a combined "parsed" response from all successful batches
  const allParsedZones: any[] = [];
  const allParsedInsights: string[] = [];
  const allParsedFindings: any[] = [];

  for (const br of allBatchResults) {
    if (Array.isArray(br.parsed.zones)) {
      allParsedZones.push(...br.parsed.zones);
    }
    if (Array.isArray(br.parsed.insights)) {
      allParsedInsights.push(...br.parsed.insights.filter((s: any) => typeof s === "string"));
    }
    if (Array.isArray(br.parsed.findings)) {
      allParsedFindings.push(...br.parsed.findings);
    }
  }

  // Deduplicate global insights
  const seenInsights = new Set<string>();
  const dedupedInsights: string[] = [];
  for (const insight of allParsedInsights) {
    if (!seenInsights.has(insight)) {
      seenInsights.add(insight);
      dedupedInsights.push(insight);
    }
  }

  // Set of zone IDs that were in successful batches
  const successfulBatchIds = new Set<string>();
  for (const br of allBatchResults) {
    for (const z of br.batchZones) {
      successfulBatchIds.add(z.id);
    }
  }

  // 6. Apply results
  if (isFirstPass) {
    const enrichedRaw: Zone[] = zones.map((zone, i) => {
      // If this zone's batch failed, keep it unchanged
      if (!successfulBatchIds.has(zone.id)) {
        return zone;
      }
      const e =
        allParsedZones.find((x: any) => x?.algorithmicId === zone.id) ??
        (allParsedZones[i] && successfulBatchIds.has(zone.id) ? undefined : undefined);
      if (
        !e ||
        typeof e.id !== "string" ||
        typeof e.name !== "string" ||
        typeof e.description !== "string"
      ) {
        return zone;
      }
      return {
        ...zone,
        id: e.id,
        name: e.name,
        description: e.description,
      };
    });

    // Merge zones the LLM identified as semantically identical across batches
    const enriched = mergeZonesByName(enrichedRaw);
    if (enriched.length < enrichedRaw.length) {
      console.log(`  [enrich] Merged ${enrichedRaw.length - enriched.length} duplicate zones (${enrichedRaw.length} → ${enriched.length})`);
    }

    deduplicateZoneIds(enriched);

    // Extract per-zone AI insights
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

    const combinedParsed = {
      zones: allParsedZones,
      insights: dedupedInsights,
      findings: allParsedFindings,
    };
    const newFindings = extractFindings(combinedParsed, 1, passConfig.expectedTypes);

    return {
      zones: enriched,
      newZoneInsights,
      newGlobalInsights: dedupedInsights,
      newFindings: newFindings,
      pass: 1,
      tokenUsage: totalTokenUsage,
    };
  }

  // Pass 2+: only new insights, no renaming
  const prevZones = previousZones?.zones ?? [];
  const enriched: Zone[] = zones.map((zone) => {
    const prev = prevZones.find(
      (p) => p.files.length > 0 && p.files.some((f) => zone.files.includes(f))
    );
    if (prev) {
      return {
        ...zone,
        id: prev.id,
        name: prev.name,
        description: prev.description,
      };
    }
    return zone;
  });

  deduplicateZoneIds(enriched);

  // Extract new per-zone AI insights
  const newZoneInsights = new Map<string, string[]>();
  for (const zone of enriched) {
    const entry = allParsedZones.find((n: any) => n?.id === zone.id);
    const newInsights = Array.isArray(entry?.newInsights)
      ? entry.newInsights.filter((s: any) => typeof s === "string")
      : [];
    newZoneInsights.set(zone.id, newInsights);
  }

  const combinedParsed = {
    zones: allParsedZones,
    insights: dedupedInsights,
    findings: allParsedFindings,
  };
  const newFindings = extractFindings(combinedParsed, passNumber, passConfig.expectedTypes);

  return {
    zones: enriched,
    newZoneInsights,
    newGlobalInsights: dedupedInsights,
    newFindings: newFindings,
    pass: passNumber,
    tokenUsage: totalTokenUsage,
  };
}
