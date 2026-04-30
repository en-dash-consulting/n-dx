/**
 * Title-to-filename normalization.
 *
 * Converts item titles to deterministic, filesystem-safe markdown filenames.
 * Separates concerns from directory slugification: filenames use underscores
 * for word boundaries (not hyphens), are round-trip safe, and are capped
 * so checked-in folder trees remain compatible with Windows checkout limits.
 *
 * Normalization rules:
 *   1. Remove `.md` extension if already present (round-trip safety)
 *   2. Normalize Unicode with NFKD and strip combining marks
 *   3. Lowercase the title
 *   4. Remove non-ASCII characters that remain after accent normalization
 *   5. Remove filesystem-reserved and punctuation characters
 *   6. Replace whitespace runs with single underscore
 *   7. Strip leading/trailing underscores
 *   8. If result is empty, use "unnamed"
 *   9. Truncate the filename body at a word boundary
 *   10. Append `.md` extension
 *
 * Round-trip safety: titleToFilename(titleToFilename(x)) == titleToFilename(x)
 *
 * @module rex/store/title-to-filename
 */

/**
 * Convert a PRD item title to a filesystem-safe markdown filename.
 *
 * @param title - Item title string (may be empty)
 * @returns Normalized filename with `.md` extension (e.g., "my_item.md")
 *
 * @example
 * titleToFilename("Web Dashboard")           // "web_dashboard.md"
 * titleToFilename("My: Title? (test)")       // "my_title_test.md"
 * titleToFilename("web_dashboard.md")        // "web_dashboard.md" (round-trip safe)
 * titleToFilename("  spaces  ")              // "spaces.md"
 * titleToFilename("!!!???")                  // "unnamed.md" (empty after normalization)
 * titleToFilename("Héros & Légendes")       // "heros_legendes.md"
 */

const MARKDOWN_EXTENSION = ".md";
const MAX_FILENAME_LENGTH = 40;
const MAX_FILENAME_BODY_LENGTH = MAX_FILENAME_LENGTH - MARKDOWN_EXTENSION.length;

export function titleToFilename(title: string): string {
  // Step 1: Remove .md extension if present (round-trip safety)
  const withoutExtension = stripMarkdownExtension(title);

  // Step 2-7: Normalize to filesystem-safe form.
  const normalized = normalizeFilenameBody(withoutExtension);

  // Step 8-10: Fallback, truncate, and append .md extension.
  return truncateFilenameBody(normalized || "unnamed") + MARKDOWN_EXTENSION;
}

/**
 * Append a deterministic suffix while preserving the global filename length cap.
 */
export function appendFilenameSuffix(filename: string, suffix: string): string {
  const base = stripMarkdownExtension(filename);
  const normalizedSuffix = normalizeFilenameBody(suffix) || "item";
  const suffixBody = truncateFilenameBody(normalizedSuffix, MAX_FILENAME_BODY_LENGTH - 2);
  const suffixPart = `_${suffixBody}`;
  const baseLimit = Math.max(1, MAX_FILENAME_BODY_LENGTH - suffixPart.length);
  return `${truncateFilenameBody(base, baseLimit)}${suffixPart}${MARKDOWN_EXTENSION}`;
}

function stripMarkdownExtension(value: string): string {
  return value.toLowerCase().endsWith(MARKDOWN_EXTENSION)
    ? value.slice(0, -MARKDOWN_EXTENSION.length)
    : value;
}

function normalizeFilenameBody(value: string): string {
  return value
    // Normalize Unicode using NFKD (decompose accented characters).
    .normalize("NFKD")
    // Remove combining diacritical marks (U+0300-U+036F).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Keep filenames ASCII-only for predictable cross-platform checkout.
    .replace(/[^\x00-\x7F]/g, "")
    // Remove filesystem-reserved and punctuation characters.
    .replace(/[^a-z0-9_\s]+/g, "")
    // Replace whitespace runs with single underscore.
    .replace(/\s+/g, "_")
    // Strip leading/trailing underscores.
    .replace(/^_+|_+$/g, "");
}

function truncateFilenameBody(body: string, maxLength = MAX_FILENAME_BODY_LENGTH): string {
  if (body.length <= maxLength) return body;

  const candidate = body.slice(0, maxLength).replace(/_+$/g, "");
  const lastUnderscore = candidate.lastIndexOf("_");
  if (lastUnderscore > 0) return candidate.slice(0, lastUnderscore);
  return candidate || body.slice(0, maxLength);
}
