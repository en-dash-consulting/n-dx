/**
 * Title-to-filename normalization.
 *
 * Converts item titles to deterministic, filesystem-safe markdown filenames.
 * Separates concerns from directory slugification: filenames use underscores
 * for word boundaries (not hyphens) and are round-trip safe.
 *
 * Normalization rules:
 *   1. Remove `.md` extension if already present (round-trip safety)
 *   2. Lowercase the title
 *   3. Remove filesystem-reserved characters: \ / : * ? " < > |
 *   4. Replace whitespace runs with single underscore
 *   5. Strip leading/trailing underscores
 *   6. If result is empty, use "unnamed"
 *   7. Append `.md` extension
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
export function titleToFilename(title: string): string {
  // Step 1: Remove .md extension if present (round-trip safety)
  const withoutExtension = title.endsWith(".md") ? title.slice(0, -3) : title;

  // Step 2-6: Normalize to filesystem-safe form
  const normalized = withoutExtension
    // Normalize Unicode using NFKD (decompose accented characters)
    .normalize("NFKD")
    // Remove combining diacritical marks (U+0300–U+036F)
    .replace(/[̀-ͯ]/g, "")
    // Lowercase
    .toLowerCase()
    // Remove filesystem-reserved and punctuation characters:
    // \ / : * ? " < > | ' ( ) & ! @ # $ % ^ = + [ ] { } ; , . ~ - `
    .replace(/[\\/:*?"<>'()&!@#$%^=+\[\]{};,.~\-`|]/g, "")
    // Replace whitespace runs with single underscore
    .replace(/\s+/g, "_")
    // Strip leading/trailing underscores
    .replace(/^_+|_+$/g, "");

  // Step 7: Append .md extension (use "unnamed" if result is empty)
  return (normalized || "unnamed") + ".md";
}
