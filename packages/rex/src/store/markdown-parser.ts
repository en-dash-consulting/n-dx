/**
 * Markdown parser — converts a rex/v1 markdown string to a PRDDocument.
 *
 * See packages/rex/docs/prd-markdown-schema.md for the authoritative spec.
 *
 * Includes a minimal YAML parser (no external dependency) that handles the
 * exact YAML subset produced by markdown-serializer.ts:
 *   - Block mappings (key: scalar | key:\n  block-value)
 *   - Block sequences (- scalar | - key: value\n  continuation)
 *   - Scalars: double-quoted strings, plain strings, integers, floats
 *   - Inline empty collections: `[]`, `{}`
 *
 * Design decisions:
 * - Heading depth is authoritative for item level; `level` in rex-meta is
 *   cross-checked but not used as the source of truth.
 * - _passthrough map is unpacked into the top-level item object.
 * - Parser returns ParseResult (never throws).
 * - Unknown front-matter keys are preserved on the document.
 *
 * @module rex/store/markdown-parser
 */

import type { PRDDocument, PRDItem, ItemLevel, ItemStatus } from "../schema/index.js";

// ── Error type ────────────────────────────────────────────────────────────────

/** Typed error returned (not thrown) by the parser on malformed input. */
export class MarkdownParseError extends Error {
  override name = "MarkdownParseError";
  constructor(message: string) {
    super(message);
  }
}

/** Result type for parseDocument. */
export type ParseResult =
  | { ok: true; data: PRDDocument }
  | { ok: false; error: MarkdownParseError };

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPTH_TO_LEVEL: Readonly<Record<number, ItemLevel>> = {
  2: "epic",
  3: "feature",
  4: "task",
  5: "subtask",
};

const ITEM_HEADING_RE = /^(#{2,5})\s+(.+)$/;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse a rex/v1 markdown string into a PRDDocument.
 * Returns `{ ok: false, error }` for malformed input — never throws.
 */
export function parseDocument(markdown: string): ParseResult {
  try {
    return parseDocumentInternal(markdown);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: new MarkdownParseError(`Unexpected parse error: ${msg}`) };
  }
}

// ── Document parsing ───────────────────────────────────────────────────────────

function parseDocumentInternal(markdown: string): ParseResult {
  const lines = markdown.split("\n");
  let i = 0;

  // 1. Front-matter
  const fmResult = parseFrontMatter(lines, i);
  if (!fmResult.ok) return fmResult;
  const { frontMatter, nextLine } = fmResult;
  i = nextLine;

  // 2. H1 title
  let title = "";
  while (i < lines.length) {
    const h1Match = /^#\s+(.+)$/.exec(lines[i]);
    if (h1Match) {
      title = h1Match[1].trim();
      i++;
      break;
    }
    if (ITEM_HEADING_RE.test(lines[i])) break; // hit H2+ without finding H1
    i++;
  }

  if (!title) {
    return { ok: false, error: new MarkdownParseError("No H1 title found after front-matter") };
  }

  // 3. Item sections
  const itemsResult = parseItemSections(lines, i);
  if (!itemsResult.ok) return itemsResult;

  return {
    ok: true,
    data: {
      schema: (frontMatter["schema"] as string) ?? "",
      ...frontMatter,
      title,
      items: itemsResult.items,
    },
  };
}

// ── Front-matter ───────────────────────────────────────────────────────────────

type FrontMatterResult =
  | { ok: true; frontMatter: Record<string, unknown>; nextLine: number }
  | { ok: false; error: MarkdownParseError };

function parseFrontMatter(lines: string[], start: number): FrontMatterResult {
  let i = start;
  while (i < lines.length && lines[i].trim() === "") i++;

  if (lines[i] !== "---") {
    return {
      ok: false,
      error: new MarkdownParseError(
        `Expected front-matter '---' at line ${i + 1}, got: ${JSON.stringify(lines[i] ?? "(end of file)")}`,
      ),
    };
  }
  i++;

  const fmLines: string[] = [];
  while (i < lines.length && lines[i] !== "---") {
    fmLines.push(lines[i]);
    i++;
  }

  if (i >= lines.length) {
    return { ok: false, error: new MarkdownParseError("Unclosed front-matter block") };
  }
  i++; // skip closing ---

  let parsed: unknown;
  try {
    [parsed] = parseYamlBlock(fmLines, 0, 0);
  } catch (err) {
    return {
      ok: false,
      error: new MarkdownParseError(`Front-matter YAML parse error: ${err}`),
    };
  }

  const fm = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
    ? (parsed as Record<string, unknown>)
    : {};

  return { ok: true, frontMatter: fm, nextLine: i };
}

// ── Item sections ──────────────────────────────────────────────────────────────

type ItemSectionsResult =
  | { ok: true; items: PRDItem[] }
  | { ok: false; error: MarkdownParseError };

function parseItemSections(lines: string[], startLine: number): ItemSectionsResult {
  const rootItems: PRDItem[] = [];
  const stack: Array<{ depth: number; item: PRDItem }> = [];

  let i = startLine;

  while (i < lines.length) {
    const headingMatch = ITEM_HEADING_RE.exec(lines[i]);
    if (!headingMatch) { i++; continue; }

    const depth = headingMatch[1].length;
    const title = headingMatch[2].trim();
    i++;

    // Skip blank lines
    while (i < lines.length && lines[i].trim() === "") i++;

    // Expect rex-meta fenced block
    if (i >= lines.length || !/^```rex-meta\s*$/.test(lines[i])) {
      return {
        ok: false,
        error: new MarkdownParseError(
          `Expected \`\`\`rex-meta block after "${title}" (line ${i + 1})`,
        ),
      };
    }
    i++; // skip opening fence

    const metaLines: string[] = [];
    while (i < lines.length && !/^```\s*$/.test(lines[i])) {
      metaLines.push(lines[i]);
      i++;
    }
    if (i >= lines.length) {
      return { ok: false, error: new MarkdownParseError(`Unclosed rex-meta block for "${title}"`) };
    }
    i++; // skip closing fence

    let rawMeta: Record<string, unknown>;
    try {
      const [parsed] = parseYamlBlock(metaLines, 0, 0);
      rawMeta = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
        ? (parsed as Record<string, unknown>)
        : {};
    } catch (err) {
      return {
        ok: false,
        error: new MarkdownParseError(`YAML parse error in rex-meta for "${title}": ${err}`),
      };
    }

    // Collect description: everything before the next H2–H5
    const descLines: string[] = [];
    while (i < lines.length && !ITEM_HEADING_RE.test(lines[i])) {
      descLines.push(lines[i]);
      i++;
    }
    const description = extractDescription(descLines);

    const level = DEPTH_TO_LEVEL[depth];
    if (!level) {
      return {
        ok: false,
        error: new MarkdownParseError(`Heading depth ${depth} does not map to a valid item level`),
      };
    }

    const { item, forceRoot } = buildItem(title, level, description, rawMeta);

    // Tree placement
    if (forceRoot) {
      stack.length = 0;
    }

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      rootItems.push(item);
    } else {
      const parent = stack[stack.length - 1].item;
      parent.children = parent.children ?? [];
      parent.children.push(item);
    }
    stack.push({ depth, item });
  }

  return { ok: true, items: rootItems };
}

// ── PRDItem construction ───────────────────────────────────────────────────────

function buildItem(
  title: string,
  level: ItemLevel,
  description: string | undefined,
  meta: Record<string, unknown>,
): { item: PRDItem; forceRoot: boolean } {
  const { _passthrough, root, ...finalMeta } = meta;
  const forceRoot = root === true;

  // Unpack _passthrough into top-level item
  const passthroughFields: Record<string, unknown> =
    _passthrough !== null && typeof _passthrough === "object" && !Array.isArray(_passthrough)
      ? (_passthrough as Record<string, unknown>)
      : {};

  // Strip YAML null values (treat as absent)
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(finalMeta)) {
    if (v !== null) cleaned[k] = v;
  }
  for (const [k, v] of Object.entries(passthroughFields)) {
    if (v !== null) cleaned[k] = v;
  }

  const item: PRDItem = {
    ...cleaned,
    id: cleaned["id"] as string,
    title,
    status: (cleaned["status"] as ItemStatus) ?? "pending",
    level,
  };

  if (description !== undefined) {
    item.description = description;
  }

  return { item, forceRoot };
}

function extractDescription(lines: string[]): string | undefined {
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  let end = lines.length - 1;
  while (end >= start && lines[end].trim() === "") end--;
  if (start > end) return undefined;
  return lines.slice(start, end + 1).join("\n");
}

// ── Minimal YAML parser ────────────────────────────────────────────────────────
//
// Handles the specific YAML subset produced by markdown-serializer.ts:
//   - Block mappings and block sequences
//   - Scalars: double-quoted strings, plain identifiers, numbers, booleans, null
//   - Inline empty: `[]`, `{}`
//
// Does NOT handle: anchors, aliases, tags, multi-line strings,
// single-quoted strings longer than one character, flow mappings/sequences
// (except the empty `[]`/`{}`).

function countIndent(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

/**
 * Parse a block (mapping or sequence) from the given lines array.
 * `start` is the index of the first line to examine.
 * `minIndent` is the minimum indent required; lines with less are excluded.
 *
 * Returns [parsed value, next unprocessed line index].
 */
function parseYamlBlock(
  lines: string[],
  start: number,
  minIndent: number,
): [unknown, number] {
  let i = start;

  // Skip blank lines
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return [null, i];

  const firstIndent = countIndent(lines[i]);
  if (firstIndent < minIndent) return [null, i];

  const trimmed = lines[i].trimStart();

  if (trimmed.startsWith("- ") || trimmed === "-") {
    return parseYamlSequence(lines, i, firstIndent);
  }
  return parseYamlMapping(lines, i, firstIndent);
}

function parseYamlMapping(
  lines: string[],
  start: number,
  baseIndent: number,
): [Record<string, unknown>, number] {
  const result: Record<string, unknown> = {};
  let i = start;

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;

    const indent = countIndent(lines[i]);
    if (indent < baseIndent || indent > baseIndent) break;

    const trimmed = lines[i].trimStart();
    // Sequence item in mapping context → stop
    if (trimmed.startsWith("- ") || trimmed === "-") break;

    const { key, valueStr, isBlock } = splitMappingLine(trimmed);
    if (key === null) break;

    if (isBlock) {
      i++;
      const [value, nextI] = parseYamlBlock(lines, i, baseIndent + 1);
      result[key] = value;
      i = nextI;
    } else {
      result[key] = parseYamlScalar(valueStr);
      i++;
    }
  }

  return [result, i];
}

function parseYamlSequence(
  lines: string[],
  start: number,
  seqIndent: number,
): [unknown[], number] {
  const items: unknown[] = [];
  let i = start;

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;

    const indent = countIndent(lines[i]);
    if (indent < seqIndent || indent > seqIndent) break;

    const trimmed = lines[i].trimStart();
    if (!trimmed.startsWith("- ") && trimmed !== "-") break;

    const rest = trimmed.startsWith("- ") ? trimmed.slice(2) : "";

    if (!rest.trim()) {
      // Block item on next lines
      i++;
      const [value, nextI] = parseYamlBlock(lines, i, seqIndent + 1);
      items.push(value);
      i = nextI;
      continue;
    }

    // Scalar item?
    const { key, valueStr, isBlock } = splitMappingLine(rest);

    if (key === null) {
      // Plain scalar item
      items.push(parseYamlScalar(rest));
      i++;
      continue;
    }

    // Object item: first field on "- " line, continuation at seqIndent + 2
    const obj: Record<string, unknown> = {};

    if (isBlock) {
      i++;
      const [value, nextI] = parseYamlBlock(lines, i, seqIndent + 3);
      obj[key] = value;
      i = nextI;
    } else {
      obj[key] = parseYamlScalar(valueStr);
      i++;
    }

    // Continuation fields at seqIndent + 2
    const contIndent = seqIndent + 2;
    while (i < lines.length) {
      while (i < lines.length && lines[i].trim() === "") i++;
      if (i >= lines.length) break;

      const cIndent = countIndent(lines[i]);
      if (cIndent < contIndent || cIndent > contIndent) break;

      const cTrimmed = lines[i].trimStart();
      if (cTrimmed.startsWith("- ") || cTrimmed === "-") break;

      const { key: cKey, valueStr: cVal, isBlock: cIsBlock } = splitMappingLine(cTrimmed);
      if (cKey === null) break;

      if (cIsBlock) {
        i++;
        const [value, nextI] = parseYamlBlock(lines, i, contIndent + 1);
        obj[cKey] = value;
        i = nextI;
      } else {
        obj[cKey] = parseYamlScalar(cVal);
        i++;
      }
    }

    items.push(obj);
  }

  return [items, i];
}

// ── Scalar parsing ─────────────────────────────────────────────────────────────

/**
 * Split a YAML mapping line (trimmed, with "- " prefix removed if seq item)
 * into key and value parts.
 */
function splitMappingLine(
  trimmed: string,
): { key: string; valueStr: string; isBlock: boolean } | { key: null; valueStr: string; isBlock: false } {
  // Find first ": " not inside quotes
  const colonSpaceIdx = findColonSeparator(trimmed);
  const endsWithColon = trimmed.endsWith(":") && !trimmed.endsWith("\\:");

  if (colonSpaceIdx === -1 && !endsWithColon) {
    return { key: null, valueStr: trimmed, isBlock: false };
  }

  if (colonSpaceIdx !== -1) {
    const key = trimmed.slice(0, colonSpaceIdx);
    const valueStr = trimmed.slice(colonSpaceIdx + 2);
    return { key, valueStr, isBlock: false };
  }

  // endsWithColon: block collection follows
  const key = trimmed.slice(0, -1);
  return { key, valueStr: "", isBlock: true };
}

/**
 * Find the index of ": " in a mapping line.
 * Skips inside double-quoted strings.
 * Returns -1 if not found.
 */
function findColonSeparator(s: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== "\\")) {
      inQuote = !inQuote;
    }
    if (!inQuote && s[i] === ":" && s[i + 1] === " ") {
      return i;
    }
  }
  return -1;
}

/** Parse a YAML scalar value string to a JavaScript value. */
function parseYamlScalar(s: string): unknown {
  s = s.trim();

  if (s === "" || s === "null" || s === "~") return null;
  if (s === "[]") return [];
  if (s === "{}") return {};

  // Double-quoted string
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return unescapeDoubleQuoted(s.slice(1, -1));
  }

  // Single-quoted string (basic: no escape sequences except '')
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }

  // Boolean
  if (s === "true" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "no" || s === "off") return false;

  // Integer
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);

  // Float
  if (/^-?\d*\.\d+([eE][-+]?\d+)?$/.test(s)) return parseFloat(s);

  // Plain string (enum values, identifiers, etc.)
  return s;
}

function unescapeDoubleQuoted(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\x00BACKSLASH\x00")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\x00BACKSLASH\x00/g, "\\");
}
