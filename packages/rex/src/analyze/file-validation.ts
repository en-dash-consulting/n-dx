/**
 * File format validation and error handling for requirements import.
 *
 * Validates file inputs before processing: checks extensions, MIME types
 * via magic byte detection, file size, binary content, encoding, and
 * provides format-specific syntax warnings for markdown, text, JSON, and YAML.
 *
 * @module rex/analyze/file-validation
 */

import { stat, open } from "node:fs/promises";
import { extname, basename } from "node:path";
import type { FileFormat } from "./reason.js";

// ── Constants ─────────────────────────────────────────────────────

/** Maximum file size in bytes (10 MB). */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Threshold at which a "large file" warning is emitted (5 MB). */
export const LARGE_FILE_WARNING_BYTES = 5 * 1024 * 1024;

/** Number of bytes to sample for binary content detection. */
const BINARY_CHECK_BYTES = 8192;

/**
 * Known binary file magic byte signatures. If a file's first bytes match
 * any of these, the file is treated as binary regardless of its extension.
 */
const MAGIC_SIGNATURES: ReadonlyArray<{ name: string; bytes: readonly number[] }> = [
  { name: "PNG",  bytes: [0x89, 0x50, 0x4E, 0x47] },
  { name: "JPEG", bytes: [0xFF, 0xD8, 0xFF] },
  { name: "GIF",  bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: "PDF",  bytes: [0x25, 0x50, 0x44, 0x46] },
  { name: "ZIP",  bytes: [0x50, 0x4B, 0x03, 0x04] },
  { name: "GZIP", bytes: [0x1F, 0x8B] },
  { name: "ELF",  bytes: [0x7F, 0x45, 0x4C, 0x46] },
  { name: "WASM", bytes: [0x00, 0x61, 0x73, 0x6D] },
  { name: "BMP",  bytes: [0x42, 0x4D] },
  { name: "TIFF", bytes: [0x49, 0x49, 0x2A, 0x00] },
  { name: "WEBP", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header
];

/**
 * Supported file extensions mapped to their format category.
 * Only these extensions are accepted for requirements import.
 */
export const SUPPORTED_EXTENSIONS: Readonly<Record<string, FileFormat>> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".text": "text",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
};

// ── Error types ────────────────────────────────────────────────────

/** Error codes for file validation failures. */
export type FileValidationErrorCode =
  | "FILE_NOT_FOUND"
  | "UNSUPPORTED_FORMAT"
  | "FILE_TOO_LARGE"
  | "BINARY_CONTENT"
  | "EMPTY_FILE"
  | "READ_ERROR"
  | "CONTENT_TYPE_MISMATCH"
  | "ENCODING_ERROR"
  | "PARSE_ERROR";

/**
 * Structured error for file validation failures.
 * Carries a machine-readable code and a human-readable suggestion.
 */
export class FileValidationError extends Error {
  readonly code: FileValidationErrorCode;
  readonly suggestion: string;

  constructor(message: string, code: FileValidationErrorCode, suggestion: string) {
    super(message);
    this.name = "FileValidationError";
    this.code = code;
    this.suggestion = suggestion;
  }
}

// ── Result types ──────────────────────────────────────────────────

/** Successful validation result. */
export interface FileValidationResult {
  /** Resolved file path. */
  filePath: string;
  /** Detected format based on extension. */
  format: FileFormat;
  /** File size in bytes. */
  sizeBytes: number;
  /** Non-fatal warnings from file-level validation (e.g., large file). */
  warnings?: string[];
}

/** Markdown content validation result. */
export interface MarkdownValidationResult {
  /** Whether the content is processable (true even with warnings). */
  valid: boolean;
  /** Non-fatal warnings about potentially problematic markdown syntax. */
  warnings: string[];
}

// ── Validation functions ──────────────────────────────────────────

/**
 * Validate a file path for requirements import.
 *
 * Checks (in order):
 * 1. File exists and is readable
 * 2. Extension is in the supported set
 * 3. File size is within limits
 * 4. Content is not binary (null byte detection)
 * 5. Content type matches extension (magic byte detection)
 * 6. Content is not empty
 *
 * @throws {FileValidationError} with specific code and suggestion
 */
export async function validateFileInput(filePath: string): Promise<FileValidationResult> {
  const fileName = basename(filePath);

  // 1. Check file exists
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new FileValidationError(
        `File not found: "${fileName}"`,
        "FILE_NOT_FOUND",
        "Check the file path and try again.",
      );
    }
    throw new FileValidationError(
      `Cannot read file "${fileName}": ${(err as Error).message}`,
      "READ_ERROR",
      "Check file permissions and try again.",
    );
  }

  // 2. Validate extension
  const ext = extname(filePath).toLowerCase();
  const format = SUPPORTED_EXTENSIONS[ext];
  if (!format) {
    const supported = Object.keys(SUPPORTED_EXTENSIONS).join(", ");
    throw new FileValidationError(
      `Unsupported file format "${ext || "(no extension)"}": "${fileName}"`,
      "UNSUPPORTED_FORMAT",
      `Supported formats: ${supported}`,
    );
  }

  // 3. Check file size
  if (fileStats.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (fileStats.size / (1024 * 1024)).toFixed(1);
    const limitMB = (MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    throw new FileValidationError(
      `File "${fileName}" is too large (${sizeMB} MB).`,
      "FILE_TOO_LARGE",
      `Maximum file size is ${limitMB} MB. Consider splitting into smaller files.`,
    );
  }

  // 4. Check for empty files
  if (fileStats.size === 0) {
    throw new FileValidationError(
      `File "${fileName}" is empty.`,
      "EMPTY_FILE",
      "The file must contain text content to import requirements from.",
    );
  }

  // 5. Read a header buffer for binary + magic byte checks
  const headerBuffer = await readFileHeader(filePath);

  // 5a. Check for binary content (null bytes)
  if (containsBinaryBytes(headerBuffer)) {
    throw new FileValidationError(
      `File "${fileName}" appears to contain binary data.`,
      "BINARY_CONTENT",
      "Only text-based files are supported. Ensure the file is a valid text file.",
    );
  }

  // 5b. Check for content-type mismatch via magic bytes
  const detectedType = detectMagicBytes(headerBuffer);
  if (detectedType) {
    throw new FileValidationError(
      `File "${fileName}" has a ${ext} extension but appears to be a ${detectedType} file.`,
      "CONTENT_TYPE_MISMATCH",
      `The file content does not match the "${ext}" extension. Rename the file or provide the correct format.`,
    );
  }

  // 6. Check whitespace-only content
  const sample = headerBuffer.toString("utf-8");
  if (sample.trim().length === 0) {
    throw new FileValidationError(
      `File "${fileName}" is empty.`,
      "EMPTY_FILE",
      "The file must contain text content to import requirements from.",
    );
  }

  // Non-fatal warnings
  const warnings: string[] = [];
  if (fileStats.size > LARGE_FILE_WARNING_BYTES) {
    const sizeMB = (fileStats.size / (1024 * 1024)).toFixed(1);
    warnings.push(
      `File is ${sizeMB} MB. Large files may take longer to process and use more memory.`,
    );
  }

  return {
    filePath,
    format,
    sizeBytes: fileStats.size,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Validate markdown content for potential syntax issues.
 *
 * Does not reject content — returns warnings that might affect
 * extraction quality. The content is always considered processable.
 */
export function validateMarkdownContent(content: string): MarkdownValidationResult {
  const warnings: string[] = [];
  const lines = content.split("\n");

  // Check for unclosed code fences
  let openFences = 0;
  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      openFences++;
    }
  }
  if (openFences % 2 !== 0) {
    warnings.push(
      "Unclosed code fence detected. Content inside unclosed fences will be ignored during extraction.",
    );
  }

  // Check for malformed heading syntax (# without space)
  const malformedHeadings: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Matches lines that start with # but don't have a space after them
    // Excludes lines inside code fences and legitimate non-heading uses
    if (/^#{1,6}[^\s#]/.test(line.trim())) {
      malformedHeadings.push(i + 1);
    }
  }
  if (malformedHeadings.length > 0) {
    const lineRefs = malformedHeadings.length <= 3
      ? `line${malformedHeadings.length > 1 ? "s" : ""} ${malformedHeadings.join(", ")}`
      : `${malformedHeadings.length} lines`;
    warnings.push(
      `Possible malformed heading syntax at ${lineRefs} (# without space). These lines will not be recognized as headings.`,
    );
  }

  // Collect heading levels
  const headingLevels: number[] = [];
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+/);
    if (match) {
      headingLevels.push(match[1].length);
    }
  }

  // Check for deeply nested headings (h5+)
  const deepLevels = headingLevels.filter((l) => l >= 5);
  if (deepLevels.length > 0) {
    warnings.push(
      "Document contains deeply nested headings (h5+). Deep heading levels are collapsed to task level during extraction.",
    );
  }

  // Check for skipped heading levels (e.g., h1 → h3 without h2)
  if (headingLevels.length >= 2) {
    const uniqueSorted = [...new Set(headingLevels)].sort((a, b) => a - b);
    for (let i = 1; i < uniqueSorted.length; i++) {
      if (uniqueSorted[i] - uniqueSorted[i - 1] > 1) {
        warnings.push(
          `Heading levels skip from h${uniqueSorted[i - 1]} to h${uniqueSorted[i]}. ` +
          "Extraction will still work, but intermediate levels may improve structure.",
        );
        break; // One warning is enough
      }
    }
  }

  // Check for unclosed YAML front matter
  if (lines[0]?.trim() === "---") {
    const closingIndex = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (closingIndex === -1) {
      warnings.push(
        "Unclosed YAML front matter (opening '---' without closing '---'). " +
        "All content may be treated as front matter and ignored during extraction.",
      );
    }
  }

  // Check for unmatched HTML block-level tags
  const blockTags = ["div", "section", "article", "details", "table"];
  for (const tag of blockTags) {
    const openRe = new RegExp(`<${tag}[\\s>]`, "gi");
    const closeRe = new RegExp(`</${tag}>`, "gi");
    const openCount = (content.match(openRe) ?? []).length;
    const closeCount = (content.match(closeRe) ?? []).length;
    if (openCount > 0 && openCount !== closeCount) {
      warnings.push(
        `Unmatched <${tag}> tags detected (${openCount} opening, ${closeCount} closing). ` +
        "Content inside unmatched tags may not be extracted correctly.",
      );
      break; // One HTML warning is enough
    }
  }

  return {
    valid: true,
    warnings,
  };
}

/**
 * Validate plain text content for potential quality issues.
 *
 * Like `validateMarkdownContent`, this does not reject content — it returns
 * warnings that might affect extraction quality. Text is always processable.
 *
 * Checks:
 * - Mixed indentation (tabs + spaces) which can confuse hierarchy detection
 * - Very long lines that may indicate non-requirements content
 * - No detectable structure (no headers, bullets, or requirement keywords)
 */
export function validateTextContent(content: string): TextValidationResult {
  const warnings: string[] = [];
  const lines = content.split("\n");

  // Check for mixed indentation (tabs and spaces in the same file)
  let hasTabs = false;
  let hasSpaceIndent = false;
  for (const line of lines) {
    if (/^\t/.test(line)) hasTabs = true;
    if (/^ {2,}/.test(line) && !/^\s*$/.test(line)) hasSpaceIndent = true;
  }
  if (hasTabs && hasSpaceIndent) {
    warnings.push(
      "Mixed indentation detected (tabs and spaces). Indentation-based hierarchy detection may be less accurate.",
    );
  }

  // Check for very long lines (>500 chars) — may indicate pasted logs or data
  const longLines = lines.filter((l) => l.length > 500);
  if (longLines.length > 3) {
    warnings.push(
      `${longLines.length} lines exceed 500 characters. Very long lines are typically truncated during extraction.`,
    );
  }

  // Check for zero detectable structure
  const hasHeaders = lines.some((l) => {
    const t = l.trim();
    // ALL CAPS (multi-word or 6+ chars)
    if (/^[A-Z][A-Z0-9 ]{4,}$/.test(t) && /\s/.test(t)) return true;
    // Colon header
    if (/^[A-Z][^:]{0,50}:\s*/.test(t)) return true;
    // Numbered section
    if (/^\d+\.\d+/.test(t)) return true;
    return false;
  });
  const hasBullets = lines.some((l) => /^\s*(?:[-*]|\d+\.)\s+/.test(l));
  const hasUnderlines = lines.some((l) => /^[=-]{3,}$/.test(l.trim()));
  const REQUIREMENT_RE = /\b(?:must|shall|should|will|need to|required to|implement|support|provide|enable)\b/i;
  const hasRequirements = lines.some((l) => REQUIREMENT_RE.test(l));

  if (!hasHeaders && !hasBullets && !hasUnderlines && !hasRequirements) {
    warnings.push(
      "No detectable structure or requirement keywords found. " +
      "Consider adding headings, bullet points, or requirement language (must, should, shall) for better extraction.",
    );
  }

  return { valid: true, warnings };
}

/** Plain text content validation result. */
export interface TextValidationResult {
  /** Whether the content is processable (always true). */
  valid: boolean;
  /** Non-fatal warnings about potential quality issues. */
  warnings: string[];
}

/** Content validation result for JSON files. */
export interface JsonValidationResult {
  /** Whether the content is valid JSON. */
  valid: boolean;
  /** Non-fatal warnings or fatal parse errors. */
  warnings: string[];
}

/** Content validation result for YAML files. */
export interface YamlValidationResult {
  /** Whether the content appears to be valid YAML. */
  valid: boolean;
  /** Non-fatal warnings about YAML syntax issues. */
  warnings: string[];
}

/**
 * Validate JSON content for syntax issues.
 *
 * Unlike markdown/text validators, JSON validation can report invalid
 * content (valid=false) when the JSON cannot be parsed at all.
 */
export function validateJsonContent(content: string): JsonValidationResult {
  const warnings: string[] = [];
  const trimmed = content.trim();

  // Empty or trivial content
  if (trimmed.length === 0) {
    return { valid: false, warnings: ["Empty JSON content."] };
  }

  // Try to parse
  try {
    const parsed = JSON.parse(trimmed);

    // Warn about non-object/array top-level values (primitives)
    if (typeof parsed !== "object" || parsed === null) {
      warnings.push(
        "JSON content is a primitive value (string, number, or boolean). " +
        "Expected an object or array containing requirements.",
      );
    }

    // Warn about empty objects/arrays
    if (Array.isArray(parsed) && parsed.length === 0) {
      warnings.push("JSON array is empty. No requirements to extract.");
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0
    ) {
      warnings.push("JSON object is empty. No requirements to extract.");
    }
  } catch (err: unknown) {
    const message = err instanceof SyntaxError ? err.message : "Invalid JSON";
    // Extract line/position info if available
    const posMatch = message.match(/position\s+(\d+)/i);
    const posInfo = posMatch
      ? ` near character ${posMatch[1]}`
      : "";
    warnings.push(`JSON parse error${posInfo}: ${message}`);
    return { valid: false, warnings };
  }

  return { valid: true, warnings };
}

/**
 * Validate YAML content for common syntax issues.
 *
 * Performs heuristic checks without a full YAML parser. Detects common
 * problems like inconsistent indentation, tabs (invalid in YAML), and
 * malformed key-value pairs.
 */
export function validateYamlContent(content: string): YamlValidationResult {
  const warnings: string[] = [];
  const lines = content.split("\n");

  // Skip front matter delimiter if present
  const startLine = lines[0]?.trim() === "---" ? 1 : 0;
  const contentLines = lines.slice(startLine);

  // Check for tabs — tabs are not allowed in YAML indentation
  const tabLines: number[] = [];
  for (let i = 0; i < contentLines.length; i++) {
    if (/^\t/.test(contentLines[i])) {
      tabLines.push(startLine + i + 1);
    }
  }
  if (tabLines.length > 0) {
    const lineRefs = tabLines.length <= 3
      ? `line${tabLines.length > 1 ? "s" : ""} ${tabLines.join(", ")}`
      : `${tabLines.length} lines`;
    warnings.push(
      `Tab indentation detected at ${lineRefs}. YAML requires spaces for indentation.`,
    );
  }

  // Check for inconsistent indentation levels
  const indentLevels = new Set<number>();
  for (const line of contentLines) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^( +)/);
    if (match) indentLevels.add(match[1].length);
  }
  if (indentLevels.size > 1) {
    const sorted = [...indentLevels].sort((a, b) => a - b);
    const diffs = new Set(sorted.slice(1).map((v, i) => v - sorted[i]));
    if (diffs.size > 1) {
      warnings.push(
        "Inconsistent indentation detected. YAML works best with a consistent indent size (typically 2 spaces).",
      );
    }
  }

  // Check for common YAML mistakes: duplicate keys at the same level
  const topKeys = new Map<string, number>();
  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i];
    const keyMatch = line.match(/^([a-zA-Z_][\w.-]*)\s*:/);
    if (keyMatch) {
      const key = keyMatch[1];
      if (topKeys.has(key)) {
        warnings.push(
          `Duplicate top-level key "${key}" at lines ${topKeys.get(key)! + startLine + 1} and ${i + startLine + 1}. ` +
          "Later values will override earlier ones.",
        );
        break; // One duplicate warning is enough
      }
      topKeys.set(key, i);
    }
  }

  return { valid: true, warnings };
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Read the first BINARY_CHECK_BYTES bytes of a file.
 * Used for binary detection and magic byte checks.
 */
async function readFileHeader(filePath: string): Promise<Buffer> {
  let fh;
  try {
    fh = await open(filePath, "r");
    const buffer = Buffer.alloc(BINARY_CHECK_BYTES);
    const { bytesRead } = await fh.read(buffer, 0, BINARY_CHECK_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fh?.close();
  }
}

/**
 * Check if a buffer contains null bytes (binary content indicator).
 */
function containsBinaryBytes(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Detect known binary file types by examining magic bytes in the header.
 * Returns the detected format name (e.g., "PNG") or null if no match.
 */
export function detectMagicBytes(buffer: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (buffer.length < sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return sig.name;
  }
  return null;
}
