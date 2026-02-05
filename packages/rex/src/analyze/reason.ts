import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import type { PRDItem, TokenUsage, AnalyzeTokenUsage } from "../schema/index.js";
import type { ScanResult } from "./scanners.js";
import type { Proposal, ProposalTask } from "./propose.js";
import { walkTree } from "../core/tree.js";

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/** Maximum number of LLM retry attempts for transient/parse failures. */
export const MAX_RETRIES = 2;

// ── Token usage helpers ──

/** Result from a Claude CLI call, including text and optional token usage. */
export interface ClaudeResult {
  text: string;
  tokenUsage?: TokenUsage;
}

/** Parse token usage from a claude CLI JSON envelope. */
export function parseTokenUsage(envelope: Record<string, unknown>): TokenUsage | undefined {
  // Claude CLI --output-format json includes usage fields at the top level
  const input = envelope.input_tokens ?? envelope.total_input_tokens;
  const output = envelope.output_tokens ?? envelope.total_output_tokens;

  if (typeof input !== "number" && typeof output !== "number") {
    return undefined;
  }

  const usage: TokenUsage = {
    input: typeof input === "number" ? input : 0,
    output: typeof output === "number" ? output : 0,
  };

  const cacheCreation = envelope.cache_creation_input_tokens;
  const cacheRead = envelope.cache_read_input_tokens;
  if (typeof cacheCreation === "number" && cacheCreation > 0) {
    usage.cacheCreationInput = cacheCreation;
  }
  if (typeof cacheRead === "number" && cacheRead > 0) {
    usage.cacheReadInput = cacheRead;
  }

  return usage;
}

/** Create an empty AnalyzeTokenUsage accumulator. */
export function emptyAnalyzeTokenUsage(): AnalyzeTokenUsage {
  return { calls: 0, inputTokens: 0, outputTokens: 0 };
}

/** Accumulate a single call's token usage into the aggregate. */
export function accumulateTokenUsage(
  aggregate: AnalyzeTokenUsage,
  usage?: TokenUsage,
): void {
  aggregate.calls++;
  if (!usage) return;
  aggregate.inputTokens += usage.input;
  aggregate.outputTokens += usage.output;
  if (usage.cacheCreationInput) {
    aggregate.cacheCreationInputTokens =
      (aggregate.cacheCreationInputTokens ?? 0) + usage.cacheCreationInput;
  }
  if (usage.cacheReadInput) {
    aggregate.cacheReadInputTokens =
      (aggregate.cacheReadInputTokens ?? 0) + usage.cacheReadInput;
  }
}

// ── Zod schemas for LLM response validation ──

const ProposalTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  tags: z.array(z.string()).optional(),
});

const ProposalFeatureSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  tasks: z.array(ProposalTaskSchema),
});

const ProposalSchema = z.object({
  epic: z.object({ title: z.string() }),
  features: z.array(ProposalFeatureSchema),
});

const ProposalArraySchema = z.array(ProposalSchema);

// ── Helpers ──

function summarizeExisting(items: PRDItem[]): string {
  const lines: string[] = [];
  for (const { item, parents } of walkTree(items)) {
    const indent = "  ".repeat(parents.length);
    lines.push(`${indent}- [${item.level}] ${item.title} (${item.status})`);
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

/**
 * Walk a JSON structure starting at `open` (`[` or `{`), tracking nesting
 * and string state, and return the index of the matching close character.
 * Returns -1 if the structure is never closed (truncated).
 */
function findMatchingClose(text: string, startIndex: number): number {
  const open = text[startIndex];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Extract JSON text from an LLM response, handling markdown fences,
 * leading prose, and trailing text after the JSON array or object.
 */
export function extractJson(raw: string): string {
  let text = raw.trim();

  // Try markdown code fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Find the start of a top-level JSON array. When text already starts with
  // `[`, the search begins at index 0. Otherwise, look for `[` at the
  // beginning of a line (to avoid matching arrays embedded in object values).
  let arrayStart = -1;
  if (text.startsWith("[")) {
    arrayStart = 0;
  } else {
    const match = text.match(/(?:^|\n)\s*(\[)/);
    if (match) {
      arrayStart = text.indexOf(match[1], match.index!);
    }
  }

  if (arrayStart >= 0) {
    text = text.slice(arrayStart);
    const closeIdx = findMatchingClose(text, 0);
    if (closeIdx >= 0) {
      return text.slice(0, closeIdx + 1);
    }
    // Unclosed array — return the sliced text for downstream repair
    return text;
  }

  // Handle JSON objects: find the first `{` (at start or on its own line)
  // and match its closing `}`, stripping leading and trailing prose.
  let objStart = -1;
  if (text.startsWith("{")) {
    objStart = 0;
  } else {
    const match = text.match(/(?:^|\n)\s*(\{)/);
    if (match) {
      objStart = text.indexOf(match[1], match.index!);
    }
  }

  if (objStart >= 0) {
    text = text.slice(objStart);
    const closeIdx = findMatchingClose(text, 0);
    if (closeIdx >= 0) {
      return text.slice(0, closeIdx + 1);
    }
    // Unclosed object — return sliced text for downstream repair
    return text;
  }

  return text;
}

/**
 * Attempt to repair truncated JSON by closing any open structures.
 * Handles trailing commas, truncated strings, mid-key/mid-value
 * truncation, and unclosed brackets/braces.
 * Returns repaired JSON string or null if not repairable.
 */
/**
 * Strip incomplete escape sequences from the end of a truncated JSON string.
 * Handles:
 *  - trailing lone backslash (`"path\` → `"path`)
 *  - partial unicode escapes (`"emoji \u00` → `"emoji `)
 */
function stripTrailingEscape(s: string): string {
  // Strip partial \uXXXX (1-4 hex digits after \u)
  const partialUnicode = s.match(/\\u[\da-fA-F]{0,3}$/);
  if (partialUnicode) return s.slice(0, partialUnicode.index);

  // Strip lone trailing backslash (incomplete escape)
  if (s.endsWith("\\")) {
    // But not an escaped backslash (\\) — count consecutive trailing backslashes
    let count = 0;
    for (let i = s.length - 1; i >= 0 && s[i] === "\\"; i--) count++;
    // Odd number means the last backslash is a lone escape starter
    if (count % 2 === 1) return s.slice(0, -1);
  }

  return s;
}

export function repairTruncatedJson(text: string): string | null {
  // Only attempt repair on text that starts as a JSON array or object
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;

  // Try parsing as-is first
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue with repair
  }

  // Track open brackets, braces, and string state
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const ch of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (ch === "]" || ch === "}") {
      stack.pop();
    }
  }

  if (stack.length === 0) return null;

  // Close any unclosed string, stripping incomplete escape sequences first
  let repaired = trimmed;
  if (inString) repaired = stripTrailingEscape(repaired) + '"';

  // Close structures in reverse order
  while (stack.length > 0) {
    const open = stack.pop()!;
    repaired += open === "[" ? "]" : "}";
  }

  // Validate the repaired JSON actually parses
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    // The naive close didn't work (trailing commas, partial values, etc.)
    // Try progressively stripping trailing junk before closing
  }

  // Strategy: progressively strip trailing incomplete tokens from the
  // truncation point. Each pattern removes one layer of junk:
  //   - trailing commas/whitespace
  //   - dangling colons (key with no value)
  //   - partial key-value pairs (e.g. `,"feat` or `,"key":"val`)
  //   - orphaned keys without values
  //   - bare partial literals after a colon (e.g. `:"nul`, `:"fals`, `:"tr`)
  const stripPatterns = [
    // Trailing comma, colon, or whitespace
    /[,:\s]+$/,
    // Dangling key with optional colon: `,"key":` or `,"key"` or `,"ke`
    /,\s*"[^"]*"?\s*:?\s*$/,
    // Dangling value token (partial string, number, bool, null)
    /,\s*(?:"[^"]*"?|[\d.]+|true|false|null)\s*$/,
    // Orphan key without comma prefix: `"key":` at end of object
    /"\w*"?\s*:?\s*$/,
    // Bare partial literal after colon (handles truncated true/false/null)
    /:\s*(?:t(?:r(?:ue?)?)?|f(?:a(?:l(?:se?)?)?)?|n(?:u(?:ll?)?)?|[\d.]+)\s*$/,
  ];

  let content = trimmed;
  if (inString) content = stripTrailingEscape(content) + '"';

  for (let attempts = 0; attempts < 20; attempts++) {
    // Recompute the structure stack for the current content
    let innerString = false;
    let innerEscaped = false;
    const innerStack: string[] = [];

    for (const ch of content) {
      if (innerEscaped) { innerEscaped = false; continue; }
      if (ch === "\\") { innerEscaped = true; continue; }
      if (ch === '"') { innerString = !innerString; continue; }
      if (innerString) continue;
      if (ch === "[" || ch === "{") innerStack.push(ch);
      else if (ch === "]" || ch === "}") innerStack.pop();
    }

    let candidate = content;
    if (innerString) candidate = stripTrailingEscape(candidate) + '"';

    const closingStack = [...innerStack];
    while (closingStack.length > 0) {
      const open = closingStack.pop()!;
      candidate += open === "[" ? "]" : "}";
    }

    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try each strip pattern until one makes progress
      let stripped = false;
      for (const pattern of stripPatterns) {
        const result = content.replace(pattern, "");
        if (result.length < content.length) {
          content = result;
          stripped = true;
          break;
        }
      }
      if (!stripped) break;
    }
  }

  return null;
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
    epic: { title: p.epic.title, source: "llm" },
    features: p.features.map((f) => ({
      title: f.title,
      source: "llm",
      description: f.description,
      tasks: f.tasks.map((t) => ({
        title: t.title,
        source: "llm",
        sourceFile: "",
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        priority: t.priority,
        tags: t.tags,
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

// ── LLM interaction ──

function spawnClaudeOnce(prompt: string, model: string): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--model", model,
    ];

    const proc = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(
          "claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
        ));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `claude exited with code ${code}`));
        return;
      }

      // --output-format json wraps result in { "result": "...", ... }
      try {
        const envelope = JSON.parse(stdout) as Record<string, unknown>;
        const text = typeof envelope.result === "string" ? envelope.result : stdout;
        const tokenUsage = parseTokenUsage(envelope);
        resolve({ text, tokenUsage });
      } catch {
        resolve({ text: stdout });
      }
    });
  });
}

/**
 * Spawn claude CLI with automatic retry on transient failures.
 * Retries up to MAX_RETRIES times with exponential backoff.
 * Non-retryable errors (ENOENT for missing CLI) are thrown immediately.
 *
 * Returns the result text and token usage from the CLI envelope.
 */
export async function spawnClaude(prompt: string, model: string): Promise<ClaudeResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await spawnClaudeOnce(prompt, model);
    } catch (err) {
      lastError = err as Error;

      // Don't retry if the CLI itself is missing
      if (lastError.message.includes("claude CLI not found")) {
        throw lastError;
      }

      // Don't retry on the last attempt
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError!;
}

// ── Format detection ──

export type FileFormat = "markdown" | "json" | "yaml";

const FORMAT_MAP: Record<string, FileFormat> = {
  ".md": "markdown",
  ".txt": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function detectFileFormat(filePath: string): FileFormat {
  const ext = extname(filePath).toLowerCase();
  return FORMAT_MAP[ext] ?? "markdown";
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
  if (format === "markdown") return null;

  // For JSON, first try to parse as the full Proposal schema
  if (format === "json") {
    try {
      let text = content.trim();
      const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) text = fenceMatch[1].trim();

      const parsed = JSON.parse(text);
      const validated = ProposalArraySchema.parse(parsed);

      if (validated.length === 0) return null;

      // Existing title set for dedup
      const existingTitles = new Set(
        existingItems.map((item) => normalize(item.title)),
      );

      return validated
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
    } catch {
      // Not in Proposal schema — fall through to generic extraction
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
  json:
    "The document is in JSON format. Extract meaningful requirements from the structured data, including nested objects and arrays.",
  yaml:
    "The document is in YAML format. Extract meaningful requirements from the structured data fields.",
};

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
            "description": "Handle the authorization code exchange and token storage after provider redirects back to our app",
            "acceptanceCriteria": [
              "Handles Google OAuth2 flow end-to-end",
              "Stores refresh token securely",
              "Returns meaningful error on provider rejection"
            ],
            "priority": "high",
            "tags": ["auth", "backend"]
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
 */
export function chunkScanResults(results: ScanResult[]): ScanResult[][] {
  if (results.length === 0) return [];

  const chunks: ScanResult[][] = [];
  let current: ScanResult[] = [];
  let currentLen = 0;

  for (const r of results) {
    const itemText = summarizeScanResults([r]);
    const itemLen = itemText.length;

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
  if (format !== "markdown") {
    const structured = parseStructuredFile(content, format, existingItems);
    if (structured !== null) {
      return { proposals: structured, tokenUsage };
    }
  }

  // Fall back to LLM-based extraction
  const existingSummary = summarizeExisting(existingItems);

  const prompt = `You are a product requirements analyst. Read the following document and extract a structured PRD (Product Requirements Document) as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Guidelines:
- Group related items into epics and features logically
- Derive tasks from actionable items in the document
- Every task MUST have either a description or acceptanceCriteria (preferably both)
- Task titles must be specific and actionable (verb-first, e.g. "Implement X", "Add Y")
- Each task should represent a single unit of work completable in one session
- Assign priority based on: blocking dependencies → user-facing impact → technical debt
- Do NOT include items that duplicate anything already in the existing PRD

${FORMAT_HINTS[format]}

Existing PRD:
${existingSummary}

Document to analyze:
${content}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;

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

    const prompt = `You are a product requirements analyst. Given the following raw scan results from automated code analysis, organize them into a clean, well-structured PRD as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Guidelines:
- Near-duplicate items have already been merged. Focus on semantic grouping and structure.
- If any remaining items are clearly about the same thing, merge them into a single item.
- Create meaningful epic groupings (not just "Tests" or "Documentation")
- Rewrite vague titles to be clear and actionable (verb-first, e.g. "Implement X", "Add Y")
- Every task MUST have either a description or acceptanceCriteria (preferably both)
- Each task should represent a single unit of work completable in one session
- Preserve priority levels from the scan results
- Assign priority based on: blocking dependencies → user-facing impact → technical debt
- Do NOT include items that duplicate anything in the existing PRD
- Use the project context below to understand the project's purpose, architecture, and terminology; align epic/feature names with the project's domain
${chunkNote}${contextBlock}
Existing PRD:
${existingSummary}

Scan results:
${scanSummary}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;

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
  const existingSummary = summarizeExisting(existingItems);
  const projectContext = await readProjectContext(dir);

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  let parentConstraint = "";
  if (options?.parentId) {
    // Find the parent in the tree and describe it
    const parentEntry = findItemInTree(existingItems, options.parentId);
    if (parentEntry) {
      parentConstraint = `
IMPORTANT: Scope your response to fit under this existing parent item:
  ID: ${options.parentId}
  Level: ${parentEntry.level}
  Title: ${parentEntry.title}

Only create children appropriate for a ${parentEntry.level}. For example, if the parent is an epic, create features and tasks. If the parent is a feature, create only tasks.
Do NOT create a new epic — instead use the parent's title as the epic title in your response.`;
    }
  }

  return `You are a product requirements analyst. Given the following natural-language description, create a structured PRD breakdown as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Guidelines:
- Break the description into a logical hierarchy of epics, features, and tasks
- Task titles must be specific and actionable (verb-first, e.g. "Implement X", "Add Y")
- Every task MUST have either a description or acceptanceCriteria (preferably both)
- Each task should represent a single unit of work completable in one session
- Add acceptance criteria where requirements are clear
- Assign priority based on: blocking dependencies → user-facing impact → technical debt
- Group related work into features under appropriate epics
- Do NOT include items that duplicate anything already in the existing PRD below
- Use the project context to understand terminology and architecture
${parentConstraint}
${contextBlock}
Existing PRD:
${existingSummary}

Description to add:
${description}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;
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
  const existingSummary = summarizeExisting(existingItems);
  const projectContext = await readProjectContext(dir);

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  let parentConstraint = "";
  if (options?.parentId) {
    const parentEntry = findItemInTree(existingItems, options.parentId);
    if (parentEntry) {
      parentConstraint = `
IMPORTANT: Scope your response to fit under this existing parent item:
  ID: ${options.parentId}
  Level: ${parentEntry.level}
  Title: ${parentEntry.title}

Only create children appropriate for a ${parentEntry.level}. For example, if the parent is an epic, create features and tasks. If the parent is a feature, create only tasks.
Do NOT create a new epic — instead use the parent's title as the epic title in your response.`;
    }
  }

  const numbered = descriptions
    .map((d, i) => `${i + 1}. ${d}`)
    .join("\n");

  return `You are a product requirements analyst. You have been given multiple feature descriptions at once. Analyze ALL of them and create a unified, coherent PRD breakdown as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Guidelines:
- You are receiving ${descriptions.length} separate descriptions. Treat each one as a distinct piece of work.
- Group related descriptions under the same epic when they naturally belong together.
- Keep unrelated descriptions in separate epics.
- Task titles must be specific and actionable (verb-first, e.g. "Implement X", "Add Y")
- Every task MUST have either a description or acceptanceCriteria (preferably both)
- Each task should represent a single unit of work completable in one session
- Add acceptance criteria where requirements are clear
- Assign priority based on: blocking dependencies → user-facing impact → technical debt
- Do NOT include items that duplicate anything already in the existing PRD below
- Do NOT create duplicate items across descriptions — if two descriptions overlap, merge them
- Use the project context to understand terminology and architecture
${parentConstraint}
${contextBlock}
Existing PRD:
${existingSummary}

Descriptions to add:
${numbered}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;
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
  const existingSummary = summarizeExisting(existingItems);
  const projectContext = await readProjectContext(dir);

  const contextBlock = projectContext
    ? `\nProject context (from documentation):\n${projectContext}\n`
    : "";

  let parentConstraint = "";
  if (options?.parentId) {
    const parentEntry = findItemInTree(existingItems, options.parentId);
    if (parentEntry) {
      parentConstraint = `
IMPORTANT: Scope your response to fit under this existing parent item:
  ID: ${options.parentId}
  Level: ${parentEntry.level}
  Title: ${parentEntry.title}

Only create children appropriate for a ${parentEntry.level}. For example, if the parent is an epic, create features and tasks. If the parent is a feature, create only tasks.
Do NOT create a new epic — instead use the parent's title as the epic title in your response.`;
    }
  }

  return `You are a product requirements analyst reading raw brainstorming notes. These are NOT formal specs — they are rough ideas, bullet points, half-formed thoughts, stream-of-consciousness fragments, and informal shorthand. Your job is to distill every idea into a well-structured PRD as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

${FEW_SHOT_EXAMPLE}

Interpreting rough notes:
- Capture EVERY idea, no matter how brief or fragmentary. A single word like "caching" is still an idea worth structuring.
- Questions ("what about dark mode?") are feature requests in disguise — treat them as such.
- Shorthand and abbreviations are common in notes. Expand "auth" → "authentication", "perf" → "performance", etc. using the project context to infer meaning.
- When an idea is ambiguous or could mean multiple things, pick the most likely interpretation given the project context and note your assumption in the task description (e.g. "Assuming this refers to client-side caching based on project architecture").
- Contradictory notes (e.g. "use Redis" and "keep it simple, no external deps") should both be captured as separate options with a note about the trade-off.
- If notes mention a problem without a solution ("login is slow"), turn it into an investigative task (e.g. "Profile and optimize login flow").
- Vague ideas ("make it better", "improve UX") should be fleshed out into concrete, actionable tasks based on what the project context suggests.

Structuring guidelines:
- Group related ideas into logical epics and features.
- Task titles must be specific and actionable (verb-first, e.g. "Implement X", "Add Y").
- Every task MUST have either a description or acceptanceCriteria (preferably both).
- Each task should represent a single unit of work completable in one session.
- Assign priority based on: blocking dependencies → user-facing impact → technical debt.
- Do NOT include items that duplicate anything already in the existing PRD below.
- Use the project context to understand terminology, architecture, and domain-specific jargon in the notes.
${parentConstraint}
${contextBlock}
Existing PRD:
${existingSummary}

Brainstorming notes:
${content}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;
}

/**
 * Read one or more freeform idea files and structure them into proposals via
 * LLM. Unlike `reasonFromFile` / `reasonFromFiles` (used by `analyze --file`
 * for formal spec import), this function uses a prompt specifically tuned for
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

  // Read and concatenate all idea files
  const sections: string[] = [];
  for (const fp of filePaths) {
    const content = await readFile(fp, "utf-8");
    if (content.trim().length === 0) continue;
    if (filePaths.length > 1) {
      sections.push(`--- ${fp} ---\n${content.trim()}`);
    } else {
      sections.push(content.trim());
    }
  }

  if (sections.length === 0) return { proposals: [], tokenUsage };

  const combined = sections.join("\n\n");
  const prompt = await buildIdeasPrompt(combined, existingItems, dir, {
    parentId: options?.parentId,
  });

  const result = await spawnClaude(prompt, options?.model ?? DEFAULT_MODEL);
  accumulateTokenUsage(tokenUsage, result.tokenUsage);
  return { proposals: parseProposalResponse(result.text), tokenUsage };
}
