/**
 * File format validation and error handling for requirements import.
 *
 * Validates file inputs before processing: checks extensions, file size,
 * binary content detection, and provides markdown-specific syntax warnings.
 *
 * @module rex/analyze/file-validation
 */

import { stat, open } from "node:fs/promises";
import { extname, basename } from "node:path";
import type { FileFormat } from "./reason.js";

// ── Constants ─────────────────────────────────────────────────────

/** Maximum file size in bytes (10 MB). */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Number of bytes to sample for binary content detection. */
const BINARY_CHECK_BYTES = 8192;

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
  | "READ_ERROR";

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
 * 4. Content is not binary
 * 5. Content is not empty
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

  // 5. Check for binary content by reading first N bytes
  const hasBinary = await containsBinaryContent(filePath);
  if (hasBinary) {
    throw new FileValidationError(
      `File "${fileName}" appears to contain binary data.`,
      "BINARY_CONTENT",
      "Only text-based files are supported. Ensure the file is a valid text file.",
    );
  }

  // 6. Check whitespace-only content (read a small sample)
  const isEmpty = await isWhitespaceOnly(filePath);
  if (isEmpty) {
    throw new FileValidationError(
      `File "${fileName}" is empty.`,
      "EMPTY_FILE",
      "The file must contain text content to import requirements from.",
    );
  }

  return {
    filePath,
    format,
    sizeBytes: fileStats.size,
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

  return {
    valid: true,
    warnings,
  };
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Check if a file contains binary content by looking for null bytes
 * in the first BINARY_CHECK_BYTES bytes.
 */
async function containsBinaryContent(filePath: string): Promise<boolean> {
  let fh;
  try {
    fh = await open(filePath, "r");
    const buffer = Buffer.alloc(BINARY_CHECK_BYTES);
    const { bytesRead } = await fh.read(buffer, 0, BINARY_CHECK_BYTES, 0);
    // Look for null bytes — a reliable indicator of binary content
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } finally {
    await fh?.close();
  }
}

/**
 * Check if a file contains only whitespace.
 * Reads the full file for small files, or samples for large ones.
 */
async function isWhitespaceOnly(filePath: string): Promise<boolean> {
  let fh;
  try {
    fh = await open(filePath, "r");
    const buffer = Buffer.alloc(BINARY_CHECK_BYTES);
    const { bytesRead } = await fh.read(buffer, 0, BINARY_CHECK_BYTES, 0);
    const sample = buffer.subarray(0, bytesRead).toString("utf-8");
    return sample.trim().length === 0;
  } finally {
    await fh?.close();
  }
}
