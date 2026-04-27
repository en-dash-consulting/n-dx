/**
 * Legacy markdown parser — reads the original heading+rex-meta PRD markdown
 * format (rex/v1 prior to the front-matter-canonical migration).
 *
 * Used only for one-time migration to the new front-matter-canonical format.
 * Tolerant of content headings inside descriptions: a heading not immediately
 * followed by a ```rex-meta block is folded into the previous item's
 * description rather than treated as a new item heading.
 *
 * Output is a PRDDocument that can be re-serialized by the new serializer.
 *
 * @module rex/store/legacy-markdown-parser
 */

import type { PRDDocument, PRDItem, ItemLevel, ItemStatus } from "../schema/index.js";

const DEPTH_TO_LEVEL: Readonly<Record<number, ItemLevel>> = {
  2: "epic",
  3: "feature",
  4: "task",
  5: "subtask",
};

const ITEM_HEADING_RE = /^(#{2,5})\s+(.+)$/;

export class LegacyParseError extends Error {
  override name = "LegacyParseError";
}

export type LegacyParseResult =
  | { ok: true; data: PRDDocument }
  | { ok: false; error: LegacyParseError };

export function parseLegacyDocument(markdown: string): LegacyParseResult {
  try {
    return parseInternal(markdown);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: new LegacyParseError(`Unexpected parse error: ${msg}`) };
  }
}

function parseInternal(markdown: string): LegacyParseResult {
  const lines = markdown.split("\n");
  let i = 0;

  const fmResult = parseFrontMatter(lines, i);
  if (!fmResult.ok) return fmResult;
  const { frontMatter, nextLine } = fmResult;
  i = nextLine;

  // H1 title
  let title = "";
  while (i < lines.length) {
    const h1 = /^#\s+(.+)$/.exec(lines[i]);
    if (h1) {
      title = h1[1].trim();
      i++;
      break;
    }
    if (ITEM_HEADING_RE.test(lines[i])) break;
    i++;
  }
  if (!title) {
    return { ok: false, error: new LegacyParseError("No H1 title found after front-matter") };
  }

  const items = parseItemSections(lines, i);

  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontMatter)) {
    if (k === "schema" || k === "title" || k === "items") continue;
    extras[k] = v;
  }

  return {
    ok: true,
    data: {
      schema: (frontMatter["schema"] as string) ?? "rex/v1",
      title,
      items,
      ...extras,
    },
  };
}

// ── Front-matter ──────────────────────────────────────────────────────────────

type FrontMatterResult =
  | { ok: true; frontMatter: Record<string, unknown>; nextLine: number }
  | { ok: false; error: LegacyParseError };

function parseFrontMatter(lines: string[], start: number): FrontMatterResult {
  let i = start;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i] !== "---") {
    return {
      ok: false,
      error: new LegacyParseError(`Expected front-matter '---' at line ${i + 1}`),
    };
  }
  i++;
  const fmLines: string[] = [];
  while (i < lines.length && lines[i] !== "---") {
    fmLines.push(lines[i]);
    i++;
  }
  if (i >= lines.length) {
    return { ok: false, error: new LegacyParseError("Unclosed front-matter block") };
  }
  i++;

  const [parsed] = parseYamlBlock(fmLines, 0, 0);
  const fm = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
    ? (parsed as Record<string, unknown>)
    : {};
  return { ok: true, frontMatter: fm, nextLine: i };
}

// ── Item sections (heading + rex-meta + prose) ───────────────────────────────

function parseItemSections(lines: string[], startLine: number): PRDItem[] {
  const rootItems: PRDItem[] = [];
  const stack: Array<{ depth: number; item: PRDItem }> = [];

  let i = startLine;
  let lastItem: PRDItem | null = null;

  while (i < lines.length) {
    const headingMatch = ITEM_HEADING_RE.exec(lines[i]);
    if (!headingMatch) {
      i++;
      continue;
    }

    // Look ahead — does a ```rex-meta fence follow (after blank lines)?
    let look = i + 1;
    while (look < lines.length && lines[look].trim() === "") look++;
    const hasMeta = look < lines.length && /^```rex-meta\s*$/.test(lines[look]);

    if (!hasMeta) {
      // Heading without rex-meta: this is content inside the previous item's
      // description. Absorb it (and following content lines) into description.
      if (lastItem) {
        const absorbStart = i;
        i++;
        while (i < lines.length) {
          const m = ITEM_HEADING_RE.exec(lines[i]);
          if (m) {
            // Look ahead for the next item heading (with rex-meta)
            let look2 = i + 1;
            while (look2 < lines.length && lines[look2].trim() === "") look2++;
            if (look2 < lines.length && /^```rex-meta\s*$/.test(lines[look2])) {
              // This is a real item heading — stop absorbing.
              break;
            }
          }
          i++;
        }
        const absorbed = lines.slice(absorbStart, i).join("\n");
        const existing = lastItem.description ?? "";
        lastItem.description = existing.length > 0 ? `${existing}\n\n${absorbed}` : absorbed;
      } else {
        // Heading before any item — treat as floating content, skip.
        i++;
      }
      continue;
    }

    const depth = headingMatch[1].length;
    const title = headingMatch[2].trim();
    i = look + 1; // skip the ```rex-meta fence

    // Read meta block
    const metaLines: string[] = [];
    while (i < lines.length && !/^```\s*$/.test(lines[i])) {
      metaLines.push(lines[i]);
      i++;
    }
    if (i >= lines.length) {
      // Unclosed meta — break to avoid infinite loop. Leave whatever we have.
      break;
    }
    i++; // skip closing ```

    const [parsedMeta] = parseYamlBlock(metaLines, 0, 0);
    const rawMeta: Record<string, unknown> =
      parsedMeta !== null && typeof parsedMeta === "object" && !Array.isArray(parsedMeta)
        ? (parsedMeta as Record<string, unknown>)
        : {};

    // Collect description until next item heading (with rex-meta)
    const descStart = i;
    while (i < lines.length) {
      const m = ITEM_HEADING_RE.exec(lines[i]);
      if (m) {
        let look2 = i + 1;
        while (look2 < lines.length && lines[look2].trim() === "") look2++;
        if (look2 < lines.length && /^```rex-meta\s*$/.test(lines[look2])) break;
      }
      i++;
    }
    const description = extractDescription(lines.slice(descStart, i));

    const level = DEPTH_TO_LEVEL[depth];
    if (!level) {
      // Unmappable depth (shouldn't happen for H2-H5). Skip.
      continue;
    }

    const { item, forceRoot } = buildItem(title, level, description, rawMeta);

    if (forceRoot) stack.length = 0;

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
    lastItem = item;
  }

  return rootItems;
}

function buildItem(
  title: string,
  level: ItemLevel,
  description: string | undefined,
  meta: Record<string, unknown>,
): { item: PRDItem; forceRoot: boolean } {
  const { _passthrough, root, ...finalMeta } = meta;
  const forceRoot = root === true;

  const passthrough: Record<string, unknown> =
    _passthrough !== null && typeof _passthrough === "object" && !Array.isArray(_passthrough)
      ? (_passthrough as Record<string, unknown>)
      : {};

  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(finalMeta)) {
    if (v !== null) cleaned[k] = v;
  }
  for (const [k, v] of Object.entries(passthrough)) {
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

// ── Minimal YAML parser (subset emitted by old serializer) ───────────────────
// (Identical to the parser used in markdown-parser.ts before the rewrite.)

function countIndent(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

function parseYamlBlock(lines: string[], start: number, minIndent: number): [unknown, number] {
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

    if (split.isBlock) {
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
      items.push(parseYamlScalar(rest));
      i++;
      continue;
    }

    const obj: Record<string, unknown> = {};
    if (split.isBlock) {
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
      if (cSplit.isBlock) {
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

interface MappingLineSplit {
  key: string | null;
  valueStr: string;
  isBlock: boolean;
}

function splitMappingLine(trimmed: string): MappingLineSplit {
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
  const key = trimmed.slice(0, -1);
  return { key, valueStr: "", isBlock: true };
}

function findColonSeparator(s: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== "\\")) inQuote = !inQuote;
    if (!inQuote && s[i] === ":" && s[i + 1] === " ") return i;
  }
  return -1;
}

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
