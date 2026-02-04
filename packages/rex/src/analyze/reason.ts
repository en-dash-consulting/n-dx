import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";
import type { PRDItem } from "../schema/index.js";
import type { ScanResult } from "./scanners.js";
import type { Proposal } from "./propose.js";
import { walkTree } from "../core/tree.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

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

export async function reasonFromScanResults(
  results: ScanResult[],
  existingItems: PRDItem[],
  model?: string,
): Promise<Proposal[]> {
  const existingSummary = summarizeExisting(existingItems);

  // Summarize scan results for the LLM
  const scanSummary = results.map((r) => {
    const parts = [`[${r.kind}] ${r.name} (source: ${r.source}, file: ${r.sourceFile})`];
    if (r.description) parts.push(`  description: ${r.description}`);
    if (r.acceptanceCriteria?.length) parts.push(`  criteria: ${r.acceptanceCriteria.join("; ")}`);
    if (r.priority) parts.push(`  priority: ${r.priority}`);
    if (r.tags?.length) parts.push(`  tags: ${r.tags.join(", ")}`);
    return parts.join("\n");
  }).join("\n\n");

  const prompt = `You are a product requirements analyst. Given the following raw scan results from automated code analysis, organize them into a clean, well-structured PRD as a JSON array.

Each element must be an object with:
- "epic": { "title": string }
- "features": array of { "title": string, "description"?: string, "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[] } }

Guidelines:
- Merge duplicate or near-duplicate items
- Create meaningful epic groupings (not just "Tests" or "Documentation")
- Rewrite vague titles to be clear and actionable
- Preserve priority levels from the scan results
- Do NOT include items that duplicate anything in the existing PRD

Existing PRD:
${existingSummary}

Scan results:
${scanSummary}

Respond with ONLY a valid JSON array, no explanation or markdown fences.`;

  const raw = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
  return parseProposalResponse(raw);
}
