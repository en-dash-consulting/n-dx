/**
 * Markdown parser — converts a rex/v1 markdown string to a PRDDocument.
 *
 * The PRD is encoded entirely in YAML front-matter at the top of the file.
 * Everything below the front-matter's closing `---` is auto-generated body
 * content for human reading and is ignored by the parser.
 *
 * See packages/rex/docs/prd-markdown-schema.md for the authoritative spec.
 *
 * Includes a minimal YAML parser (no external dependency) covering the
 * subset produced by markdown-serializer.ts:
 *   - Block mappings and block sequences
 *   - Double-quoted and plain scalars; integers; floats; booleans; null
 *   - `|`, `|-`, `|+` literal block scalars (used for descriptions)
 *   - `>`, `>-`, `>+` folded block scalars
 *   - Inline empty `[]` / `{}`
 *
 * Parser returns ParseResult — never throws.
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

// ── Public API ────────────────────────────────────────────────────────────────

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

  const fmResult = parseFrontMatter(lines, 0);
  if (!fmResult.ok) return fmResult;
  const fm = fmResult.frontMatter;

  const schema = fm["schema"];
  if (typeof schema !== "string" || schema === "") {
    return {
      ok: false,
      error: new MarkdownParseError("Front-matter missing required field: schema"),
    };
  }

  const title = fm["title"];
  if (typeof title !== "string") {
    return {
      ok: false,
      error: new MarkdownParseError("Front-matter missing required field: title"),
    };
  }

  const itemsRaw = fm["items"];
  if (itemsRaw !== undefined && !Array.isArray(itemsRaw)) {
    return {
      ok: false,
      error: new MarkdownParseError("Front-matter field 'items' must be a sequence"),
    };
  }

  const items: PRDItem[] = [];
  if (Array.isArray(itemsRaw)) {
    for (let i = 0; i < itemsRaw.length; i++) {
      const result = normalizeItem(itemsRaw[i], `items[${i}]`);
      if (!result.ok) return { ok: false, error: result.error };
      items.push(result.item);
    }
  }

  // Preserve unknown document-level keys (PRDDocument has [key: string]: unknown)
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k === "schema" || k === "title" || k === "items") continue;
    if (v === null || v === undefined) continue;
    extras[k] = v;
  }

  return {
    ok: true,
    data: {
      schema,
      title,
      items,
      ...extras,
    },
  };
}

/**
 * Coerce a parsed YAML mapping into a PRDItem, recursively normalizing children.
 * Drops null values; preserves unknown keys.
 */
function normalizeItem(
  raw: unknown,
  path: string,
): { ok: true; item: PRDItem } | { ok: false; error: MarkdownParseError } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: new MarkdownParseError(`${path} must be a mapping`),
    };
  }

  const obj = raw as Record<string, unknown>;

  const id = obj["id"];
  if (typeof id !== "string" || id === "") {
    return {
      ok: false,
      error: new MarkdownParseError(`${path}.id required (string)`),
    };
  }

  const title = obj["title"];
  if (typeof title !== "string") {
    return {
      ok: false,
      error: new MarkdownParseError(`${path}.title required (string)`),
    };
  }

  const level = obj["level"];
  if (typeof level !== "string") {
    return {
      ok: false,
      error: new MarkdownParseError(`${path}.level required (string)`),
    };
  }

  const status = (typeof obj["status"] === "string" ? obj["status"] : "pending") as ItemStatus;

  // Recursively normalize children
  let children: PRDItem[] | undefined;
  const rawChildren = obj["children"];
  if (rawChildren !== undefined && rawChildren !== null) {
    if (!Array.isArray(rawChildren)) {
      return {
        ok: false,
        error: new MarkdownParseError(`${path}.children must be a sequence`),
      };
    }
    children = [];
    for (let i = 0; i < rawChildren.length; i++) {
      const r = normalizeItem(rawChildren[i], `${path}.children[${i}]`);
      if (!r.ok) return { ok: false, error: r.error };
      children.push(r.item);
    }
  }

  // Build item: copy all non-null fields, then ensure required core fields are set.
  const item: PRDItem = {
    id,
    title,
    status,
    level: level as ItemLevel,
  };

  for (const [k, v] of Object.entries(obj)) {
    if (k === "id" || k === "title" || k === "status" || k === "level") continue;
    if (k === "children") continue;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (item as Record<string, unknown>)[k] = v;
  }

  if (children && children.length > 0) {
    item.children = children;
  }

  return { ok: true, item };
}

// ── Front-matter parsing ───────────────────────────────────────────────────────

type FrontMatterResult =
  | { ok: true; frontMatter: Record<string, unknown> }
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

  return { ok: true, frontMatter: fm };
}

// ── YAML parser ────────────────────────────────────────────────────────────────
//
// Hand-rolled to avoid an external dependency. Covers the subset emitted by
// markdown-serializer.ts. See file header for the supported feature list.

function countIndent(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

function parseYamlBlock(
  lines: string[],
  start: number,
  minIndent: number,
): [unknown, number] {
  let i = start;

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
    if (indent !== baseIndent) break;

    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("- ") || trimmed === "-") break;

    const split = splitMappingLine(trimmed);
    if (split.key === null) break;

    if (split.kind === "block-scalar") {
      i++;
      const [str, next] = parseBlockScalar(lines, i, baseIndent, split.indicator);
      result[split.key] = str;
      i = next;
    } else if (split.kind === "block") {
      i++;
      const [value, next] = parseYamlBlock(lines, i, baseIndent + 1);
      result[split.key] = value;
      i = next;
    } else {
      result[split.key] = parseYamlScalar(split.valueStr);
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
    if (indent !== seqIndent) break;

    const trimmed = lines[i].trimStart();
    if (!trimmed.startsWith("- ") && trimmed !== "-") break;

    const rest = trimmed.startsWith("- ") ? trimmed.slice(2) : "";

    if (!rest.trim()) {
      i++;
      const [value, next] = parseYamlBlock(lines, i, seqIndent + 1);
      items.push(value);
      i = next;
      continue;
    }

    const split = splitMappingLine(rest);

    if (split.key === null) {
      // Plain scalar item
      items.push(parseYamlScalar(rest));
      i++;
      continue;
    }

    // Object item: first field on "- " line, continuation at seqIndent + 2
    const obj: Record<string, unknown> = {};

    if (split.kind === "block-scalar") {
      i++;
      const [str, next] = parseBlockScalar(lines, i, seqIndent + 2, split.indicator);
      obj[split.key] = str;
      i = next;
    } else if (split.kind === "block") {
      i++;
      const [value, next] = parseYamlBlock(lines, i, seqIndent + 3);
      obj[split.key] = value;
      i = next;
    } else {
      obj[split.key] = parseYamlScalar(split.valueStr);
      i++;
    }

    const contIndent = seqIndent + 2;
    while (i < lines.length) {
      while (i < lines.length && lines[i].trim() === "") i++;
      if (i >= lines.length) break;

      const cIndent = countIndent(lines[i]);
      if (cIndent !== contIndent) break;

      const cTrimmed = lines[i].trimStart();
      if (cTrimmed.startsWith("- ") || cTrimmed === "-") break;

      const cSplit = splitMappingLine(cTrimmed);
      if (cSplit.key === null) break;

      if (cSplit.kind === "block-scalar") {
        i++;
        const [str, next] = parseBlockScalar(lines, i, contIndent, cSplit.indicator);
        obj[cSplit.key] = str;
        i = next;
      } else if (cSplit.kind === "block") {
        i++;
        const [value, next] = parseYamlBlock(lines, i, contIndent + 1);
        obj[cSplit.key] = value;
        i = next;
      } else {
        obj[cSplit.key] = parseYamlScalar(cSplit.valueStr);
        i++;
      }
    }

    items.push(obj);
  }

  return [items, i];
}

// ── Mapping line split ─────────────────────────────────────────────────────────

type MappingLineSplit =
  | { key: string; kind: "scalar"; valueStr: string }
  | { key: string; kind: "block"; valueStr: "" }
  | { key: string; kind: "block-scalar"; indicator: BlockScalarIndicator; valueStr: "" }
  | { key: null; kind: "plain"; valueStr: string };

interface BlockScalarIndicator {
  style: "literal" | "folded";
  chomping: "clip" | "strip" | "keep";
}

function splitMappingLine(trimmed: string): MappingLineSplit {
  const colonSpaceIdx = findColonSeparator(trimmed);
  const endsWithColon = trimmed.endsWith(":") && !trimmed.endsWith("\\:");

  if (colonSpaceIdx === -1 && !endsWithColon) {
    return { key: null, kind: "plain", valueStr: trimmed };
  }

  if (colonSpaceIdx !== -1) {
    const key = trimmed.slice(0, colonSpaceIdx);
    const valueStr = trimmed.slice(colonSpaceIdx + 2).trim();

    const blockScalar = parseBlockScalarHeader(valueStr);
    if (blockScalar) {
      return { key, kind: "block-scalar", indicator: blockScalar, valueStr: "" };
    }
    return { key, kind: "scalar", valueStr };
  }

  const key = trimmed.slice(0, -1);
  return { key, kind: "block", valueStr: "" };
}

function parseBlockScalarHeader(valueStr: string): BlockScalarIndicator | null {
  if (valueStr.length === 0) return null;
  const head = valueStr[0];
  if (head !== "|" && head !== ">") return null;
  const style: "literal" | "folded" = head === "|" ? "literal" : "folded";
  const rest = valueStr.slice(1).trim();
  if (rest === "") return { style, chomping: "clip" };
  if (rest === "-") return { style, chomping: "strip" };
  if (rest === "+") return { style, chomping: "keep" };
  return null;
}

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

// ── Block scalar parsing ───────────────────────────────────────────────────────

/**
 * Parse a block scalar starting at `start`. The block scalar indent is
 * determined by the first non-empty content line — it must be deeper than
 * `parentIndent`. Lines with less indent end the scalar.
 */
function parseBlockScalar(
  lines: string[],
  start: number,
  parentIndent: number,
  indicator: BlockScalarIndicator,
): [string, number] {
  let i = start;

  // Find first non-empty line to determine block indent.
  let blockIndent = -1;
  let scanI = i;
  while (scanI < lines.length) {
    if (lines[scanI].trim() === "") { scanI++; continue; }
    blockIndent = countIndent(lines[scanI]);
    break;
  }

  if (blockIndent <= parentIndent) {
    // Empty scalar — no content lines.
    return [applyChomping("", indicator.chomping), i];
  }

  const collected: string[] = [];
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      collected.push("");
      i++;
      continue;
    }
    const ind = countIndent(lines[i]);
    if (ind < blockIndent) break;
    collected.push(lines[i].slice(blockIndent));
    i++;
  }

  // Trim purely-empty trailing lines that belong to following content.
  while (collected.length > 0 && collected[collected.length - 1] === "") {
    collected.pop();
    // Keep one trailing empty for clip/keep — re-added after chomping.
  }

  let content: string;
  if (indicator.style === "literal") {
    content = collected.join("\n");
  } else {
    // Folded — join non-empty runs with single space, blank lines preserved as \n.
    content = foldFoldedScalar(collected);
  }

  return [applyChomping(content, indicator.chomping), i];
}

function foldFoldedScalar(lines: string[]): string {
  const out: string[] = [];
  let buffer: string[] = [];
  for (const line of lines) {
    if (line === "") {
      if (buffer.length > 0) {
        out.push(buffer.join(" "));
        buffer = [];
      }
      out.push("");
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length > 0) out.push(buffer.join(" "));
  // Collapse "" markers into newlines.
  return out.join("\n").replace(/\n\n/g, "\n");
}

function applyChomping(content: string, chomping: "clip" | "strip" | "keep"): string {
  if (chomping === "strip") return content.replace(/\n*$/, "");
  if (chomping === "keep") return content + (content.endsWith("\n") ? "" : "\n");
  // clip: single trailing newline (or none if content is empty)
  if (content === "") return "";
  return content.replace(/\n*$/, "") + "\n";
}

// ── Scalar parsing ─────────────────────────────────────────────────────────────

function parseYamlScalar(s: string): unknown {
  s = s.trim();

  if (s === "" || s === "null" || s === "~") return null;
  if (s === "[]") return [];
  if (s === "{}") return {};

  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return unescapeDoubleQuoted(s.slice(1, -1));
  }

  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }

  if (s === "true" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "no" || s === "off") return false;

  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+([eE][-+]?\d+)?$/.test(s)) return parseFloat(s);

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
