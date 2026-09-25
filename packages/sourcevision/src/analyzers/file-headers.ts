/**
 * Leading doc-comment extraction, shared by the enrichment prompts (which show
 * headers to the text model) and the finding judgments (which show them to
 * Jev as the evidence a finding must be supported by).
 *
 * @module sourcevision/analyzers/file-headers
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lines a leading-comment prefix is allowed to start with. Covers the
 * documentation conventions of TS/JS/Swift/Rust/Python/Go/HTML/MD comment-only
 * lines. A blank line is treated as part of the header so we don't truncate
 * paragraph breaks inside a doc block.
 */
export const COMMENT_PREFIXES = ["///", "//!", "//", "/**", "/*", "*", "*/", "#", "#!", "--", "<!--"];

/**
 * Extract the leading comment block of a file — i.e. the docstring the file's
 * author wrote at the top to explain what it does. We stop at the first
 * non-comment non-blank line and cap the output so we never blow the prompt.
 *
 * Returns `null` when the file has no leading comment block, so callers can
 * skip emitting an empty header entry.
 */
export function extractFileHeader(absPath: string, maxLines = 25, maxChars = 400): string | null {
  if (!existsSync(absPath)) return null;
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
  const lines = content.split("\n", maxLines + 5);
  const kept: string[] = [];
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    // Skip a shebang on line 1.
    if (i === 0 && trimmed.startsWith("#!")) {
      kept.push(raw);
      continue;
    }
    if (trimmed === "") {
      // A blank line is acceptable as long as we've started a header — stop
      // once we see a non-comment after that.
      if (kept.length === 0) continue;
      kept.push(raw);
      continue;
    }
    if (!COMMENT_PREFIXES.some((p) => trimmed.startsWith(p))) {
      break;
    }
    kept.push(raw);
  }
  // Trim trailing blanks.
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  if (kept.length < 2) return null; // single-line headers are usually license/copyright, not useful context.
  let joined = kept.join("\n");
  if (joined.length > maxChars) joined = joined.slice(0, maxChars) + "\n  // …";
  return joined;
}

/**
 * Headers for a list of project-relative files, bounded by a byte budget so a
 * large zone cannot inflate a request. Files without a usable header are
 * omitted. Returns an empty object when `projectDir` is unknown.
 */
export function collectFileHeaders(
  files: string[],
  projectDir: string | undefined,
  budgetChars = 2500,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!projectDir) return out;
  let used = 0;
  for (const rel of files) {
    if (used > budgetChars) break;
    const header = extractFileHeader(join(projectDir, rel));
    if (!header) continue;
    out[rel] = header;
    used += header.length;
  }
  return out;
}
