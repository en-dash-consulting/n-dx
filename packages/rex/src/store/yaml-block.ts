/**
 * The line-level layer of rex's hand-rolled YAML subset, shared by the two
 * live front-matter readers: the folder-tree parser (`index.md`) and the
 * markdown parser (`prd.md`).
 *
 * It covers indentation, splitting a `key: value` line, and `|` / `>` block
 * scalars with their chomping indicators. Scalar typing and sequence handling
 * differ between the two readers and stay in each. The frozen
 * `legacy-markdown-parser.ts` keeps its own copy on purpose.
 *
 * @module rex/store/yaml-block
 */

/** Leading spaces on `line`. */
export function countIndent(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

export type MappingLineSplit =
  | { key: string; kind: "scalar"; valueStr: string }
  | { key: string; kind: "block"; valueStr: "" }
  | { key: string; kind: "block-scalar"; indicator: BlockScalarIndicator; valueStr: "" }
  | { key: null; kind: "plain"; valueStr: string };

export interface BlockScalarIndicator {
  style: "literal" | "folded";
  chomping: "clip" | "strip" | "keep";
}

/**
 * Split a trimmed line into its mapping key and value: an inline scalar, a
 * nested block (`key:` alone), a block scalar header (`key: |-`), or no key at
 * all (a plain scalar line).
 */
export function splitMappingLine(trimmed: string): MappingLineSplit {
  const colonIdx = findColonSeparator(trimmed);
  const endsColon = trimmed.endsWith(":") && !trimmed.endsWith("\\:");

  if (colonIdx === -1 && !endsColon) {
    return { key: null, kind: "plain", valueStr: trimmed };
  }

  if (colonIdx !== -1) {
    const key = trimmed.slice(0, colonIdx);
    const valueStr = trimmed.slice(colonIdx + 2).trim();
    const blockScalar = parseBlockScalarHeader(valueStr);
    if (blockScalar) return { key, kind: "block-scalar", indicator: blockScalar, valueStr: "" };
    return { key, kind: "scalar", valueStr };
  }

  return { key: trimmed.slice(0, -1), kind: "block", valueStr: "" };
}

function parseBlockScalarHeader(valueStr: string): BlockScalarIndicator | null {
  if (!valueStr) return null;
  const head = valueStr[0];
  if (head !== "|" && head !== ">") return null;
  const style: "literal" | "folded" = head === "|" ? "literal" : "folded";
  const rest = valueStr.slice(1).trim();
  if (rest === "") return { style, chomping: "clip" };
  if (rest === "-") return { style, chomping: "strip" };
  if (rest === "+") return { style, chomping: "keep" };
  return null;
}

/** Index of the first `: ` outside double quotes, or -1. */
function findColonSeparator(s: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== "\\")) inQuote = !inQuote;
    if (!inQuote && s[i] === ":" && s[i + 1] === " ") return i;
  }
  return -1;
}

/**
 * Parse a block scalar starting at `start`. The block scalar indent is
 * determined by the first non-empty content line — it must be deeper than
 * `parentIndent`. Lines with less indent end the scalar.
 */
export function parseBlockScalar(
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
  // Empty scalar — no content lines.
  if (blockIndent <= parentIndent) return [applyChomping("", indicator.chomping), i];

  const collected: string[] = [];
  while (i < lines.length) {
    if (lines[i].trim() === "") { collected.push(""); i++; continue; }
    if (countIndent(lines[i]) < blockIndent) break;
    collected.push(lines[i].slice(blockIndent));
    i++;
  }

  // Trim purely-empty trailing lines that belong to following content; the
  // chomping indicator decides the trailing newline.
  while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();

  const content = indicator.style === "literal"
    ? collected.join("\n")
    : foldScalar(collected);

  return [applyChomping(content, indicator.chomping), i];
}

/** Folded style: join non-empty runs with a single space, blank lines preserved as `\n`. */
function foldScalar(lines: string[]): string {
  const out: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (line === "") {
      if (buf.length > 0) { out.push(buf.join(" ")); buf = []; }
      out.push("");
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) out.push(buf.join(" "));
  // Collapse "" markers into newlines.
  return out.join("\n").replace(/\n\n/g, "\n");
}

function applyChomping(content: string, chomping: "clip" | "strip" | "keep"): string {
  if (chomping === "strip") return stripTrailingNewlines(content);
  if (chomping === "keep") return content + (content.endsWith("\n") ? "" : "\n");
  // clip: single trailing newline (or none if content is empty)
  if (content === "") return "";
  return stripTrailingNewlines(content) + "\n";
}

/**
 * `content` without its trailing newlines. A loop, not `/\n*$/`: that regex
 * tries every newline in the body as a start, runs to the end of each run and
 * backtracks when `$` fails, so a block scalar with a long run of blank lines in
 * its middle costs quadratic time (6 s at 100k, on every `index.md` read and
 * whenever a legacy `prd.md` is read).
 */
function stripTrailingNewlines(content: string): string {
  let end = content.length;
  while (end > 0 && content.charCodeAt(end - 1) === 10) end--;
  return content.slice(0, end);
}
