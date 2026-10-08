/**
 * A YAML subset, parsed without a dependency.
 *
 * Enough YAML to read a CI definition — nested maps, sequences, scalars, block
 * scalars and inline flow collections — and nothing more. It exists because
 * four CI dialects have to be read (GitHub Actions, GitLab CI, CircleCI,
 * Bitbucket Pipelines) and the alternative is four ad-hoc line scanners, which
 * is the shape this codebase has already been bitten by: one table per parser
 * drifts within a release.
 *
 * ## Why not a real YAML library
 *
 * Sourcevision has no YAML dependency, and `export/iso-declared.ts` already
 * reads CloudFormation by line scan for that reason. This keeps that property
 * while giving the four dialects one implementation to share.
 *
 * ## What it refuses rather than guesses
 *
 * Anchors (`&a`), aliases (`*a`), merge keys (`<<:`), explicit tags (`!!str`)
 * and multi-document streams all **throw**. They change what a document means,
 * and a parser that skipped them would return a half-read file that looks
 * complete — a CI job silently missing its steps reads as "this project does
 * not test", which is worse than saying the file could not be read. The caller
 * records the failure against the file's path.
 *
 * Tabs for indentation throw for the same reason: YAML forbids them, and
 * guessing a width would invent structure.
 *
 * @module sourcevision/analyzers/yaml-subset
 */

/** A parsed node: a map, a sequence, a scalar, or absent. */
export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

/** Thrown for any construct this subset will not guess at. */
export class YamlSubsetError extends Error {
  constructor(
    message: string,
    /** 1-indexed line the parser gave up on. */
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = "YamlSubsetError";
  }
}

interface Line {
  /** 1-indexed, for error messages. */
  number: number;
  indent: number;
  text: string;
  /** The line as written, for block scalars that keep their body verbatim. */
  raw: string;
  /**
   * Indented with a tab. Structure refuses it; a block scalar body keeps it,
   * because a tab inside a `run: |` script is content, not indentation.
   */
  tab: boolean;
}

/**
 * Ordered most specific first: `<<: *defaults` is both a merge key and an
 * alias, and "merge keys are not supported" is the more useful of the two
 * things to be told.
 */
const UNSUPPORTED: Array<[RegExp, string]> = [
  [/^<<\s*:/, "merge keys are not supported"],
  [/(^|\s)&[A-Za-z0-9_-]+(\s|$)/, "anchors are not supported"],
  [/(^|\s)\*[A-Za-z0-9_-]+\s*$/, "aliases are not supported"],
  [/(^|\s)!!?[A-Za-z]/, "explicit tags are not supported"],
];

/**
 * Strip a trailing comment.
 *
 * A `#` only starts a comment when it follows whitespace or opens the value,
 * so a URL fragment or a colour literal survives.
 */
function stripComment(text: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

function unquote(raw: string): string {
  const text = raw.trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** Scalars YAML gives a meaning beyond their text. */
function coerceScalar(raw: string): YamlValue {
  const text = raw.trim();
  if (text === "") return null;
  if (text !== unquote(text)) return unquote(text);
  if (text === "null" || text === "~") return null;
  if (text === "true" || text === "True") return true;
  if (text === "false" || text === "False") return false;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text);
  return unquote(text);
}

/** A single-line `[a, b]` or `{k: v}`, which CI files use constantly. */
function parseFlow(raw: string, lineNumber: number): YamlValue {
  const text = raw.trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    return splitFlow(inner, lineNumber).map((part) => coerceScalar(part));
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    const inner = text.slice(1, -1).trim();
    const map: Record<string, YamlValue> = {};
    if (inner === "") return map;
    for (const part of splitFlow(inner, lineNumber)) {
      const colon = findKeyColon(part);
      if (colon === -1) throw new YamlSubsetError("Malformed inline mapping", lineNumber);
      map[unquote(part.slice(0, colon))] = coerceScalar(part.slice(colon + 1));
    }
    return map;
  }
  return coerceScalar(text);
}

/** Split on commas that are not inside quotes or a nested flow collection. */
function splitFlow(inner: string, lineNumber: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      else if (c === "," && depth === 0) {
        parts.push(inner.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  if (inSingle || inDouble) throw new YamlSubsetError("Unterminated quote", lineNumber);
  parts.push(inner.slice(start).trim());
  return parts.filter((p) => p !== "");
}

/**
 * The colon that separates a key from its value, skipping colons inside
 * quotes and inside a flow collection — `run: echo "a: b"` has one key.
 */
function findKeyColon(text: string): number {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      else if (c === ":" && depth === 0) {
        const next = text[i + 1];
        if (next === undefined || next === " " || next === "\t") return i;
      }
    }
  }
  return -1;
}

function readLines(source: string): Line[] {
  const lines: Line[] = [];
  // A byte-order mark is not indentation. Editors on Windows write one, and
  // counting it as a leading character would indent the first line by one,
  // which parses the rest of the document as a stray block.
  const raw = (source.startsWith("﻿") ? source.slice(1) : source).split(/\r?\n|\r/);
  for (let i = 0; i < raw.length; i++) {
    const original = raw[i];
    const lineNumber = i + 1;
    if (/^\s*$/.test(original)) continue;
    if (/^\s*#/.test(original)) continue;
    if (/^---\s*$/.test(original) || /^\.\.\.\s*$/.test(original)) {
      // A document separator at the very top is a no-op; anywhere else it
      // opens a second document, which this subset does not represent.
      if (lines.length > 0) throw new YamlSubsetError("Multi-document streams are not supported", lineNumber);
      continue;
    }
    const tab = /^[ \t]*\t/.test(original);
    const indent = original.length - original.trimStart().length;
    const text = stripComment(original.trim());
    if (text === "") continue;
    for (const [pattern, message] of UNSUPPORTED) {
      if (pattern.test(text)) throw new YamlSubsetError(message, lineNumber);
    }
    lines.push({ number: lineNumber, indent, text, raw: original, tab });
  }
  return lines;
}

/**
 * A line about to be read as structure — a key or a sequence item.
 *
 * YAML forbids tabs in indentation, and guessing a width would invent
 * structure. The check lives here rather than in `readLines` so that a tab
 * inside a block scalar's body, which is content, is left alone.
 */
function requireSpaces(line: Line): void {
  if (line.tab) throw new YamlSubsetError("Tab indentation is not valid YAML", line.number);
}

/**
 * Block scalars (`|`, `>`) — the body is taken verbatim, folded or not.
 *
 * The body keeps each line as written, minus the indentation of its first
 * line, so a heredoc or a tab-indented script inside `run: |` survives.
 */
function readBlockScalar(lines: Line[], start: number, parentIndent: number, fold: boolean): [string, number] {
  const body: string[] = [];
  let i = start;
  const bodyIndent = i < lines.length ? lines[i].indent : 0;
  while (i < lines.length && lines[i].indent > parentIndent) {
    const line = lines[i];
    body.push(line.raw.slice(Math.min(bodyIndent, line.indent)).trimEnd());
    i++;
  }
  return [fold ? body.join(" ") : body.join("\n"), i];
}

function parseBlock(lines: Line[], start: number, indent: number): [YamlValue, number] {
  if (start >= lines.length) return [null, start];

  if (lines[start].text.startsWith("- ") || lines[start].text === "-") {
    return parseSequence(lines, start, indent);
  }
  return parseMapping(lines, start, indent);
}

function parseSequence(lines: Line[], start: number, indent: number): [YamlValue[], number] {
  const items: YamlValue[] = [];
  let i = start;

  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    if (!line.text.startsWith("- ") && line.text !== "-") break;
    requireSpaces(line);

    const rest = line.text === "-" ? "" : line.text.slice(2).trim();
    i++;

    if (rest === "") {
      // The item's content is the indented block beneath it.
      if (i < lines.length && lines[i].indent > indent) {
        const [value, next] = parseBlock(lines, i, lines[i].indent);
        items.push(value);
        i = next;
      } else {
        items.push(null);
      }
      continue;
    }

    const colon = findKeyColon(rest);
    if (colon === -1) {
      items.push(parseFlow(rest, line.number));
      continue;
    }

    // `- key: value` opens a mapping whose first key sits on the dash line.
    // Its sibling keys are indented to where that key started.
    const keyIndent = indent + 2;
    const map: Record<string, YamlValue> = {};
    const [firstValue, afterFirst] = readMappingValue(lines, i, rest.slice(colon + 1), keyIndent, line.number);
    map[unquote(rest.slice(0, colon))] = firstValue;
    i = afterFirst;

    while (i < lines.length && lines[i].indent >= keyIndent && !lines[i].text.startsWith("- ")) {
      const inner = lines[i];
      const innerColon = findKeyColon(inner.text);
      if (innerColon === -1) break;
      const key = unquote(inner.text.slice(0, innerColon));
      const [value, next] = readMappingValue(lines, i + 1, inner.text.slice(innerColon + 1), inner.indent, inner.number);
      map[key] = value;
      i = next;
    }

    items.push(map);
  }

  return [items, i];
}

/** Resolve the value belonging to a key, inline or in the block below it. */
function readMappingValue(
  lines: Line[],
  next: number,
  inlineRaw: string,
  keyIndent: number,
  lineNumber: number,
): [YamlValue, number] {
  const inline = inlineRaw.trim();

  if (inline === "|" || inline === "|-" || inline === "|+" || inline === ">" || inline === ">-" || inline === ">+") {
    return readBlockScalar(lines, next, keyIndent, inline.startsWith(">"));
  }

  if (inline !== "") return [parseFlow(inline, lineNumber), next];

  if (next < lines.length && lines[next].indent > keyIndent) {
    return parseBlock(lines, next, lines[next].indent);
  }
  // YAML lets a sequence sit at the same indent as the key that owns it —
  // `on:` followed by `- push` at column 0 is the house style in the GitLab
  // CI docs and in many workflows. Reading it as "no value" would drop every
  // line after it.
  if (next < lines.length && lines[next].indent === keyIndent && isSequenceItem(lines[next])) {
    return parseSequence(lines, next, keyIndent);
  }
  return [null, next];
}

function isSequenceItem(line: Line): boolean {
  return line.text.startsWith("- ") || line.text === "-";
}

function parseMapping(lines: Line[], start: number, indent: number): [Record<string, YamlValue>, number] {
  const map: Record<string, YamlValue> = {};
  let i = start;

  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    if (isSequenceItem(line)) break;
    requireSpaces(line);

    const colon = findKeyColon(line.text);
    if (colon === -1) {
      throw new YamlSubsetError(`Expected "key: value", got ${JSON.stringify(line.text)}`, line.number);
    }

    const key = unquote(line.text.slice(0, colon));
    const [value, next] = readMappingValue(lines, i + 1, line.text.slice(colon + 1), indent, line.number);
    map[key] = value;
    i = next;
  }

  return [map, i];
}

/**
 * Parse a YAML document in the supported subset.
 *
 * @throws {YamlSubsetError} on any construct the subset will not guess at.
 */
export function parseYamlSubset(source: string): YamlValue {
  const lines = readLines(source);
  if (lines.length === 0) return null;
  const [value, next] = parseBlock(lines, 0, lines[0].indent);
  if (next < lines.length) {
    // A line no container claimed. Returning what was read so far would be
    // the half-read document this module exists to refuse.
    requireSpaces(lines[next]);
    throw new YamlSubsetError("Unexpected content", lines[next].number);
  }
  return value;
}

// ── Reading a parsed document ───────────────────────────────────────────────

export function isMap(value: YamlValue): value is Record<string, YamlValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string at `key`, or `undefined` — never a coerced number or boolean. */
export function stringAt(value: YamlValue, key: string): string | undefined {
  if (!isMap(value)) return undefined;
  const found = value[key];
  return typeof found === "string" ? found : undefined;
}

/**
 * A list at `key`, normalised.
 *
 * CI files write the same thing three ways — `on: push`, `on: [push]` and a
 * nested `on:` map — so a single scalar and a map's keys both read as a list.
 */
export function listAt(value: YamlValue, key: string): string[] {
  if (!isMap(value)) return [];
  const found = value[key];
  if (found === undefined || found === null) return [];
  if (typeof found === "string") return [found];
  if (Array.isArray(found)) return found.filter((v): v is string => typeof v === "string");
  if (isMap(found)) return Object.keys(found);
  return [];
}
