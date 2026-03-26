/**
 * File classification engine.
 *
 * Classifies each source file against the archetype catalog by matching
 * weighted signals (path patterns, directory patterns, filename patterns,
 * export patterns) and accumulating evidence scores.
 *
 * The highest-scoring archetype above the confidence threshold becomes
 * the primary classification. Additional archetypes above a secondary
 * threshold are recorded as secondaryArchetypes.
 */

import { basename } from "node:path";
import type {
  Inventory,
  Imports,
  ImportEdge,
  ArchetypeDefinition,
  ArchetypeSignal,
  FileClassification,
  ClassificationEvidence,
  Classifications,
  ClassificationsSummary,
  AnalyzeTokenUsage,
} from "../schema/index.js";
import { BUILTIN_ARCHETYPES } from "./archetypes.js";
import { sortClassifications } from "../util/sort.js";
import { callClaude, ClaudeClientError } from "./claude-client.js";
import { emptyAnalyzeTokenUsage, accumulateTokenUsage } from "./token-usage.js";
import { startSpinner } from "../cli/output.js";

/** Minimum accumulated score for a primary classification. */
const PRIMARY_THRESHOLD = 0.4;

/** Minimum accumulated score for a secondary classification. */
const SECONDARY_THRESHOLD = 0.3;

export interface ClassifyOptions {
  /** Previous classifications for incremental mode. */
  previousClassifications?: Classifications;
  /** Changed files (from inventory diff) — only reclassify these. */
  changedFiles?: Set<string>;
  /** Custom archetypes to merge with built-ins. */
  customArchetypes?: ArchetypeDefinition[];
  /** Per-file overrides: path → archetype ID. */
  overrides?: Record<string, string>;
  /** Detected project language (e.g. "go", "typescript"). Signals with a `languages` filter only fire when the project language matches. */
  projectLanguage?: string;
  /**
   * All detected project languages, ordered primary-first (e.g. `["go", "typescript"]`).
   * When provided, archetype signals with a `languages` filter fire if ANY of these
   * languages match. Falls back to `[projectLanguage]` when omitted.
   */
  projectLanguages?: string[];
}

/**
 * Classify all source files against the archetype catalog.
 */
export function analyzeClassifications(
  inventory: Inventory,
  imports: Imports,
  options?: ClassifyOptions,
): Classifications {
  const archetypes = mergeArchetypes(
    BUILTIN_ARCHETYPES,
    options?.customArchetypes,
  );

  // Build export map: file → exported symbol names
  const exportMap = buildExportMap(imports.edges);

  // Determine which files need reclassification
  const previousMap = new Map<string, FileClassification>();
  if (options?.previousClassifications) {
    for (const fc of options.previousClassifications.files) {
      previousMap.set(fc.path, fc);
    }
  }

  const sourceFiles = inventory.files.filter((f) => f.role === "source");
  const classifications: FileClassification[] = [];

  for (const file of sourceFiles) {
    // User override takes highest priority
    if (options?.overrides?.[file.path]) {
      const archetypeId = options.overrides[file.path];
      const valid = archetypes.some((a) => a.id === archetypeId);
      classifications.push({
        path: file.path,
        archetype: valid ? archetypeId : null,
        confidence: valid ? 1.0 : 0,
        source: "user-override",
      });
      continue;
    }

    // Incremental: reuse cached classification for unchanged files
    if (
      options?.changedFiles &&
      !options.changedFiles.has(file.path) &&
      previousMap.has(file.path)
    ) {
      const prev = previousMap.get(file.path)!;
      // Don't reuse user overrides that were removed
      if (prev.source !== "user-override" || options?.overrides?.[file.path]) {
        classifications.push(prev);
        continue;
      }
    }

    // Classify the file — prefer projectLanguages array over single projectLanguage
    const effectiveLanguages = options?.projectLanguages
      ?? (options?.projectLanguage ? [options.projectLanguage] : undefined);
    const result = classifyFile(
      file.path,
      archetypes,
      exportMap.get(file.path),
      effectiveLanguages,
    );
    classifications.push(result);
  }

  const summary = computeSummary(classifications);

  return sortClassifications({
    archetypes,
    files: classifications,
    summary,
  });
}

/**
 * Classify a single file against all archetypes.
 */
function classifyFile(
  filePath: string,
  archetypes: ArchetypeDefinition[],
  exports?: string[],
  projectLanguages?: string[],
): FileClassification {
  const fileName = basename(filePath);
  const evidence: ClassificationEvidence[] = [];

  // Accumulate scores per archetype
  const scores = new Map<string, number>();

  for (const archetype of archetypes) {
    let archetypeScore = 0;

    for (const signal of archetype.signals) {
      // Skip signals scoped to languages that don't match any project language
      if (signal.languages && signal.languages.length > 0 && projectLanguages && projectLanguages.length > 0) {
        if (!projectLanguages.some((lang) => signal.languages!.includes(lang))) continue;
      }

      const match = matchSignal(signal, filePath, fileName, exports);
      if (match) {
        archetypeScore += signal.weight;
        evidence.push({
          archetypeId: archetype.id,
          signalKind: signal.kind,
          detail: match,
          weight: signal.weight,
        });
      }
    }

    if (archetypeScore > 0) {
      scores.set(archetype.id, archetypeScore);
    }
  }

  // Find primary archetype (highest score above threshold)
  let primaryId: string | null = null;
  let primaryScore = 0;
  for (const [id, score] of scores) {
    if (score > primaryScore) {
      primaryScore = score;
      primaryId = id;
    }
  }

  if (primaryScore < PRIMARY_THRESHOLD) {
    primaryId = null;
    primaryScore = 0;
  }

  // Find secondary archetypes (above secondary threshold, not primary)
  const secondaryArchetypes: string[] = [];
  for (const [id, score] of scores) {
    if (id !== primaryId && score >= SECONDARY_THRESHOLD) {
      secondaryArchetypes.push(id);
    }
  }
  secondaryArchetypes.sort();

  // Normalize confidence to 0-1 range (cap at 1.0)
  const confidence = Math.min(primaryScore, 1.0);

  return {
    path: filePath,
    archetype: primaryId,
    ...(secondaryArchetypes.length > 0 ? { secondaryArchetypes } : {}),
    confidence: Math.round(confidence * 100) / 100,
    source: "algorithmic" as const,
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}

/**
 * Match a single signal against a file. Returns a description string if matched.
 */
function matchSignal(
  signal: ArchetypeSignal,
  filePath: string,
  fileName: string,
  exports?: string[],
): string | null {
  const re = new RegExp(signal.pattern);

  switch (signal.kind) {
    case "path":
      if (re.test(filePath)) return `path matches ${signal.pattern}`;
      return null;

    case "filename":
      if (re.test(fileName)) return `filename "${fileName}" matches ${signal.pattern}`;
      return null;

    case "directory":
      // Directory signals use string containment for simple patterns
      if (filePath.includes(signal.pattern)) return `path contains "${signal.pattern}"`;
      return null;

    case "export":
      if (!exports) return null;
      for (const sym of exports) {
        if (re.test(sym)) return `exports "${sym}" matching ${signal.pattern}`;
      }
      return null;

    case "import":
      // Import signal matching would require the full import graph
      // For now, handle via evidence from the import data
      return null;

    default:
      return null;
  }
}

/**
 * Build a map of file → exported symbol names from re-export edges.
 * This captures symbols available for export-based classification.
 */
function buildExportMap(edges: ImportEdge[]): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.type === "reexport") {
      // The source file exports these symbols
      let list = result.get(edge.to);
      if (!list) {
        list = [];
        result.set(edge.to, list);
      }
      for (const sym of edge.symbols) {
        if (!list.includes(sym)) list.push(sym);
      }
    }
  }

  return result;
}

/**
 * Merge custom archetypes with built-ins. Custom archetypes with the same ID
 * override the built-in definition.
 */
function mergeArchetypes(
  builtins: ArchetypeDefinition[],
  custom?: ArchetypeDefinition[],
): ArchetypeDefinition[] {
  if (!custom || custom.length === 0) return [...builtins];

  const merged = new Map<string, ArchetypeDefinition>();
  for (const a of builtins) merged.set(a.id, a);
  for (const a of custom) merged.set(a.id, a);
  return [...merged.values()];
}

/**
 * Compute summary statistics from classifications.
 */
function computeSummary(files: FileClassification[]): ClassificationsSummary {
  const byArchetype: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let totalClassified = 0;
  let totalUnclassified = 0;

  for (const fc of files) {
    if (fc.archetype) {
      totalClassified++;
      byArchetype[fc.archetype] = (byArchetype[fc.archetype] ?? 0) + 1;
    } else {
      totalUnclassified++;
    }
    bySource[fc.source] = (bySource[fc.source] ?? 0) + 1;
  }

  return { totalClassified, totalUnclassified, byArchetype, bySource };
}

// ── LLM-assisted classification ─────────────────────────────────────────────

export interface LLMClassifyResult {
  updatedFiles: FileClassification[];
  tokenUsage: AnalyzeTokenUsage;
}

/** Maximum files per LLM batch. */
const LLM_BATCH_SIZE = 30;

/**
 * Enrich unclassified files by asking the LLM to assign archetypes.
 * Runs after the algorithmic pass. Files the LLM can't classify stay null.
 */
export async function enrichClassificationsWithLLM(
  classifications: Classifications,
  inventory: Inventory,
  imports: Imports,
): Promise<LLMClassifyResult> {
  const tokenUsage = emptyAnalyzeTokenUsage();
  const updatedFiles: FileClassification[] = [];

  // Collect unclassified files (null archetype, algorithmic source)
  const unclassified = classifications.files.filter(
    (f) => f.archetype === null && f.source === "algorithmic",
  );

  if (unclassified.length === 0) {
    return { updatedFiles, tokenUsage };
  }

  // Build archetype catalog for the prompt
  const archetypeCatalog = classifications.archetypes.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
  }));

  // Batch unclassified files
  const batches: FileClassification[][] = [];
  for (let i = 0; i < unclassified.length; i += LLM_BATCH_SIZE) {
    batches.push(unclassified.slice(i, i + LLM_BATCH_SIZE));
  }

  // Valid archetype IDs for validation
  const validIds = new Set(classifications.archetypes.map((a) => a.id));

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const batchLabel = batches.length > 1 ? ` batch ${batchIdx + 1}/${batches.length}` : "";

    const result = await classifyBatchWithLLM(
      batch,
      archetypeCatalog,
      validIds,
      batchLabel,
      tokenUsage,
    );

    if (result === "auth-error") {
      // Stop all batches on auth/not-found error
      break;
    }

    if (result) {
      updatedFiles.push(...result);
    }
  }

  return { updatedFiles, tokenUsage };
}

/** Attempt configs for retry degradation. */
interface LLMClassifyAttemptConfig {
  includeDescriptions: boolean;
  maxFiles: number;
}

function computeLLMClassifyAttempts(batchSize: number): LLMClassifyAttemptConfig[] {
  return [
    { includeDescriptions: true, maxFiles: batchSize },
    { includeDescriptions: false, maxFiles: batchSize },
    { includeDescriptions: false, maxFiles: Math.min(15, batchSize) },
  ];
}

/**
 * Classify a single batch of files via Claude with retry.
 * Returns classified files, null on total failure, or "auth-error" to signal stop.
 */
async function classifyBatchWithLLM(
  batch: FileClassification[],
  archetypeCatalog: { id: string; name: string; description: string }[],
  validIds: Set<string>,
  batchLabel: string,
  tokenUsage: AnalyzeTokenUsage,
): Promise<FileClassification[] | null | "auth-error"> {
  const attempts = computeLLMClassifyAttempts(batch.length);

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const config = attempts[attempt];
    const filesToClassify = batch.slice(0, config.maxFiles);

    const prompt = buildLLMClassifyPrompt(filesToClassify, archetypeCatalog, config.includeDescriptions);
    const promptLevel = config.includeDescriptions ? "full" : "compact";
    const spinner = startSpinner(
      `  [classify]${batchLabel} Calling LLM (attempt ${attempt + 1}/${attempts.length}, ${promptLevel} prompt, ${filesToClassify.length} files)...`,
    );

    let callText: string;
    try {
      const callResult = await callClaude(prompt);
      accumulateTokenUsage(tokenUsage, callResult.tokenUsage);
      callText = callResult.text;
    } catch (err) {
      spinner.stop();
      if (err instanceof ClaudeClientError) {
        if (err.reason === "auth" || err.reason === "not-found") {
          console.warn(`  [classify] ${err.reason === "auth" ? "Authentication error — run 'ndx config' and verify vendor credentials" : "LLM CLI not found"}`);
          console.warn(`  [classify]   ${err.message.slice(0, 200)}`);
          return "auth-error";
        }
        accumulateTokenUsage(tokenUsage, undefined);
        const label = attempt < attempts.length - 1 ? "retrying with simpler prompt" : "giving up on this batch";
        console.warn(`  [classify]${batchLabel} Attempt ${attempt + 1}/${attempts.length} failed (${err.reason}) — ${label}`);
        continue;
      }
      throw err;
    }
    spinner.stop();

    // Parse JSON array response
    const parsed = tryParseClassifyResponse(callText);
    if (!parsed || parsed.length === 0) {
      const label = attempt < attempts.length - 1 ? "retrying with simpler prompt" : "giving up on this batch";
      console.warn(`  [classify]${batchLabel} Attempt ${attempt + 1}/${attempts.length}: invalid response — ${label}`);
      continue;
    }

    // Map results back to FileClassification objects
    const pathSet = new Set(filesToClassify.map((f) => f.path));
    const results: FileClassification[] = [];

    for (const item of parsed) {
      if (!item.path || !pathSet.has(item.path)) continue;
      if (!item.archetype || !validIds.has(item.archetype)) continue;

      results.push({
        path: item.path,
        archetype: item.archetype,
        confidence: 0.7,
        source: "llm" as const,
        evidence: item.reason
          ? [{ archetypeId: item.archetype, signalKind: "path" as const, detail: item.reason, weight: 0.7 }]
          : undefined,
      });
    }

    if (attempt > 0 && results.length > 0) {
      console.log(`  [classify]${batchLabel} Succeeded on attempt ${attempt + 1}`);
    }

    return results;
  }

  console.warn(`  [classify]${batchLabel} All attempts exhausted — leaving files unclassified`);
  return null;
}

/**
 * Build the LLM prompt for file classification.
 */
function buildLLMClassifyPrompt(
  files: FileClassification[],
  archetypes: { id: string; name: string; description: string }[],
  includeDescriptions: boolean,
): string {
  const archetypeLines = archetypes.map((a) =>
    includeDescriptions
      ? `- ${a.id}: ${a.name} — ${a.description}`
      : `- ${a.id}: ${a.name}`,
  ).join("\n");

  const fileLines = files.map((f, i) => {
    const parts = [`${i + 1}. ${f.path}`];
    // Include partial evidence from algorithmic pass if available
    if (f.evidence && f.evidence.length > 0) {
      const hints = f.evidence
        .slice(0, 3)
        .map((e) => `${e.archetypeId}(${e.weight})`)
        .join(", ");
      parts.push(`  [partial signals: ${hints}]`);
    }
    return parts.join("");
  }).join("\n");

  return `Classify these source files into archetypes. Each archetype represents a structural role in the codebase.

Available archetypes:
${archetypeLines}

Files to classify:
${fileLines}

For each file, determine the best-fit archetype based on its path, directory structure, and likely purpose. If no archetype fits well, omit the file from the response.

Respond with ONLY a JSON array (no markdown fences, no explanation):
[{"path":"<file path>","archetype":"<archetype id>","reason":"<brief reason>"}]`;
}

/**
 * Parse the LLM response as a JSON array of classification results.
 */
function tryParseClassifyResponse(
  response: string,
): Array<{ path: string; archetype: string; reason?: string }> | null {
  // Direct parse
  try {
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Extract from markdown fences
  const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Find JSON array in response
  const arrayMatch = response.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return null;
}

/**
 * Merge LLM classification results into existing classifications.
 * Replaces null-archetype entries with LLM results and recomputes summary.
 */
export function mergeClassificationResults(
  base: Classifications,
  llmFiles: FileClassification[],
): Classifications {
  if (llmFiles.length === 0) return base;

  const llmMap = new Map(llmFiles.map((f) => [f.path, f]));
  const mergedFiles = base.files.map((f) => llmMap.get(f.path) ?? f);
  const summary = computeSummary(mergedFiles);

  return sortClassifications({
    archetypes: base.archetypes,
    files: mergedFiles,
    summary,
  });
}

/**
 * Build a lookup map from file path to archetype ID.
 * Returns null for unclassified files.
 */
export function buildClassificationMap(
  classifications: Classifications | null | undefined,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  if (!classifications) return map;
  for (const fc of classifications.files) {
    map.set(fc.path, fc.archetype);
  }
  return map;
}
