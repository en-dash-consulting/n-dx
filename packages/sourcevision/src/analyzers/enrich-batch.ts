/**
 * Batch processing for AI enrichment.
 *
 * Handles single-batch enrichment with retry logic and prompt construction.
 * Also handles meta-evaluation (pass 5+) which uses a single prompt.
 */

import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type {
  Zone,
  ZoneCrossing,
  Zones,
  Finding,
  AnalyzeTokenUsage,
  ProjectProfile,
} from "../schema/index.js";

import {
  computeAttemptConfigs,
  buildMetaPrompt,
} from "./enrich-config.js";
import type { PassConfig } from "./enrich-config.js";
import { callClaude, ClaudeClientError } from "./claude-client.js";
import { tryParseJSON, extractFindings, formatFileLabel, findPrevZone } from "./enrich-parsing.js";
import { emptyAnalyzeTokenUsage, accumulateTokenUsage } from "./token-usage.js";
import { startSpinner } from "../cli/output.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Result from enriching a single batch of zones. */
export interface BatchResult {
  parsed: any;
  batchZones: Zone[];
  tokenUsage: AnalyzeTokenUsage;
}

/** Result from meta-evaluation pass. */
export interface MetaEvalResult {
  newZoneInsights: Map<string, string[]>;
  newGlobalInsights: string[];
  newFindings: Finding[];
  updatedFindings: Finding[];
  tokenUsage: AnalyzeTokenUsage;
}

// ── Meta-evaluation ──────────────────────────────────────────────────────────

/**
 * Run meta-evaluation pass (pass 5+): review existing findings and adjust
 * severities or add new cross-cutting insights.
 *
 * Returns null on auth/structural failure (caller should return empty).
 */
export async function runMetaEvaluation(
  zones: Zone[],
  existingFindings: Finding[],
  crossings: ZoneCrossing[],
  passNumber: number,
  passConfig: PassConfig,
  hints?: string,
): Promise<MetaEvalResult | null> {
  const metaSpinner = startSpinner(
    `  [enrich] Meta-evaluation pass (reviewing ${existingFindings.length} existing findings)...`,
  );
  const metaPrompt = buildMetaPrompt(zones, existingFindings, crossings, hints);
  const metaTokenUsage = emptyAnalyzeTokenUsage();

  let metaText: string;
  try {
    const callResult = await callClaude(metaPrompt);
    accumulateTokenUsage(metaTokenUsage, callResult.tokenUsage);
    metaText = callResult.text;
  } catch (err) {
    metaSpinner.stop();
    if (err instanceof ClaudeClientError) {
      if (err.reason === "auth" || err.reason === "not-found") {
        console.warn(`  [enrich] ${err.reason === "auth" ? "Authentication error" : "LLM CLI not found"} — using algorithmic names`);
        return null;
      }
      accumulateTokenUsage(metaTokenUsage, undefined);
      console.warn(`  [enrich] Meta-evaluation failed (${err.reason})`);
      return null;
    }
    throw err;
  }
  metaSpinner.stop();

  const parsed = tryParseJSON(metaText);
  if (!parsed) {
    console.warn("  [enrich] Meta-evaluation: invalid JSON response");
    return null;
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

  const newFindings = extractFindings(parsed, passNumber, passConfig.expectedTypes);

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
    newZoneInsights,
    newGlobalInsights,
    newFindings,
    updatedFindings,
    tokenUsage: metaTokenUsage,
  };
}

// ── Batch enrichment ─────────────────────────────────────────────────────────

/**
 * Enrich a single batch of zones via active LLM vendor with retry.
 * Returns the parsed response + batch zones, or null on total failure.
 * On auth error, returns { authError: true } to signal caller to stop.
 */
export async function enrichBatch(
  batchZones: Zone[],
  allZones: Zone[],
  crossingSummary: [string, number][],
  passNumber: number,
  passConfig: PassConfig,
  previousZones: Zones | undefined,
  batchIndex: number,
  totalBatches: number,
  enrichedNames?: Map<string, string>,
  fileArchetypes?: Map<string, string | null>,
  hints?: string,
  projectProfile?: ProjectProfile,
): Promise<BatchResult | null | { authError: true }> {
  const isFirstPass = passNumber === 1;
  const batchFiles = batchZones.reduce((sum, z) => sum + z.files.length, 0);
  const ATTEMPT_CONFIGS = computeAttemptConfigs(batchFiles, batchZones.length, passNumber);

  // Build 1-line summaries for zones NOT in this batch (context)
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

    const prompt = isFirstPass
      ? buildFirstPassPrompt(batchZones, config, otherContext, priorNames, crossingLines, globalPromptNote, passConfig, fileArchetypes, hints, projectProfile)
      : buildLaterPassPrompt(batchZones, config, otherContext, crossingLines, passNumber, passConfig, previousZones, globalPromptNote, fileArchetypes, hints, projectProfile);

    const promptLevel = config.maxFiles >= 8 ? "full" : config.maxFiles > 0 ? "compact" : "minimal";
    const spinner = startSpinner(
      `  [enrich]${batchLabel} Calling LLM (attempt ${attempt + 1}/${ATTEMPT_CONFIGS.length}, ${promptLevel} prompt)...`,
    );

    let callText: string;
    try {
      const callResult = await callClaude(prompt);
      accumulateTokenUsage(batchTokenUsage, callResult.tokenUsage);
      callText = callResult.text;
    } catch (err) {
      spinner.stop();
      if (err instanceof ClaudeClientError) {
        if (err.reason === "auth" || err.reason === "not-found") {
          console.warn(`  [enrich] ${err.reason === "auth" ? "Authentication error — run 'ndx config' and verify vendor credentials" : "LLM CLI not found"}`);
          console.warn(`  [enrich]   ${err.message.slice(0, 200)}`);
          return { authError: true };
        }
        accumulateTokenUsage(batchTokenUsage, undefined);
        const label = attempt < ATTEMPT_CONFIGS.length - 1 ? "retrying with simpler prompt" : "giving up on this batch";
        console.warn(`  [enrich]${batchLabel} Attempt ${attempt + 1}/${ATTEMPT_CONFIGS.length} failed (${err.reason}) — ${label}`);
        console.warn(`  [enrich]   ${err.message.slice(0, 200)}`);
        continue;
      }
      throw err;
    }
    spinner.stop();

    const candidate = tryParseJSON(callText);
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

// ── Batch result aggregation ─────────────────────────────────────────────────

/** Aggregated data from all successful batch results. */
export interface AggregatedBatchData {
  allParsedZones: any[];
  dedupedInsights: string[];
  allParsedFindings: any[];
  totalTokenUsage: AnalyzeTokenUsage;
  successfulBatchIds: Set<string>;
}

/** Aggregate token usage, parsed zones, insights, and findings from all batches. */
export function aggregateBatchResults(results: BatchResult[]): AggregatedBatchData {
  const totalTokenUsage = emptyAnalyzeTokenUsage();
  const allParsedZones: any[] = [];
  const allParsedInsights: string[] = [];
  const allParsedFindings: any[] = [];
  const successfulBatchIds = new Set<string>();

  for (const br of results) {
    // Token usage
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

    // Parsed data
    if (Array.isArray(br.parsed.zones)) {
      allParsedZones.push(...br.parsed.zones);
    }
    if (Array.isArray(br.parsed.insights)) {
      allParsedInsights.push(...br.parsed.insights.filter((s: any) => typeof s === "string"));
    }
    if (Array.isArray(br.parsed.findings)) {
      allParsedFindings.push(...br.parsed.findings);
    }

    // Track successful batch zone IDs
    for (const z of br.batchZones) {
      successfulBatchIds.add(z.id);
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

  return { allParsedZones, dedupedInsights, allParsedFindings, totalTokenUsage, successfulBatchIds };
}

// ── Prompt builders (private) ────────────────────────────────────────────────

interface AttemptConfig {
  maxFiles: number;
  maxCrossings: number;
}

/**
 * Lines a leading-comment prefix is allowed to start with. Covers the
 * documentation conventions of TS/JS/Swift/Rust/Python/Go/HTML/MD comment-only
 * lines. A blank line is treated as part of the header so we don't truncate
 * paragraph breaks inside a doc block.
 */
const COMMENT_PREFIXES = ["///", "//!", "//", "/**", "/*", "*", "*/", "#", "#!", "--", "<!--"];

/**
 * Extract the leading comment block of a file — i.e. the docstring the file's
 * author wrote at the top to explain what it does. We stop at the first
 * non-comment non-blank line and cap the output so we never blow the prompt.
 *
 * Returns `null` when the file has no leading comment block, so callers can
 * skip emitting an empty header entry.
 */
function extractFileHeader(absPath: string, maxLines = 40, maxChars = 800): string | null {
  if (!existsSync(absPath)) return null;
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
  const lines = content.split("\n", maxLines + 5);
  const kept: string[] = [];
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    // Skip a shebang on line 1.
    if (i === 0 && trimmed.startsWith("#!")) {
      kept.push(raw);
      continue;
    }
    if (trimmed === "") {
      // A blank line is acceptable as long as we've started a header — stop
      // once we see a non-comment after that.
      if (kept.length === 0) continue;
      kept.push(raw);
      continue;
    }
    if (!COMMENT_PREFIXES.some((p) => trimmed.startsWith(p))) {
      break;
    }
    kept.push(raw);
  }
  // Trim trailing blanks.
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  if (kept.length < 2) return null; // single-line headers are usually license/copyright, not useful context.
  let joined = kept.join("\n");
  if (joined.length > maxChars) joined = joined.slice(0, maxChars) + "\n  // …";
  return joined;
}

/**
 * Render a "File headers" section for the prompt — leading doc comments for
 * the files in this batch. Bounds the total bytes so a giant batch can't
 * inflate the prompt. Returns an empty string when no usable headers exist
 * (so the prompt stays compact for projects without doc comments).
 */
function formatFileHeaders(
  files: string[],
  projectDir: string,
  budgetBytes = 6000,
): string {
  const entries: string[] = [];
  let used = 0;
  for (const rel of files) {
    if (used > budgetBytes) {
      entries.push(`  - … (file-header budget exhausted; ${files.length - entries.length} files truncated)`);
      break;
    }
    const header = extractFileHeader(join(projectDir, rel));
    if (!header) continue;
    const indented = header.split("\n").map((l) => `      ${l}`).join("\n");
    const block = `  - ${rel}:\n${indented}`;
    used += block.length;
    entries.push(block);
  }
  if (entries.length === 0) return "";
  return `\nFile headers (leading doc comments — treat these as authoritative about each file's purpose; DO NOT call a documented file "undocumented"):\n${entries.join("\n")}\n`;
}

/**
 * Render a "Project shape" section for the LLM prompt that grounds the model
 * in the repo's actual ecosystem. The model uses this to suppress
 * recommendations that don't fit (e.g. don't recommend MVVM coordinators on a
 * SwiftUI app, don't propose a VERSION file when release-please is wired,
 * don't make structural calls when the import graph is absent/sparse).
 */
function formatProjectShape(p: ProjectProfile): string {
  const lines: string[] = [];

  const langLine = p.languages.length > 1
    ? `${p.primaryLanguage} (also: ${p.languages.slice(1).join(", ")})`
    : p.primaryLanguage;
  lines.push(`Primary language: ${langLine}`);

  if (p.frameworks.length > 0) {
    lines.push(`Frameworks: ${p.frameworks.join(", ")}`);
  }
  if (p.releaseInfrastructure.length > 0) {
    const kinds = p.releaseInfrastructure.map((r) => `${r.kind} (${r.evidence})`).join(", ");
    lines.push(`Release infrastructure already present: ${kinds}`);
  }
  if (p.buildSurfaces.length > 0) {
    lines.push(`Build surfaces: ${p.buildSurfaces.map((s) => s.path).join(", ")}`);
  }
  if (p.ciSurfaces.length > 0) {
    lines.push(`CI surfaces: ${p.ciSurfaces.map((s) => s.path).join(", ")}`);
  }
  lines.push(`Import graph quality: ${p.importGraphQuality}`);

  // Per-shape anti-recommendations the LLM should respect.
  const guards: string[] = [];

  if (p.importGraphQuality !== "rich") {
    guards.push(
      "Zones in this codebase were assembled from file-tree proximity (no usable import graph). " +
      "DO NOT emit structural findings about zone boundaries, coupling, or refactor placement. " +
      "Structural claims require a real import graph to be meaningful — focus instead on code-level " +
      "observations grounded in the file contents themselves.",
    );
  }

  if (p.releaseInfrastructure.length > 0) {
    const kinds = p.releaseInfrastructure.map((r) => r.kind).join(", ");
    guards.push(
      `Version management is already handled by: ${kinds}. ` +
      `DO NOT recommend introducing a VERSION file, a version constant, or a new release scheme — ` +
      `that would create a competing source of truth.`,
    );
  }

  const hasSwiftUI = p.frameworks.includes("swiftui");
  if (hasSwiftUI) {
    guards.push(
      "This is a SwiftUI codebase. DO NOT recommend MVVM coordinator/view-model patterns transplanted " +
      "from React/TS — SwiftUI's idiomatic state model is @State/@StateObject/@EnvironmentObject. " +
      "DO NOT recommend introducing service protocols solely for testability; that is a Java/TS-era reflex " +
      "and is rarely appropriate for an idiomatic SwiftUI app.",
    );
  }

  if (
    p.primaryLanguage !== "typescript" &&
    p.primaryLanguage !== "javascript" &&
    p.primaryLanguage !== "tsx" &&
    p.primaryLanguage !== "jsx"
  ) {
    guards.push(
      `This is a ${p.primaryLanguage} project, not TypeScript/JavaScript. ` +
      `DO NOT propose JS/TS framework recommendations (e.g. Combine .replaceError/.catch on a sink whose ` +
      `Failure is Never; React patterns; npm workflows). Code-level recommendations MUST be idiomatic for ${p.primaryLanguage}.`,
    );
  }

  guards.push(
    "Any finding that begins with a conditional like \"If X then Y\" is a hypothesis. " +
    "Either confirm the hypothesis from the file contents you can see and rewrite it as a fact, or omit it.",
  );

  let block = `\nProject shape:\n${lines.map((l) => `  - ${l}`).join("\n")}`;
  if (guards.length > 0) {
    block += `\n\nHard constraints derived from the project shape:\n${guards.map((g) => `  - ${g}`).join("\n")}`;
  }
  return block + "\n";
}

function buildFirstPassPrompt(
  batchZones: Zone[],
  config: AttemptConfig,
  otherContext: string,
  priorNames: string,
  crossingLines: string,
  globalPromptNote: string,
  passConfig: PassConfig,
  fileArchetypes?: Map<string, string | null>,
  hints?: string,
  projectProfile?: ProjectProfile,
): string {
  const projectShape = projectProfile ? formatProjectShape(projectProfile) : "";
  if (config.maxFiles > 0) {
    const sampledFiles: string[] = [];
    const zoneList = batchZones
      .map((z) => {
        const filesSample =
          z.files.length > config.maxFiles + 2
            ? [...z.files.slice(0, config.maxFiles), `... and ${z.files.length - config.maxFiles} more`]
            : z.files;
        for (const f of filesSample) {
          if (!f.startsWith("...") && !sampledFiles.includes(f)) sampledFiles.push(f);
        }
        const entryLine = config.maxFiles >= 8
          ? `\n  entryPoints: ${z.entryPoints.map((f) => `"${f}"`).join(", ") || "none"}`
          : "";
        return `- algorithmicId: "${z.id}" (cohesion: ${z.cohesion}, coupling: ${z.coupling}, ${z.files.length} files)\n  files: ${filesSample.map((f) => formatFileLabel(f, fileArchetypes)).join(", ")}${entryLine}`;
      })
      .join("\n");

    // Only include file-header excerpts on the full prompt; compact retries
    // (config.maxFiles < 8) drop them to stay under context budgets.
    const fileHeaders = projectProfile?.projectDir && config.maxFiles >= 8
      ? formatFileHeaders(sampledFiles, projectProfile.projectDir)
      : "";

    return `Analyze this codebase's zone structure. Each zone groups related files discovered by import-graph community detection.

${passConfig.focus}
${projectShape}
Zones:
${zoneList}
${fileHeaders}
${otherContext}
${priorNames}${hints ? `\nProject context from the developer:\n${hints}\n` : ""}
Cross-zone imports:
${crossingLines || "  (none)"}
${globalPromptNote}

Findings: severity ("info"|"warning"|"critical"), category ("structural"|"code"|"documentation").

Respond with ONLY a JSON object (no markdown, no explanation):
{"zones":[{"algorithmicId":"...","id":"kebab-case-id","name":"Title Case","description":"One sentence.","insights":["actionable insight"],"findings":[{"type":"observation","scope":"zone-id","text":"finding text","severity":"info","category":"code"}]}],"insights":["cross-zone observation"],"findings":[{"type":"observation","scope":"global","text":"finding text","severity":"info","category":"code"}]}

Return exactly ${batchZones.length} zone entries. Use finding types: ${passConfig.expectedTypes.join(", ")}.`;
  }

  // Minimal prompt (no files)
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

  return `Name these code zones. Each groups files by import structure.
${projectShape}
Zones:
${zoneList}
${otherContext}
${priorNames}${hints ? `\nProject context from the developer:\n${hints}\n` : ""}
Return ONLY JSON:
{"zones":[{"algorithmicId":"...","id":"kebab-case-id","name":"Title Case","description":"One sentence.","insights":[]}],"insights":[]}

Exactly ${batchZones.length} entries.`;
}

function buildLaterPassPrompt(
  batchZones: Zone[],
  config: AttemptConfig,
  otherContext: string,
  crossingLines: string,
  passNumber: number,
  passConfig: PassConfig,
  previousZones: Zones | undefined,
  globalPromptNote: string,
  fileArchetypes?: Map<string, string | null>,
  hints?: string,
  projectProfile?: ProjectProfile,
): string {
  const projectShape = projectProfile ? formatProjectShape(projectProfile) : "";
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
        return `- "${prev?.id ?? z.id}" (cohesion: ${z.cohesion}, coupling: ${z.coupling}, ${z.files.length} files)\n  files: ${filesSample.map((f) => formatFileLabel(f, fileArchetypes)).join(", ")}\n  known insights: ${prevInsights.slice(0, maxInsights).length > 0 ? prevInsights.slice(0, maxInsights).map((i) => `"${i}"`).join("; ") : "(none)"}`;
      })
      .join("\n");

    return `You previously analyzed this codebase. Here is the current state:
${projectShape}
Zones:
${zoneContext}
${otherContext}
${hints ? `\nProject context from the developer:\n${hints}\n` : ""}
Cross-zone imports:
${crossingLines || "  (none)"}

Previous architecture insights:
${prevGlobal.length > 0 ? prevGlobal.map((i) => `- ${i}`).join("\n") : "(none yet)"}

This is enrichment pass ${passNumber}. ${passConfig.focus}
${globalPromptNote}

Add ONLY NEW insights not already captured above. Do not repeat or rephrase existing observations.

Findings: severity ("info"|"warning"|"critical"), category ("structural"|"code"|"documentation").

Respond with ONLY a JSON object (no markdown, no explanation):
{"zones":[{"id":"existing-zone-id","newInsights":["new insight"],"findings":[{"type":"${passConfig.expectedTypes[0]}","scope":"zone-id","text":"finding text","severity":"info","category":"code"}]}],"insights":["new cross-zone observation"],"findings":[{"type":"${passConfig.expectedTypes[0]}","scope":"global","text":"finding text","severity":"info","category":"code"}]}

Return one entry per zone. Use finding types: ${passConfig.expectedTypes.join(", ")}. Empty arrays are fine if nothing new to add.`;
  }

  // Minimal prompt
  const zoneContext = batchZones
    .map((z) => {
      const prev = prevZones.find(
        (p) => p.files.length > 0 && p.files.some((f) => z.files.includes(f))
      );
      return `- "${prev?.id ?? z.id}" (${z.files.length} files)`;
    })
    .join("\n");

  return `Enrichment pass ${passNumber} for code zones. ${passConfig.focus}

Zones:
${zoneContext}
${otherContext}
${hints ? `\nProject context from the developer:\n${hints}\n` : ""}
Return ONLY JSON:
{"zones":[{"id":"zone-id","newInsights":[],"findings":[]}],"insights":[],"findings":[]}`;
}
