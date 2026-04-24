import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PRDDocument } from "../schema/index.js";
import { validateDocument } from "../schema/validate.js";
import { parseDocument } from "./markdown-parser.js";
import { serializeDocument } from "./markdown-serializer.js";
import { PRD_FILENAME } from "./file-adapter.js";

export const PRD_MARKDOWN_FILENAME = "prd.md";

type MarkdownMigrationSkipReason = "markdown-exists" | "json-missing";

export interface MarkdownMigrationResult {
  migrated: boolean;
  outputPath: string;
  sourcePath: string;
  reason?: MarkdownMigrationSkipReason;
}

export class PRDMarkdownMigrationError extends Error {
  readonly code:
    | "read-failed"
    | "json-parse-failed"
    | "invalid-document"
    | "generated-parse-failed"
    | "roundtrip-mismatch";

  constructor(
    code: PRDMarkdownMigrationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "PRDMarkdownMigrationError";
    this.code = code;
  }
}

export async function migrateJsonPrdToMarkdown(rexDir: string): Promise<MarkdownMigrationResult> {
  const sourcePath = join(rexDir, PRD_FILENAME);
  const outputPath = join(rexDir, PRD_MARKDOWN_FILENAME);

  if (await pathExists(outputPath)) {
    return { migrated: false, outputPath, sourcePath, reason: "markdown-exists" };
  }

  if (!await pathExists(sourcePath)) {
    return { migrated: false, outputPath, sourcePath, reason: "json-missing" };
  }

  const doc = await loadAndValidateJsonDocument(sourcePath);
  const markdown = serializeDocument(doc);
  const parsed = parseDocument(markdown);
  if (!parsed.ok) {
    throw new PRDMarkdownMigrationError(
      "generated-parse-failed",
      `Generated markdown could not be parsed: ${parsed.error.message}. ` +
      `Inspect ${sourcePath} for unsupported data and retry.`,
    );
  }

  if (!isDeepStrictEqual(normalizeDocumentForMarkdown(parsed.data), normalizeDocumentForMarkdown(doc))) {
    throw new PRDMarkdownMigrationError(
      "roundtrip-mismatch",
      "Generated markdown did not round-trip back to the original PRD tree. " +
      "Inspect fields such as timestamps, duration, token usage, and empty arrays before retrying.",
    );
  }

  await writeFile(outputPath, markdown, "utf-8");
  return { migrated: true, outputPath, sourcePath };
}

async function loadAndValidateJsonDocument(sourcePath: string): Promise<PRDDocument> {
  let raw: string;
  try {
    raw = await readFile(sourcePath, "utf-8");
  } catch (error) {
    throw new PRDMarkdownMigrationError(
      "read-failed",
      `Failed to read ${sourcePath}: ${(error as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PRDMarkdownMigrationError(
      "json-parse-failed",
      `Failed to parse ${sourcePath} as JSON: ${(error as Error).message}`,
    );
  }

  const validated = validateDocument(parsed);
  if (!validated.ok) {
    throw new PRDMarkdownMigrationError(
      "invalid-document",
      `Invalid PRD document in ${sourcePath}: ${validated.errors.message}`,
    );
  }

  return validated.data as PRDDocument;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeDocumentForMarkdown(doc: PRDDocument): PRDDocument {
  return normalizeValue(doc) as PRDDocument;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (Array.isArray(entry) && entry.length === 0 && key !== "items") continue;
    normalized[key] = normalizeValue(entry);
  }
  return normalized;
}
