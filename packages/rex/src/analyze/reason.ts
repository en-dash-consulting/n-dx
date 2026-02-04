import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import type { PRDItem } from "../schema/index.js";
import type { ScanResult } from "./scanners.js";
import type { Proposal } from "./propose.js";
import { walkTree } from "../core/tree.js";

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

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

export function parseProposalResponse(raw: string): Proposal[] {
  // Strip markdown code fences if present
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(text);
  const validated = ProposalArraySchema.parse(parsed);

  // Normalize into full Proposal shape with source fields
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

function spawnClaude(prompt: string, model: string): Promise<string> {
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
        const envelope = JSON.parse(stdout);
        resolve(typeof envelope.result === "string" ? envelope.result : stdout);
      } catch {
        resolve(stdout);
      }
    });
  });
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

// ── Scan result summarization + chunking ──

/**
 * Character budget per LLM chunk. Keeps each prompt well within token limits
 * while leaving room for the system instructions, existing PRD summary, and
 * project context that surround the scan data.
 */
export const CHUNK_CHAR_LIMIT = 40_000;

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
 * Split scan results into chunks whose serialised summary stays within
 * `CHUNK_CHAR_LIMIT`. When all results fit in a single chunk, this returns
 * a one-element array — no overhead.
 */
export function chunkScanResults(results: ScanResult[]): ScanResult[][] {
  if (results.length === 0) return [];

  const chunks: ScanResult[][] = [];
  let current: ScanResult[] = [];
  let currentLen = 0;

  for (const r of results) {
    const itemText = summarizeScanResults([r]);
    const itemLen = itemText.length;

    // If adding this item would exceed the limit, flush the current chunk
    // (unless it's empty — an oversized single item gets its own chunk).
    if (current.length > 0 && currentLen + itemLen + 2 > CHUNK_CHAR_LIMIT) {
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

export async function reasonFromFile(
  filePath: string,
  existingItems: PRDItem[],
  model?: string,
): Promise<Proposal[]> {
  const content = await readFile(filePath, "utf-8");
  const format = detectFileFormat(filePath);

  // For JSON/YAML, try direct structured parsing first
  if (format !== "markdown") {
    const structured = parseStructuredFile(content, format, existingItems);
    if (structured !== null) {
      return structured;
    }
  }

  // Fall back to LLM-based extraction
  const existingSummary = summarizeExisting(existingItems);

  const prompt = `You are a product requirements analyst. Read the following document and extract a structured PRD (Product Requirements Document) as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

Group related items into epics and features logically. Derive tasks from actionable items in the document.

${FORMAT_HINTS[format]}

IMPORTANT: Do NOT include items that duplicate anything already in the existing PRD below.

Existing PRD:
${existingSummary}

Document to analyze:
${content}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;

  const raw = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
  return parseProposalResponse(raw);
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
): Promise<Proposal[]> {
  if (filePaths.length === 0) {
    return [];
  }
  if (filePaths.length === 1) {
    return reasonFromFile(filePaths[0], existingItems, model);
  }

  const allProposals: Proposal[] = [];

  for (const fp of filePaths) {
    const proposals = await reasonFromFile(fp, existingItems, model);
    allProposals.push(...proposals);
  }

  return mergeProposals(allProposals);
}

export async function reasonFromScanResults(
  results: ScanResult[],
  existingItems: PRDItem[],
  options?: { model?: string; dir?: string },
): Promise<Proposal[]> {
  const existingSummary = summarizeExisting(existingItems);

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
    return [];
  }

  const model = options?.model ?? DEFAULT_MODEL;
  const allProposals: Proposal[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const scanSummary = summarizeScanResults(chunks[i]);

    const chunkNote =
      chunks.length > 1
        ? `\nNote: This is chunk ${i + 1} of ${chunks.length}. Focus only on the scan results shown here.\n`
        : "";

    const prompt = `You are a product requirements analyst. Given the following raw scan results from automated code analysis, organize them into a clean, well-structured PRD as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

Guidelines:
- Near-duplicate items have already been merged. Focus on semantic grouping and structure.
- If any remaining items are clearly about the same thing, merge them into a single item.
- Create meaningful epic groupings (not just "Tests" or "Documentation")
- Rewrite vague titles to be clear and actionable
- Preserve priority levels from the scan results
- Do NOT include items that duplicate anything in the existing PRD
- Use the project context below to understand the project's purpose, architecture, and terminology; align epic/feature names with the project's domain
${chunkNote}${contextBlock}
Existing PRD:
${existingSummary}

Scan results:
${scanSummary}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;

    const raw = await spawnClaude(prompt, model);
    allProposals.push(...parseProposalResponse(raw));
  }

  // When we made multiple LLM calls, merge overlapping epics/features
  if (chunks.length > 1) {
    return mergeProposals(allProposals);
  }

  return allProposals;
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

Guidelines:
- Break the description into a logical hierarchy of epics, features, and tasks
- Create actionable, specific task titles
- Add acceptance criteria where requirements are clear
- Assign priority levels based on apparent importance
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
): Promise<Proposal[]> {
  const dir = options?.dir ?? process.cwd();
  const prompt = await buildAddPrompt(description, existingItems, dir, {
    parentId: options?.parentId,
  });

  const raw = await spawnClaude(prompt, options?.model ?? DEFAULT_MODEL);
  return parseProposalResponse(raw);
}
