import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { PRDItem, AnalyzeTokenUsage } from "../schema/index.js";
import { isContainerLevel } from "../schema/index.js";
import type { ScanResult } from "./scanners.js";
import type { Proposal, ProposalTask } from "./propose.js";
import { walkTree } from "../core/tree.js";
// Re-export shared utilities for backward compatibility — existing consumers
// that import from "./reason.js" continue to work without changes.
export {
  DEFAULT_MODEL,
  DEFAULT_CODEX_MODEL,
  MAX_RETRIES,
  parseTokenUsage,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
  detectFileFormat,
  extractJson,
  repairTruncatedJson,
  PRD_SCHEMA,
  TASK_QUALITY_RULES,
  OUTPUT_INSTRUCTION,
} from "./analyze-shared.js";
export type { ClaudeResult, FileFormat } from "./analyze-shared.js";

// Re-export LLM bridge functions for backward compatibility — consumers
// that import config/client management from "./reason.js" continue to work.
export {
  setLLMConfig,
  setClaudeConfig,
  setClaudeClient,
  getAuthMode,
  getLLMVendor,
  spawnClaude,
} from "./llm-bridge.js";

import {
  DEFAULT_MODEL,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
  extractJson,
  repairTruncatedJson,
  detectFileFormat,
  PRD_SCHEMA,
  TASK_QUALITY_RULES,
  OUTPUT_INSTRUCTION,
} from "./analyze-shared.js";
import type { ClaudeResult, FileFormat } from "./analyze-shared.js";
import { spawnClaude } from "./llm-bridge.js";

// ── Zod schemas for LLM response validation ──

const STATUS_ENUM = z.enum(["pending", "completed"]).optional();

const ProposalTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  tags: z.array(z.string()).optional(),
  status: STATUS_ENUM,
  loe: z.number().positive().optional(),
  loeRationale: z.string().optional(),
  loeConfidence: z.enum(["low", "medium", "high"]).optional(),
});

const ProposalFeatureSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  existingId: z.string().optional(),
  status: STATUS_ENUM,
  tasks: z.array(ProposalTaskSchema),
});

const ProposalSchema = z.object({
  epic: z.object({
    title: z.string(),
    existingId: z.string().optional(),
    status: STATUS_ENUM,
  }),
  features: z.array(ProposalFeatureSchema),
});

const ProposalArraySchema = z.array(ProposalSchema);

// ── Helpers ──

function summarizeExisting(
  items: PRDItem[],
  options?: { withIds?: boolean },
): string {
  const lines: string[] = [];
  for (const { item, parents } of walkTree(items)) {
    const indent = "  ".repeat(parents.length);
    const showId = options?.withIds && isContainerLevel(item.level);
    const idPart = showId ? ` (id: ${item.id})` : "";
    lines.push(`${indent}- [${item.level}] ${item.title} (${item.status})${idPart}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(empty PRD)";
}

// ── Project context loading ──

/** Doc files to search for, in priority order. First found wins per slot. */
const PROJECT_DOC_FILES = [
  "CLAUDE.md",
  "README.md",
  "README",
  "README.txt",
];

/** Max characters of project context to include in the LLM prompt. */
const MAX_CONTEXT_LENGTH = 4000;

/**
 * Read project documentation files from `dir`. Returns a trimmed string
 * suitable for inclusion in an LLM prompt, or an empty string if nothing
 * useful is found.
 */
export async function readProjectContext(dir: string): Promise<string> {
  const sections: string[] = [];
  let totalLength = 0;

  for (const name of PROJECT_DOC_FILES) {
    if (totalLength >= MAX_CONTEXT_LENGTH) break;
    try {
      const content = await readFile(join(dir, name), "utf-8");
      const trimmed = content.trim();
      if (trimmed.length === 0) continue;

      const remaining = MAX_CONTEXT_LENGTH - totalLength;
      const snippet =
        trimmed.length > remaining
          ? trimmed.slice(0, remaining) + "\n...(truncated)"
          : trimmed;

      sections.push(`--- ${name} ---\n${snippet}`);
      totalLength += snippet.length;
    } catch {
      // File not found — skip
    }
  }

  return sections.join("\n\n");
}


export function parseProposalResponse(raw: string): Proposal[] {
  const text = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Attempt to repair truncated JSON from cut-off responses
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      parsed = JSON.parse(repaired);
    } else {
      throw new Error(`Invalid JSON in LLM response: ${text.slice(0, 200)}`);
    }
  }

  // If the LLM returned a single object instead of an array, wrap it
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const single = ProposalSchema.safeParse(parsed);
    if (single.success) {
      return normalizeProposals([single.data]);
    }
  }

  // Try strict validation first
  const strict = ProposalArraySchema.safeParse(parsed);
  if (strict.success) {
    return normalizeProposals(strict.data);
  }

  // Lenient fallback: parse valid items individually, skip broken ones
  if (Array.isArray(parsed) && parsed.length > 0) {
    const valid: z.infer<typeof ProposalSchema>[] = [];
    for (const item of parsed) {
      const result = ProposalSchema.safeParse(item);
      if (result.success) {
        valid.push(result.data);
      }
    }
    if (valid.length > 0) {
      return normalizeProposals(valid);
    }
  }

  // Nothing salvageable — throw with original error detail
  throw new Error(
    `LLM response failed schema validation: ${strict.error.issues.map((i) => i.message).join("; ")}`,
  );
}

/**
 * Convert Zod-validated proposals into the full Proposal shape with source fields.
 */
function normalizeProposals(
  validated: z.infer<typeof ProposalArraySchema>,
): Proposal[] {
  return validated.map((p) => ({
    epic: { title: p.epic.title, source: "llm", existingId: p.epic.existingId, status: p.epic.status },
    features: p.features.map((f) => ({
      title: f.title,
      source: "llm",
      description: f.description,
      existingId: f.existingId,
      status: f.status,
      tasks: f.tasks.map((t) => ({
        title: t.title,
        source: "llm",
        sourceFile: "",
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        priority: t.priority,
        tags: t.tags,
        status: t.status,
        loe: t.loe,
        loeRationale: t.loeRationale,
        loeConfidence: t.loeConfidence,
      })),
    })),
  }));
}

// ── Quality validation ──

export interface QualityIssue {
  level: "warning" | "error";
  path: string;
  message: string;
}

/**
 * Validate semantic quality of LLM-generated proposals.
 * Returns issues found. Empty array means all quality checks passed.
 */
export function validateProposalQuality(proposals: Proposal[]): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const p of proposals) {
    const epicPath = `epic:"${p.epic.title}"`;

    // Epic title quality
    if (p.epic.title.length < 3) {
      issues.push({
        level: "warning",
        path: epicPath,
        message: "Epic title is too short to be descriptive",
      });
    }
    if (p.features.length === 0) {
      issues.push({
        level: "warning",
        path: epicPath,
        message: "Epic has no features",
      });
    }

    for (const f of p.features) {
      const featurePath = `${epicPath} > feature:"${f.title}"`;

      if (f.tasks.length === 0) {
        issues.push({
          level: "warning",
          path: featurePath,
          message: "Feature has no tasks",
        });
      }

      for (const t of f.tasks) {
        const taskPath = `${featurePath} > task:"${t.title}"`;

        // Tasks should have descriptions or acceptance criteria
        if (!t.description && (!t.acceptanceCriteria || t.acceptanceCriteria.length === 0)) {
          issues.push({
            level: "warning",
            path: taskPath,
            message: "Task lacks both description and acceptance criteria",
          });
        }

        // Very short task titles suggest vague output
        if (t.title.length < 5) {
          issues.push({
            level: "warning",
            path: taskPath,
            message: "Task title is too short to be actionable",
          });
        }
      }
    }
  }

  return issues;
}

// ── Structured file parsing (JSON/YAML without LLM) ──

function extractJsonItems(
  content: string,
): { name: string; description?: string }[] {
  try {
    const data = JSON.parse(content);
    const items: { name: string; description?: string }[] = [];

    function scan(obj: unknown): void {
      if (Array.isArray(obj)) {
        for (const el of obj) scan(el);
      } else if (obj && typeof obj === "object") {
        const o = obj as Record<string, unknown>;
        const name = (o.title ?? o.name) as string | undefined;
        if (typeof name === "string") {
          items.push({
            name,
            description: typeof o.description === "string" ? o.description : undefined,
          });
        }
        for (const val of Object.values(o)) {
          if (typeof val === "object" && val !== null) scan(val);
        }
      }
    }

    scan(data);
    return items;
  } catch {
    return [];
  }
}

function extractYamlItems(
  content: string,
): { name: string; description?: string }[] {
  const items: { name: string; description?: string }[] = [];
  const lines = content.split("\n");
  let currentName: string | null = null;
  let currentDesc: string | null = null;

  for (const line of lines) {
    const nameMatch = line.match(/^\s*(?:title|name)\s*:\s*["']?(.+?)["']?\s*$/);
    if (nameMatch) {
      if (currentName) {
        items.push({
          name: currentName,
          description: currentDesc ?? undefined,
        });
      }
      currentName = nameMatch[1];
      currentDesc = null;
      continue;
    }
    const descMatch = line.match(/^\s*description\s*:\s*["']?(.+?)["']?\s*$/);
    if (descMatch && currentName) {
      currentDesc = descMatch[1];
    }
  }
  if (currentName) {
    items.push({
      name: currentName,
      description: currentDesc ?? undefined,
    });
  }
  return items;
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Attempt to parse structured file content (JSON/YAML) directly into proposals
 * without an LLM call. Returns null if the format is markdown or if the content
 * cannot be meaningfully extracted.
 */
export function parseStructuredFile(
  content: string,
  format: FileFormat,
  existingItems: PRDItem[],
): Proposal[] | null {
  if (format === "markdown" || format === "text") return null;

  // For JSON, first try to parse as the full Proposal schema
  if (format === "json") {
    try {
      let text = content.trim();
      const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) text = fenceMatch[1].trim();

      const parsed = JSON.parse(text);

      // Try as array first, then as single object
      let validated: z.infer<typeof ProposalArraySchema> | null = null;
      const arrayResult = ProposalArraySchema.safeParse(parsed);
      if (arrayResult.success) {
        validated = arrayResult.data;
      } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const singleResult = ProposalSchema.safeParse(parsed);
        if (singleResult.success) {
          validated = [singleResult.data];
        }
      }

      if (validated && validated.length > 0) {
        // Existing title set for dedup
        const existingTitles = new Set(
          existingItems.map((item) => normalize(item.title)),
        );

        const result = validated
          .map((p) => ({
            epic: { title: p.epic.title, source: "file-import" },
            features: p.features
              .filter((f) => !existingTitles.has(normalize(f.title)))
              .map((f) => ({
                title: f.title,
                source: "file-import",
                description: f.description,
                tasks: f.tasks
                  .filter((t) => !existingTitles.has(normalize(t.title)))
                  .map((t) => ({
                    title: t.title,
                    source: "file-import",
                    sourceFile: "",
                    description: t.description,
                    acceptanceCriteria: t.acceptanceCriteria,
                    priority: t.priority,
                    tags: t.tags,
                  })),
              })),
          }))
          .filter((p) => p.features.length > 0 || !existingTitles.has(normalize(p.epic.title)));

        if (result.length > 0) return result;
        return null;
      }
    } catch {
      // Not valid JSON or not in Proposal schema — fall through to generic extraction
    }
  }

  // Generic extraction: pull title/name items from JSON or YAML
  const items =
    format === "json" ? extractJsonItems(content) : extractYamlItems(content);

  if (items.length === 0) return null;

  // Dedup against existing PRD
  const existingTitles = new Set(
    existingItems.map((item) => normalize(item.title)),
  );
  const newItems = items.filter((i) => !existingTitles.has(normalize(i.name)));

  if (newItems.length === 0) return null;

  // Group into a single "Imported Items" epic with each item as a feature
  return [
    {
      epic: { title: "Imported Items", source: "file-import" },
      features: newItems.map((item) => ({
        title: item.name,
        source: "file-import",
        description: item.description,
        tasks: [],
      })),
    },
  ];
}

// ── Format-specific LLM prompt hints ──

const FORMAT_HINTS: Record<FileFormat, string> = {
  markdown:
    "The document is in Markdown format. Pay attention to headings, bullet points, and structured sections.",
  text:
    "The document is in plain text format. Look for section headers (ALL CAPS, underlined, numbered), bullet points, and requirement keywords (must, should, shall).",
  json:
    "The document is in JSON format. Extract meaningful requirements from the structured data, including nested objects and arrays.",
  yaml:
    "The document is in YAML format. Extract meaningful requirements from the structured data fields.",
};

// ── Shared prompt fragments ──

// ANTI_PATTERNS is defined here (not in analyze-shared) because it is only
// used by reason.ts prompts, not by extract.ts or file-validation.ts.
export const ANTI_PATTERNS = `Avoid these common mistakes:
- Do NOT produce tasks with only a title and no description or criteria — every task needs substance.
- Do NOT use vague titles like "Implement the feature", "Fix the bug", "Update code" — be specific about WHAT is being implemented/fixed/updated.
- Do NOT create single-task features — if a feature has only one task, either break the task down or merge it into a related feature.
- Do NOT duplicate tasks already in the existing PRD (check the summary below).
- Do NOT wrap your response in markdown fences — return raw JSON only.`;

/**
 * Auto-placement instruction block. Included in prompts when no explicit
 * parentId is specified, telling the LLM it can reference existing PRD
 * items by ID to place new items under them.
 */
export const AUTO_PLACEMENT_INSTRUCTION = `
## Placement
The existing PRD includes item IDs for epics and features. When new items
naturally belong under an existing epic or feature, set "existingId" on the
epic/feature object to reference it by ID. Only create new epics/features
when the items genuinely represent new work areas not covered by the existing tree.

If an existing parent's title needs to expand to accommodate the new scope,
use "existingId" to reference it AND set the title to the updated version.`;

/**
 * Consolidation instruction block. Guides the LLM toward producing fewer,
 * larger work packages rather than many micro-tasks. Included in prompts
 * that process broad input (scan results, natural-language descriptions)
 * to produce sprint-sized proposals.
 */
export const CONSOLIDATION_INSTRUCTION = `
## Consolidation
Prefer consolidated, sprint-sized work packages over many small tasks.
For broad input covering multiple areas, aim for 3–7 top-level proposals
(epics) rather than 10+ micro-items. Each task should represent a
meaningful deliverable — not a single function or file change.

Guidelines:
- Merge related scan findings into a single task when they address the
  same concern (e.g. "add input validation" across multiple routes →
  one task covering the validation pattern).
- Prefer one well-scoped task with clear acceptance criteria over three
  trivially small tasks that would be completed together anyway.
- If a broad description covers an entire feature area, create 1–2
  features with 2–5 tasks each, not a flat list of 15 micro-tasks.
- Each task should still be completable in a single focused sprint
  (roughly 0.5–4 engineer-weeks), not so large it becomes vague.`;

// ── Few-shot example for LLM prompts ──

/**
 * A compact example included in prompts to show the LLM the expected output
 * shape, quality of titles, and level of detail for tasks.
 */
export const FEW_SHOT_EXAMPLE = `Example output (for reference — do NOT include this example in your response):
[
  {
    "epic": { "title": "User Authentication" },
    "features": [
      {
        "title": "OAuth2 Integration",
        "description": "Support third-party OAuth2 providers for user login",
        "tasks": [
          {
            "title": "Implement OAuth2 callback handler",
            "description": "Handle the authorization code exchange and token storage after provider redirects back to our app. Covers Google and GitHub providers with a pluggable adapter pattern for future providers.",
            "acceptanceCriteria": [
              "Handles Google and GitHub OAuth2 flows end-to-end",
              "Stores refresh token securely in encrypted session storage",
              "Returns meaningful error on provider rejection",
              "Provider adapter interface documented with at least one example"
            ],
            "priority": "high",
            "tags": ["auth", "backend"],
            "loe": 2,
            "loeRationale": "Two providers with shared adapter pattern, plus token storage and error handling — bounded by well-documented OAuth2 spec.",
            "loeConfidence": "high"
          }
        ]
      }
    ]
  },
  {
    "epic": { "title": "API Infrastructure", "existingId": "abc-123" },
    "features": [
      {
        "title": "Rate Limiting",
        "description": "Protect API endpoints from abuse with configurable rate limits",
        "tasks": [
          {
            "title": "Implement token bucket rate limiter middleware",
            "description": "Add per-endpoint rate limiting using a token bucket algorithm with configurable burst and sustained rates",
            "acceptanceCriteria": [
              "Returns 429 with Retry-After header when limit exceeded",
              "Configurable per-route limits via middleware options",
              "Supports both IP-based and API-key-based limiting"
            ],
            "priority": "high",
            "tags": ["api", "security"],
            "loe": 1.5,
            "loeRationale": "Standard middleware pattern with token bucket algorithm; main effort is the configuration surface and tests.",
            "loeConfidence": "medium"
          }
        ]
      }
    ]
  }
]`;

// ── Scan result summarization + chunking ──

/**
 * Character budget per LLM chunk. Keeps each prompt well within token limits
 * while leaving room for the system instructions, existing PRD summary, and
 * project context that surround the scan data.
 */
export const CHUNK_CHAR_LIMIT = 40_000;

/**
 * Maximum number of scan results per LLM chunk. Even if results fit within
 * the character budget, limiting item count improves LLM reasoning quality
 * by keeping context manageable. Set to 100 as a sensible default.
 */
export const CHUNK_ITEM_LIMIT = 100;

/**
 * Render an array of ScanResults into the text block used inside LLM prompts.
 */
export function summarizeScanResults(results: ScanResult[]): string {
  return results
    .map((r) => {
      const parts = [
        `[${r.kind}] ${r.name} (source: ${r.source}, file: ${r.sourceFile})`,
      ];
      if (r.description) parts.push(`  description: ${r.description}`);
      if (r.acceptanceCriteria?.length)
        parts.push(`  criteria: ${r.acceptanceCriteria.join("; ")}`);
      if (r.priority) parts.push(`  priority: ${r.priority}`);
      if (r.tags?.length) parts.push(`  tags: ${r.tags.join(", ")}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

/**
 * Estimate the serialized character length of a single ScanResult without
 * allocating intermediate strings or arrays. Uses arithmetic on the existing
 * field lengths to match what `summarizeScanResults([r])` would produce.
 *
 * This avoids O(N) full serializations during chunking — a significant
 * saving for large codebases with thousands of scan results.
 */
export function estimateItemSize(r: ScanResult): number {
  // Header: `[${r.kind}] ${r.name} (source: ${r.source}, file: ${r.sourceFile})`
  //          [  kind     ]_  name    _(source:_  source   ,_file:_  sourceFile   )
  let size = 1 + r.kind.length + 2 + r.name.length + 10 + r.source.length + 8 + r.sourceFile.length + 1;

  if (r.description) {
    // `\n  description: ${r.description}` — prefix is 16 chars
    size += 16 + r.description.length;
  }
  if (r.acceptanceCriteria && r.acceptanceCriteria.length > 0) {
    // `\n  criteria: ` + items joined by "; "
    size += 13;
    for (let i = 0; i < r.acceptanceCriteria.length; i++) {
      if (i > 0) size += 2; // "; "
      size += r.acceptanceCriteria[i].length;
    }
  }
  if (r.priority) {
    // `\n  priority: ${r.priority}`
    size += 13 + r.priority.length;
  }
  if (r.tags && r.tags.length > 0) {
    // `\n  tags: ` + items joined by ", "
    size += 9;
    for (let i = 0; i < r.tags.length; i++) {
      if (i > 0) size += 2; // ", "
      size += r.tags[i].length;
    }
  }
  return size;
}

/** Kind ordering for grouping: epics first, then features, then tasks. */
const KIND_ORDER: Record<string, number> = { epic: 0, feature: 1, task: 2 };

/**
 * Sort scan results so related items are adjacent: first by source file,
 * then by kind (epic → feature → task). This keeps context together within
 * chunks so the LLM sees complete feature areas rather than interleaved
 * fragments from different parts of the codebase.
 *
 * Returns a new array — does not mutate the input.
 */
export function groupScanResults(results: ScanResult[]): ScanResult[] {
  return [...results].sort((a, b) => {
    if (a.sourceFile !== b.sourceFile) {
      return a.sourceFile < b.sourceFile ? -1 : 1;
    }
    return (KIND_ORDER[a.kind] ?? 2) - (KIND_ORDER[b.kind] ?? 2);
  });
}

/**
 * Split scan results into chunks that respect both `CHUNK_CHAR_LIMIT` and
 * `CHUNK_ITEM_LIMIT`. When all results fit in a single chunk, this returns
 * a one-element array — no overhead.
 *
 * Chunking triggers when either:
 * - The serialized summary would exceed the character limit, OR
 * - The item count would exceed 100 items per chunk
 *
 * This dual constraint ensures both:
 * - Token budget stays within LLM limits (character-based)
 * - LLM reasoning quality stays high (item-count-based)
 *
 * Optimizations over naive chunking:
 * - Uses `estimateItemSize()` for O(1) size calculation per item instead
 *   of full serialization, reducing allocations for large result sets.
 * - Groups related items by source file and kind so the LLM sees coherent
 *   context per chunk rather than interleaved fragments.
 */
export function chunkScanResults(results: ScanResult[]): ScanResult[][] {
  if (results.length === 0) return [];

  // Group related items together before chunking
  const sorted = groupScanResults(results);

  const chunks: ScanResult[][] = [];
  let current: ScanResult[] = [];
  let currentLen = 0;

  for (const r of sorted) {
    const itemLen = estimateItemSize(r);

    // Flush the current chunk if adding this item would exceed either limit
    // (unless it's empty — an oversized single item gets its own chunk).
    const wouldExceedCharLimit = currentLen + itemLen + 2 > CHUNK_CHAR_LIMIT;
    const wouldExceedItemLimit = current.length >= CHUNK_ITEM_LIMIT;

    if (current.length > 0 && (wouldExceedCharLimit || wouldExceedItemLimit)) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }

    current.push(r);
    currentLen += itemLen + 2; // account for the "\n\n" separator
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// ── Public API ──

/** Result of a reason* function: proposals plus aggregated token usage. */
export interface ReasonResult {
  proposals: Proposal[];
  tokenUsage: AnalyzeTokenUsage;
}

export async function reasonFromFile(
  filePath: string,
  existingItems: PRDItem[],
  model?: string,
): Promise<ReasonResult> {
  const content = await readFile(filePath, "utf-8");
  const format = detectFileFormat(filePath);
  const tokenUsage = emptyAnalyzeTokenUsage();

  // For JSON/YAML, try direct structured parsing first
  if (format !== "markdown" && format !== "text") {
    const structured = parseStructuredFile(content, format, existingItems);
    if (structured !== null) {
      return { proposals: structured, tokenUsage };
    }
  }

  // For text files, try local extraction before LLM
  if (format === "text") {
    const { extractFromText } = await import("./extract.js");
    const extraction = extractFromText(content, { existingItems });
    if (extraction.proposals.length > 0) {
      return { proposals: extraction.proposals, tokenUsage };
    }
  }

  // Fall back to LLM-based extraction
  const existingSummary = summarizeExisting(existingItems);

  const prompt = `You are a product requirements analyst. Read the following document and extract a structured PRD (Product Requirements Document) as a JSON array.

${PRD_SCHEMA}

${FEW_SHOT_EXAMPLE}

Structuring guidelines:
- Group related items into epics and features logically.
- Derive tasks from actionable items in the document.
- If the document covers multiple distinct areas, create separate epics for each.

${TASK_QUALITY_RULES}

${ANTI_PATTERNS}

${FORMAT_HINTS[format]}

Existing PRD:
${existingSummary}

Document to analyze:
${content}

${OUTPUT_INSTRUCTION}`;

  const result = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
  accumulateTokenUsage(tokenUsage, result.tokenUsage);
  return { proposals: parseProposalResponse(result.text), tokenUsage };
}

// ── Multi-file support ──

/**
 * Merge proposals that share the same epic title (case-insensitive).
 * Features and tasks are concatenated; duplicates within features are
 * removed by normalized title.
 */
export function mergeProposals(all: Proposal[]): Proposal[] {
  const epicMap = new Map<string, Proposal>();

  for (const p of all) {
    const key = normalize(p.epic.title);
    const existing = epicMap.get(key);
    if (!existing) {
      // Clone to avoid mutating inputs
      epicMap.set(key, {
        epic: { ...p.epic },
        features: p.features.map((f) => ({
          ...f,
          tasks: [...f.tasks],
        })),
      });
    } else {
      // Merge features into existing epic
      const seenFeatures = new Set(
        existing.features.map((f) => normalize(f.title)),
      );
      for (const f of p.features) {
        const fKey = normalize(f.title);
        if (seenFeatures.has(fKey)) {
          // Merge tasks into existing feature
          const target = existing.features.find(
            (ef) => normalize(ef.title) === fKey,
          )!;
          const seenTasks = new Set(
            target.tasks.map((t) => normalize(t.title)),
          );
          for (const t of f.tasks) {
            if (!seenTasks.has(normalize(t.title))) {
              target.tasks.push(t);
              seenTasks.add(normalize(t.title));
            }
          }
        } else {
          existing.features.push({ ...f, tasks: [...f.tasks] });
          seenFeatures.add(fKey);
        }
      }
    }
  }

  return [...epicMap.values()];
}

/**
 * Process multiple input files and combine results into a single proposal list.
 * Each file is read and parsed independently, then proposals are merged by epic.
 */
export async function reasonFromFiles(
  filePaths: string[],
  existingItems: PRDItem[],
  model?: string,
): Promise<ReasonResult> {
  const tokenUsage = emptyAnalyzeTokenUsage();

  if (filePaths.length === 0) {
    return { proposals: [], tokenUsage };
  }
  if (filePaths.length === 1) {
    return reasonFromFile(filePaths[0], existingItems, model);
  }

  const allProposals: Proposal[] = [];

  for (const fp of filePaths) {
    const result = await reasonFromFile(fp, existingItems, model);
    allProposals.push(...result.proposals);
    // Accumulate per-file token usage (calls already counted in reasonFromFile)
    tokenUsage.calls += result.tokenUsage.calls;
    tokenUsage.inputTokens += result.tokenUsage.inputTokens;
    tokenUsage.outputTokens += result.tokenUsage.outputTokens;
    if (result.tokenUsage.cacheCreationInputTokens) {
      tokenUsage.cacheCreationInputTokens =
        (tokenUsage.cacheCreationInputTokens ?? 0) + result.tokenUsage.cacheCreationInputTokens;
    }
    if (result.tokenUsage.cacheReadInputTokens) {
      tokenUsage.cacheReadInputTokens =
        (tokenUsage.cacheReadInputTokens ?? 0) + result.tokenUsage.cacheReadInputTokens;
    }
  }

  return { proposals: mergeProposals(allProposals), tokenUsage };
}

export async function reasonFromScanResults(
  results: ScanResult[],
  existingItems: PRDItem[],
  options?: { model?: string; dir?: string },
): Promise<ReasonResult> {
  const existingSummary = summarizeExisting(existingItems);
  const tokenUsage = emptyAnalyzeTokenUsage();

  // Baseline detection: empty PRD + existing code = first scan of an existing project.
  // In baseline mode, the LLM should mark already-built functionality as "completed"
  // and only mark gaps/improvements as "pending".
  const isBaseline = existingItems.length === 0 && results.length > 0;

  // Read project documentation for additional context
  const projectContext = options?.dir
    ? await readProjectContext(options.dir)
    : "";

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  // Split large result sets into chunks to stay within token limits
  const chunks = chunkScanResults(results);

  if (chunks.length === 0) {
    return { proposals: [], tokenUsage };
  }

  const model = options?.model ?? DEFAULT_MODEL;
  const allProposals: Proposal[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const scanSummary = summarizeScanResults(chunks[i]);

    // Multi-chunk context: include epic titles from previous chunks so the
    // LLM can reuse existing groupings instead of creating duplicates
    let chunkNote = "";
    if (chunks.length > 1) {
      chunkNote = `\nNote: This is chunk ${i + 1} of ${chunks.length}. Focus only on the scan results shown here.`;
      if (i > 0 && allProposals.length > 0) {
        const priorEpics = [...new Set(allProposals.map((p) => p.epic.title))];
        chunkNote += `\nEpics created from previous chunks (reuse these names where items belong to the same area):\n${priorEpics.map((e) => `  - ${e}`).join("\n")}`;
      }
      chunkNote += "\n";
    }

    const baselineInstruction = isBaseline ? `
IMPORTANT — Baseline mode:
This is the first scan of an existing codebase. The PRD is empty, but the code already exists.
You MUST include a "status" field on every epic, feature, and task:
- "completed" — the code already implements this functionality (the scan found evidence it exists)
- "pending" — this is a gap, improvement, or missing feature that should be built

Most items from an existing codebase scan should be "completed". Only mark items as "pending" if
they represent genuinely missing functionality, TODOs, or improvements identified in the scan results.
` : "";

    const prompt = `You are a product requirements analyst. Given the following raw scan results from automated code analysis, organize them into a clean, well-structured PRD as a JSON array.

${PRD_SCHEMA}

${FEW_SHOT_EXAMPLE}
${CONSOLIDATION_INSTRUCTION}
${baselineInstruction}
Structuring guidelines:
- Near-duplicate items have already been merged. Focus on semantic grouping and structure.
- If any remaining items are clearly about the same thing, merge them into a single item.
- Create meaningful epic groupings that reflect the project's domain (not generic names like "Tests" or "Documentation").
- Group related work into features under appropriate epics.

${TASK_QUALITY_RULES}

Scan-specific rules:
- Preserve priority levels from the scan results where they exist.
- Rewrite vague scan-generated titles to be clear and actionable.
- Use the project context below to align epic/feature names with the project's domain terminology.

${ANTI_PATTERNS}
${chunkNote}${contextBlock}
Existing PRD:
${existingSummary}

Scan results:
${scanSummary}

${OUTPUT_INSTRUCTION}`;

    const claudeResult = await spawnClaude(prompt, model);
    accumulateTokenUsage(tokenUsage, claudeResult.tokenUsage);
    allProposals.push(...parseProposalResponse(claudeResult.text));
  }

  // When we made multiple LLM calls, merge overlapping epics/features
  const proposals = chunks.length > 1 ? mergeProposals(allProposals) : allProposals;
  return { proposals, tokenUsage };
}

// ── Natural-language add ──

export interface AddPromptOptions {
  parentId?: string;
}

/**
 * Build the LLM prompt for a natural-language add command.
 * Exported separately so it can be tested without spawning claude.
 */
export async function buildAddPrompt(
  description: string,
  existingItems: PRDItem[],
  dir: string,
  options?: AddPromptOptions,
): Promise<string> {
  const hasParent = !!options?.parentId;
  const existingSummary = summarizeExisting(existingItems, { withIds: !hasParent });
  const projectContext = await readProjectContext(dir);

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  let parentConstraint = "";
  let placementBlock = "";
  if (hasParent) {
    // Find the parent in the tree and describe it
    const parentEntry = findItemInTree(existingItems, options!.parentId!);
    if (parentEntry) {
      parentConstraint = `
IMPORTANT: Scope your response to fit under this existing parent item:
  ID: ${options!.parentId}
  Level: ${parentEntry.level}
  Title: ${parentEntry.title}

Only create children appropriate for a ${parentEntry.level}. For example, if the parent is an epic, create features and tasks. If the parent is a feature, create only tasks.
Do NOT create a new epic — instead use the parent's title as the epic title in your response.`;
    }
  } else if (existingItems.length > 0) {
    placementBlock = AUTO_PLACEMENT_INSTRUCTION;
  }

  return `You are a product requirements analyst. Given the following natural-language description, create a structured PRD breakdown as a JSON array.

${PRD_SCHEMA}

${FEW_SHOT_EXAMPLE}
${CONSOLIDATION_INSTRUCTION}

Structuring guidelines:
- Break the description into a logical hierarchy of epics, features, and tasks.
- If the description is broad or covers multiple distinct areas, create multiple epics rather than forcing everything under one.
- Group related work into features under appropriate epics.

${TASK_QUALITY_RULES}

Deduplication:
- Do NOT include items that duplicate anything already in the existing PRD below.
- Do NOT create duplicate tasks within your own response — if two aspects of the description overlap, merge them into a single task with combined criteria.
- Use the project context to understand terminology and architecture.

${ANTI_PATTERNS}
${parentConstraint}${placementBlock}
${contextBlock}
Existing PRD:
${existingSummary}

Description to add:
${description}

${OUTPUT_INSTRUCTION}`;
}

function findItemInTree(
  items: PRDItem[],
  id: string,
): PRDItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findItemInTree(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Send a natural-language description to the LLM and get back structured proposals.
 */
export async function reasonFromDescription(
  description: string,
  existingItems: PRDItem[],
  options?: { model?: string; dir?: string; parentId?: string },
): Promise<ReasonResult> {
  const dir = options?.dir ?? process.cwd();
  const prompt = await buildAddPrompt(description, existingItems, dir, {
    parentId: options?.parentId,
  });

  const tokenUsage = emptyAnalyzeTokenUsage();
  const result = await spawnClaude(prompt, options?.model ?? DEFAULT_MODEL);
  accumulateTokenUsage(tokenUsage, result.tokenUsage);
  return { proposals: parseProposalResponse(result.text), tokenUsage };
}

// ── Multiple descriptions ──

/**
 * Build the LLM prompt for multiple natural-language descriptions in a single
 * add call. Each description is treated as a distinct idea; the LLM is
 * instructed to produce a coherent, de-duplicated structure that covers them
 * all.
 */
export async function buildMultiAddPrompt(
  descriptions: string[],
  existingItems: PRDItem[],
  dir: string,
  options?: AddPromptOptions,
): Promise<string> {
  const hasParent = !!options?.parentId;
  const existingSummary = summarizeExisting(existingItems, { withIds: !hasParent });
  const projectContext = await readProjectContext(dir);

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  let parentConstraint = "";
  let placementBlock = "";
  if (hasParent) {
    const parentEntry = findItemInTree(existingItems, options!.parentId!);
    if (parentEntry) {
      parentConstraint = `
IMPORTANT: Scope your response to fit under this existing parent item:
  ID: ${options!.parentId}
  Level: ${parentEntry.level}
  Title: ${parentEntry.title}

Only create children appropriate for a ${parentEntry.level}. For example, if the parent is an epic, create features and tasks. If the parent is a feature, create only tasks.
Do NOT create a new epic — instead use the parent's title as the epic title in your response.`;
    }
  } else if (existingItems.length > 0) {
    placementBlock = AUTO_PLACEMENT_INSTRUCTION;
  }

  const numbered = descriptions
    .map((d, i) => `${i + 1}. ${d}`)
    .join("\n");

  return `You are a product requirements analyst. You have been given ${descriptions.length} feature descriptions at once. Analyze ALL of them and create a unified, coherent PRD breakdown as a JSON array.

${PRD_SCHEMA}

${FEW_SHOT_EXAMPLE}
${CONSOLIDATION_INSTRUCTION}

Structuring guidelines:
- Treat each description as a distinct piece of work.
- Group related descriptions under the same epic when they naturally belong together.
- Keep unrelated descriptions in separate epics.

${TASK_QUALITY_RULES}

Deduplication:
- Do NOT include items that duplicate anything already in the existing PRD below.
- Do NOT create duplicate items across descriptions — if two descriptions overlap, merge them into a single task with combined criteria.
- Use the project context to understand terminology and architecture.

${ANTI_PATTERNS}
${parentConstraint}${placementBlock}
${contextBlock}
Existing PRD:
${existingSummary}

Descriptions to add:
${numbered}

${OUTPUT_INSTRUCTION}`;
}

/**
 * Send multiple natural-language descriptions to the LLM in a single call and
 * get back a unified set of proposals.
 */
export async function reasonFromDescriptions(
  descriptions: string[],
  existingItems: PRDItem[],
  options?: { model?: string; dir?: string; parentId?: string },
): Promise<ReasonResult> {
  const tokenUsage = emptyAnalyzeTokenUsage();

  if (descriptions.length === 0) return { proposals: [], tokenUsage };
  // Single description — delegate to the original function
  if (descriptions.length === 1) {
    return reasonFromDescription(descriptions[0], existingItems, options);
  }

  const dir = options?.dir ?? process.cwd();
  const prompt = await buildMultiAddPrompt(descriptions, existingItems, dir, {
    parentId: options?.parentId,
  });

  const result = await spawnClaude(prompt, options?.model ?? DEFAULT_MODEL);
  accumulateTokenUsage(tokenUsage, result.tokenUsage);
  return { proposals: parseProposalResponse(result.text), tokenUsage };
}

// ── Granularity adjustment ──

/**
 * Build an LLM prompt to break down proposals into finer-grained tasks.
 * Each task is split into smaller subtasks; features may be expanded.
 * Pure function — no I/O.
 */
export function buildBreakdownPrompt(proposals: Proposal[]): string {
  const proposalJson = JSON.stringify(proposals, null, 2);

  return `You are a product requirements analyst. Break down the following PRD proposals into finer-grained, more detailed tasks.

Current proposals:
${proposalJson}

Rules:
- Split each task into 2-4 smaller, more specific subtasks.
- If a feature has only 1 task, expand it into 2-3 tasks covering distinct aspects.
- Preserve the epic and feature structure — do NOT change epic or feature titles.
- Each new task MUST have a verb-first title AND both a description and acceptanceCriteria.
- Distribute the original acceptance criteria among the subtasks — do not lose any.
- Keep priorities consistent with the originals.
- Do NOT add entirely new functionality — only decompose what exists.
- Do NOT produce tasks with only a title — every task needs both description and criteria.

${FEW_SHOT_EXAMPLE}

${OUTPUT_INSTRUCTION}`;
}

/**
 * Build an LLM prompt to consolidate proposals into coarser-grained tasks.
 * Multiple fine-grained tasks are merged into broader ones.
 * Pure function — no I/O.
 */
export function buildConsolidatePrompt(proposals: Proposal[]): string {
  const proposalJson = JSON.stringify(proposals, null, 2);

  return `You are a product requirements analyst. Consolidate the following PRD proposals into coarser-grained, higher-level tasks.

Current proposals:
${proposalJson}

Rules:
- Merge related tasks within each feature into broader, higher-level tasks.
- Aim to reduce the total task count by roughly half.
- If a feature has many tasks, combine related ones with merged acceptance criteria.
- If multiple features are closely related, merge them into one feature.
- Preserve the epic structure — do NOT change epic titles.
- Each resulting task MUST have a verb-first title AND both a description and acceptanceCriteria.
- Preserve the original intent — the consolidated tasks should cover the same scope as the originals.
- Keep the highest priority among merged tasks.
- Do NOT remove functionality — only consolidate what exists.
- Do NOT produce tasks with only a title — every task needs both description and criteria.

${FEW_SHOT_EXAMPLE}

${OUTPUT_INSTRUCTION}`;
}

/**
 * Adjust the granularity of proposals by calling the LLM.
 * - "break_down": splits tasks into finer-grained subtasks
 * - "consolidate": merges tasks into coarser-grained units
 */
export async function adjustGranularity(
  proposals: Proposal[],
  direction: "break_down" | "consolidate",
  model?: string,
): Promise<ReasonResult> {
  const prompt = direction === "break_down"
    ? buildBreakdownPrompt(proposals)
    : buildConsolidatePrompt(proposals);

  const tokenUsage = emptyAnalyzeTokenUsage();
  const result = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
  accumulateTokenUsage(tokenUsage, result.tokenUsage);
  return { proposals: parseProposalResponse(result.text), tokenUsage };
}

// ── Granularity assessment ──

/** Assessment of a single proposal's task granularity. */
export interface GranularityAssessment {
  /** 0-based index of the assessed proposal. */
  proposalIndex: number;
  /** The epic title of the assessed proposal. */
  epicTitle: string;
  /** Overall verdict. */
  recommendation: "break_down" | "consolidate" | "keep";
  /** Human-readable reasoning for the recommendation. */
  reasoning: string;
  /** Specific issues found (e.g. "Task X is too broad"). */
  issues: string[];
}

/** Result of assessing all proposals in a set. */
export interface GranularityAssessmentResult {
  assessments: GranularityAssessment[];
  tokenUsage: AnalyzeTokenUsage;
}

/**
 * Zod schema for validating the LLM's assessment response.
 */
const GranularityAssessmentSchema = z.object({
  proposalIndex: z.number(),
  recommendation: z.enum(["break_down", "consolidate", "keep"]),
  reasoning: z.string(),
  issues: z.array(z.string()),
});

const GranularityAssessmentArraySchema = z.array(GranularityAssessmentSchema);

/**
 * Build an LLM prompt to assess the granularity of proposals.
 * The LLM evaluates whether tasks are appropriately sized and suggests
 * when they should be broken down or consolidated.
 * Pure function — no I/O.
 */
export function buildAssessmentPrompt(proposals: Proposal[]): string {
  const proposalJson = JSON.stringify(
    proposals.map((p, i) => ({ proposalIndex: i, ...p })),
    null,
    2,
  );

  return `You are a product requirements analyst specializing in task sizing. Assess whether each proposal's tasks are at the right granularity.

Proposals to assess:
${proposalJson}

For EACH proposal (by proposalIndex), provide:
1. "recommendation": "break_down" | "consolidate" | "keep"
   - "break_down": tasks are too large/broad — split into smaller units
   - "consolidate": tasks are too fine-grained — merge into larger units
   - "keep": tasks are appropriately sized
2. "reasoning": concise explanation (1-2 sentences)
3. "issues": specific problems found (empty array if "keep")

Assessment criteria — a well-sized task is:
- Completable in one focused session (1-4 hours)
- Independently testable and deployable where possible
- Specific enough that the implementer knows exactly what to do

Red flags for TOO BROAD:
- More than 3 acceptance criteria
- Vague titles like "implement the feature" or "add API endpoints"
- Covers multiple distinct components or concerns

Red flags for TOO FINE-GRAINED:
- Single line change or trivial config tweak
- Feature has more than 6 tasks
- Multiple tasks that would naturally be done in the same edit session

Red flags for MISSING SUBSTANCE:
- Feature has only 1 task (should be broken down or merged)
- Tasks lack description or acceptance criteria

Respond with ONLY a valid JSON array of assessment objects, one per proposal:
[
  {
    "proposalIndex": 0,
    "recommendation": "break_down",
    "reasoning": "Several tasks cover broad functionality that spans multiple components.",
    "issues": [
      "Task 'Implement authentication system' covers login, signup, password reset, and session management — should be separate tasks",
      "Task 'Add API endpoints' is vague and likely involves multiple distinct endpoints"
    ]
  }
]

No explanation or markdown fences — ONLY the JSON array.`;
}

/**
 * Parse the LLM's granularity assessment response.
 * Validates against schema and enriches with epic titles from proposals.
 */
export function parseAssessmentResponse(
  raw: string,
  proposals: Proposal[],
): GranularityAssessment[] {
  const text = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      parsed = JSON.parse(repaired);
    } else {
      throw new Error(`Invalid JSON in assessment response: ${text.slice(0, 200)}`);
    }
  }

  // Validate
  const result = GranularityAssessmentArraySchema.safeParse(parsed);
  if (!result.success) {
    // Lenient fallback: parse valid items individually
    if (Array.isArray(parsed) && parsed.length > 0) {
      const valid: z.infer<typeof GranularityAssessmentSchema>[] = [];
      for (const item of parsed) {
        const single = GranularityAssessmentSchema.safeParse(item);
        if (single.success) valid.push(single.data);
      }
      if (valid.length > 0) {
        return valid.map((a) => ({
          ...a,
          epicTitle: proposals[a.proposalIndex]?.epic.title ?? `Proposal ${a.proposalIndex + 1}`,
        }));
      }
    }
    throw new Error(
      `Assessment response failed schema validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  return result.data.map((a) => ({
    ...a,
    epicTitle: proposals[a.proposalIndex]?.epic.title ?? `Proposal ${a.proposalIndex + 1}`,
  }));
}

/**
 * Format a granularity assessment for human-readable display.
 * Pure function — returns a multi-line string.
 */
export function formatAssessment(assessments: GranularityAssessment[]): string {
  if (assessments.length === 0) return "No proposals to assess.";

  const lines: string[] = [];
  lines.push("Granularity Assessment");
  lines.push("─".repeat(40));

  const actionable = assessments.filter((a) => a.recommendation !== "keep");
  const good = assessments.filter((a) => a.recommendation === "keep");

  for (const a of actionable) {
    const icon = a.recommendation === "break_down" ? "⬇" : "⬆";
    const label = a.recommendation === "break_down" ? "Break down" : "Consolidate";
    lines.push(`${icon} ${a.epicTitle} → ${label}`);
    lines.push(`  ${a.reasoning}`);
    for (const issue of a.issues) {
      lines.push(`  • ${issue}`);
    }
    lines.push("");
  }

  if (good.length > 0) {
    const titles = good.map((a) => a.epicTitle).join(", ");
    lines.push(`✓ Appropriately sized: ${titles}`);
  }

  return lines.join("\n");
}

/**
 * Assess the granularity of proposals by calling the LLM.
 * Returns assessments with recommendations and reasoning for each proposal.
 */
export async function assessGranularity(
  proposals: Proposal[],
  model?: string,
): Promise<GranularityAssessmentResult> {
  const tokenUsage = emptyAnalyzeTokenUsage();

  if (proposals.length === 0) {
    return { assessments: [], tokenUsage };
  }

  const prompt = buildAssessmentPrompt(proposals);
  const result = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
  accumulateTokenUsage(tokenUsage, result.tokenUsage);

  const assessments = parseAssessmentResponse(result.text, proposals);
  return { assessments, tokenUsage };
}

// ── Ideas file import ──

/**
 * Build an LLM prompt for structuring freeform brainstorming notes into PRD
 * proposals. Distinct from `buildAddPrompt` (single description) and
 * `reasonFromFile` (formal spec import via analyze): this prompt is tuned for
 * rough, unstructured idea dumps.
 */
export async function buildIdeasPrompt(
  content: string,
  existingItems: PRDItem[],
  dir: string,
  options?: AddPromptOptions,
): Promise<string> {
  const hasParent = !!options?.parentId;
  const existingSummary = summarizeExisting(existingItems, { withIds: !hasParent });
  const projectContext = await readProjectContext(dir);

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  let parentConstraint = "";
  let placementBlock = "";
  if (hasParent) {
    const parentEntry = findItemInTree(existingItems, options!.parentId!);
    if (parentEntry) {
      parentConstraint = `
IMPORTANT: Scope your response to fit under this existing parent item:
  ID: ${options!.parentId}
  Level: ${parentEntry.level}
  Title: ${parentEntry.title}

Only create children appropriate for a ${parentEntry.level}. For example, if the parent is an epic, create features and tasks. If the parent is a feature, create only tasks.
Do NOT create a new epic — instead use the parent's title as the epic title in your response.`;
    }
  } else if (existingItems.length > 0) {
    placementBlock = AUTO_PLACEMENT_INSTRUCTION;
  }

  return `You are a product requirements analyst reading raw brainstorming notes. These are NOT formal specs — they are rough ideas, bullet points, half-formed thoughts, and informal shorthand. Distill every idea into a well-structured PRD as a JSON array.

${PRD_SCHEMA}

${FEW_SHOT_EXAMPLE}
${CONSOLIDATION_INSTRUCTION}

Interpreting rough notes:
- Capture EVERY idea, no matter how brief or fragmentary. A single word like "caching" is still an idea worth structuring.
- Questions ("what about dark mode?") are feature requests in disguise — treat them as such.
- Expand shorthand and abbreviations ("auth" → "authentication", "perf" → "performance") using the project context to infer meaning.
- When an idea is ambiguous, pick the most likely interpretation given the project context and note your assumption in the task description.
- Contradictory notes (e.g. "use Redis" and "keep it simple, no external deps") should both be captured as separate options with a note about the trade-off.
- Problems without solutions ("login is slow") become investigative tasks (e.g. "Profile and optimize login flow").
- Vague ideas ("make it better") should be fleshed out into concrete tasks based on the project context.

${TASK_QUALITY_RULES}

Deduplication:
- Do NOT include items that duplicate anything already in the existing PRD below.
- Use the project context to understand terminology, architecture, and domain-specific jargon in the notes.

${ANTI_PATTERNS}
${parentConstraint}${placementBlock}
${contextBlock}
Existing PRD:
${existingSummary}

Brainstorming notes:
${content}

${OUTPUT_INSTRUCTION}`;
}

/**
 * Read one or more freeform idea files and structure them into proposals.
 *
 * For well-structured files (markdown with headings, JSON matching the Proposal
 * schema, YAML with title/name fields), extraction is performed locally without
 * an LLM call. Files that cannot be meaningfully extracted fall back to the LLM
 * ideas pipeline.
 *
 * Unlike `reasonFromFile` / `reasonFromFiles` (used by `analyze --file` for
 * formal spec import), the LLM fallback uses a prompt specifically tuned for
 * rough brainstorming notes.
 */
export async function reasonFromIdeasFile(
  filePaths: string[],
  existingItems: PRDItem[],
  options?: { model?: string; dir?: string; parentId?: string },
): Promise<ReasonResult> {
  const tokenUsage = emptyAnalyzeTokenUsage();

  if (filePaths.length === 0) return { proposals: [], tokenUsage };

  const dir = options?.dir ?? process.cwd();

  // Phase 1: Try local extraction for each file.
  // Collect proposals from files that can be parsed without LLM, and
  // accumulate content from files that need LLM fallback.
  const localProposals: Proposal[] = [];
  const llmSections: string[] = [];

  for (const fp of filePaths) {
    const content = await readFile(fp, "utf-8");
    if (content.trim().length === 0) continue;

    const format = detectFileFormat(fp);

    // Try structured parsing for JSON/YAML files (no LLM needed)
    if (format === "json" || format === "yaml") {
      const structured = parseStructuredFile(content, format, existingItems);
      if (structured !== null && structured.length > 0) {
        localProposals.push(...structured);
        continue;
      }
      // Fall through to LLM processing
    }

    // Try local markdown extraction (no LLM needed)
    if (format === "markdown") {
      const { extractFromMarkdown } = await import("./extract.js");
      const extraction = extractFromMarkdown(content, { existingItems, sourceFile: fp });
      if (extraction.proposals.length > 0) {
        localProposals.push(...extraction.proposals);
        continue;
      }
      // Fall through to LLM processing
    }

    // Try local plain text extraction (no LLM needed)
    if (format === "text") {
      const { extractFromText } = await import("./extract.js");
      const extraction = extractFromText(content, { existingItems, sourceFile: fp });
      if (extraction.proposals.length > 0) {
        localProposals.push(...extraction.proposals);
        continue;
      }
      // Fall through to LLM processing
    }

    // File could not be locally extracted — queue for LLM
    if (filePaths.length > 1) {
      llmSections.push(`--- ${fp} ---\n${content.trim()}`);
    } else {
      llmSections.push(content.trim());
    }
  }

  // Phase 2: Fall back to LLM for files that couldn't be locally parsed.
  if (llmSections.length > 0) {
    const combined = llmSections.join("\n\n");
    const prompt = await buildIdeasPrompt(combined, existingItems, dir, {
      parentId: options?.parentId,
    });

    const result = await spawnClaude(prompt, options?.model ?? DEFAULT_MODEL);
    accumulateTokenUsage(tokenUsage, result.tokenUsage);
    localProposals.push(...parseProposalResponse(result.text));
  }

  return { proposals: localProposals, tokenUsage };
}

// ── Batch import ──

/**
 * A single item in a batch import. Each item carries its own content and
 * a format hint that determines how it is processed.
 */
export interface BatchImportItem {
  /** Raw content — file body or free-form text. */
  content: string;
  /** Format hint: "text" and "markdown" go through the LLM ideas pipeline,
   *  "json" is tried as structured parsing first and falls back to LLM. */
  format: "text" | "markdown" | "json";
  /** Human-readable origin label (e.g. file name). Purely informational. */
  source?: string;
}

/** Result of a batch import — proposals plus per-item status. */
export interface BatchImportResult {
  /** Merged, deduplicated proposals across all items. */
  proposals: Proposal[];
  /** Per-item processing status (same order as input). */
  itemResults: Array<{
    source?: string;
    proposalCount: number;
    error?: string;
  }>;
  /** Aggregated token usage across all LLM calls. */
  tokenUsage: AnalyzeTokenUsage;
}

/**
 * Process multiple import items through the smart-add pipeline and return
 * consolidated, deduplicated proposals.
 *
 * JSON items are attempted via direct schema parsing first (no LLM). Text
 * and markdown items are batched into a single LLM call using the ideas
 * prompt for efficiency.
 */
export async function reasonFromBatch(
  items: BatchImportItem[],
  existingItems: PRDItem[],
  options?: { model?: string; dir?: string; parentId?: string },
): Promise<BatchImportResult> {
  const tokenUsage = emptyAnalyzeTokenUsage();
  const itemResults: BatchImportResult["itemResults"] = new Array(items.length);

  if (items.length === 0) {
    return { proposals: [], itemResults: [], tokenUsage };
  }

  const dir = options?.dir ?? process.cwd();
  const allProposals: Proposal[] = [];

  // Separate items into structured (JSON that can be parsed without LLM)
  // and unstructured (text/markdown/fallback JSON that need LLM processing)
  const unstructuredSections: string[] = [];
  const unstructuredIndices: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const trimmed = item.content.trim();

    if (trimmed.length === 0) {
      itemResults[i] = { source: item.source, proposalCount: 0 };
      continue;
    }

    // Try structured parsing for JSON items
    if (item.format === "json") {
      const structured = parseStructuredFile(trimmed, "json", existingItems);
      if (structured !== null && structured.length > 0) {
        allProposals.push(...structured);
        itemResults[i] = { source: item.source, proposalCount: structured.length };
        continue;
      }
      // Fall through to LLM processing
    }

    // Collect for batched LLM processing
    const label = item.source ?? `Item ${i + 1}`;
    unstructuredSections.push(`--- ${label} ---\n${trimmed}`);
    unstructuredIndices.push(i);
  }

  // Process all unstructured items in a single LLM call
  if (unstructuredSections.length > 0) {
    const combined = unstructuredSections.join("\n\n");
    try {
      const prompt = await buildIdeasPrompt(combined, existingItems, dir, {
        parentId: options?.parentId,
      });
      const llmResult = await spawnClaude(prompt, options?.model ?? DEFAULT_MODEL);
      accumulateTokenUsage(tokenUsage, llmResult.tokenUsage);
      const proposals = parseProposalResponse(llmResult.text);
      allProposals.push(...proposals);

      // Distribute proposal count: first item gets the total (LLM processes
      // all unstructured items as a single batch), rest get 0.
      for (let j = 0; j < unstructuredIndices.length; j++) {
        const idx = unstructuredIndices[j];
        itemResults[idx] = {
          source: items[idx].source,
          proposalCount: j === 0 ? proposals.length : 0,
        };
      }
    } catch (err) {
      // Mark all unstructured items as failed
      for (const idx of unstructuredIndices) {
        itemResults[idx] = {
          source: items[idx].source,
          proposalCount: 0,
          error: (err as Error).message,
        };
      }
    }
  }

  // Fill any gaps (shouldn't happen, but defensive)
  for (let i = 0; i < items.length; i++) {
    if (!itemResults[i]) {
      itemResults[i] = { source: items[i].source, proposalCount: 0 };
    }
  }

  return {
    proposals: mergeProposals(allProposals),
    itemResults,
    tokenUsage,
  };
}
