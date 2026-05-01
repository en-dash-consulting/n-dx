/**
 * Folder-tree-to-PRD parser.
 *
 * Traverses a .rex/prd_tree/ directory (or configurable root), parses each
 * index.md, and reconstructs the full PRD item tree in memory.
 *
 * Contract (see docs/architecture/prd-folder-tree-schema.md):
 *   - Depth 1 dirs -> epics
 *   - Depth 2 dirs -> features
 *   - Depth 3 dirs -> tasks
 *   - Depth 4 dirs -> subtasks
 *   - Legacy `## Subtask:` sections are still parsed for backward compatibility
 *   - `## Children` table is informational only; directory nesting is authoritative
 *   - Parse order: alphabetical by directory name within each level
 *   - Never throws; emits structured warnings for missing or malformed files
 *
 * @module rex/store/folder-tree-parser
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  PRDItem,
  ItemLevel,
  ItemStatus,
  Priority,
  ResolutionType,
} from "../schema/index.js";

// ── Public types ──────────────────────────────────────────────────────────────

/** A structured warning emitted when a file is missing, malformed, or skipped. */
export interface ParseWarning {
  /** File path that caused the warning. */
  path: string;
  /** Human-readable description of the problem. */
  message: string;
}

/** Result of parsing a folder tree. Never throws — always returns. */
export interface FolderParseResult {
  /** Reconstructed epic items with nested feature/task/subtask children. */
  items: PRDItem[];
  /** Non-fatal warnings encountered during traversal. */
  warnings: ParseWarning[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse the folder tree at `treeRoot` into a list of PRDItems with nested
 * children. Never throws; missing treeRoot returns empty items with a warning.
 *
 * Each item's level comes from its frontmatter — directory depth is treated
 * as a hint, not as authoritative. This lets the tree round-trip every shape
 * legal under {@link LEVEL_HIERARCHY} (e.g. a task placed directly under an
 * epic) without re-typing items.
 */
export async function parseFolderTree(treeRoot: string): Promise<FolderParseResult> {
  const warnings: ParseWarning[] = [];
  const items: PRDItem[] = [];

  const rootExists = await isDirectory(treeRoot);
  if (!rootExists) {
    warnings.push({ path: treeRoot, message: "Tree root directory does not exist" });
    return { items, warnings };
  }

  for (const childDir of await listSubdirs(treeRoot)) {
    const item = await parseDirRecursive(join(treeRoot, childDir), 1, warnings);
    if (item) items.push(item);
  }

  return { items, warnings };
}

/**
 * Recursively parse a directory in the folder tree into a PRDItem.
 *
 * The item's `level` is taken from its frontmatter. `depth` is passed through
 * only to provide a useful hint when frontmatter is missing or malformed.
 */
async function parseDirRecursive(
  dir: string,
  depth: number,
  warnings: ParseWarning[],
): Promise<PRDItem | null> {
  const itemFile = await discoverItemFile(dir, warnings);
  if (!itemFile) return null;

  const item = await parseItemFileFromFrontmatter(itemFile, depth, warnings);
  if (!item) return null;

  // Recursively parse subdirectories as children.
  const childItems: PRDItem[] = [];
  for (const childDir of await listSubdirs(dir)) {
    const child = await parseDirRecursive(join(dir, childDir), depth + 1, warnings);
    if (child) childItems.push(child);
  }

  // Tasks may also carry legacy `## Subtask:` sections in their index.md.
  // Merge them in, preferring directory-based subtasks on id collisions.
  if (item.level === "task") {
    const legacySubtasks = await readLegacySubtasksIfTask(itemFile, warnings);
    if (legacySubtasks.length > 0) {
      const seenIds = new Set(childItems.map((c) => c.id));
      for (const legacy of legacySubtasks) {
        if (!seenIds.has(legacy.id)) childItems.push(legacy);
      }
    }
  }

  if (childItems.length > 0) item.children = childItems;
  return item;
}

/**
 * Read a task's index.md and extract any legacy `## Subtask:` sections.
 * Returns an empty array if the file isn't a legacy task file.
 */
async function readLegacySubtasksIfTask(
  filePath: string,
  warnings: ParseWarning[],
): Promise<PRDItem[]> {
  const text = await readIndexFile(filePath, warnings);
  if (text === null) return [];
  return parseSubtaskSections(text, filePath, warnings);
}

// ── Directory utilities ───────────────────────────────────────────────────────

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Return direct subdirectory names of `dir` in alphabetical order. */
async function listSubdirs(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (await isDirectory(join(dir, entry))) dirs.push(entry);
  }
  return dirs.sort();
}

/**
 * Discover the item file in a directory, using title-named files with fallback
 * to legacy index.md.
 *
 * Discovery algorithm:
 * 1. Scan directory for `.md` files (excluding index.md)
 * 2. If exactly one non-index markdown file exists, return its full path
 * 3. Else if `index.md` exists, return its full path (legacy fallback)
 * 4. Else return null and emit warning
 *
 * This supports migration: during transition, both title-named and index.md
 * can coexist. The deterministic discovery rule ensures consistent behavior.
 */
async function discoverItemFile(
  dir: string,
  warnings: ParseWarning[],
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    warnings.push({ path: dir, message: "Directory not readable" });
    return null;
  }

  // Find all .md files (excluding index.md)
  const markdownFiles = entries.filter(
    (f) => f.endsWith(".md") && f !== "index.md",
  );

  // If exactly one non-index markdown file, use it
  if (markdownFiles.length === 1) {
    return join(dir, markdownFiles[0]);
  }

  // Else fall back to index.md if it exists
  const indexPath = join(dir, "index.md");
  try {
    await stat(indexPath);
    return indexPath;
  } catch {
    // Neither title-named nor index.md exists
    warnings.push({
      path: dir,
      message: "No item markdown file found (expected index.md or title-named .md file)",
    });
    return null;
  }
}

// ── index.md parsing ──────────────────────────────────────────────────────────

/**
 * Read an item's markdown file and build a PRDItem from its frontmatter.
 * The item's `level` is taken from frontmatter; `depth` is used only to
 * emit a warning when the two disagree (it is not authoritative).
 */
async function parseItemFileFromFrontmatter(
  filePath: string,
  depth: number,
  warnings: ParseWarning[],
): Promise<PRDItem | null> {
  const text = await readIndexFile(filePath, warnings);
  if (text === null) return null;

  const fm = parseFrontmatter(text, filePath, warnings);
  if (fm === null) return null;

  return buildItem(fm, filePath, depth, warnings);
}

async function readIndexFile(filePath: string, warnings: ParseWarning[]): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    warnings.push({ path: filePath, message: "index.md not found or unreadable" });
    return null;
  }
}

// ── Frontmatter → PRDItem ─────────────────────────────────────────────────────

function buildItem(
  fm: Record<string, unknown>,
  filePath: string,
  depth: number,
  warnings: ParseWarning[],
): PRDItem | null {
  const expectedLevel = depthToLevel(depth);
  const id = asString(fm["id"]);
  if (!id) {
    warnings.push({ path: filePath, message: "Missing required frontmatter field: id" });
    return null;
  }

  const title = asString(fm["title"]);
  if (!title) {
    warnings.push({ path: filePath, message: `Missing required frontmatter field: title (id=${id})` });
    return null;
  }

  const levelRaw = asString(fm["level"]);
  if (!levelRaw) {
    warnings.push({ path: filePath, message: `Missing required frontmatter field: level (id=${id})` });
    return null;
  }
  const level = levelRaw as ItemLevel;

  const statusRaw = asString(fm["status"]);
  if (!statusRaw) {
    warnings.push({ path: filePath, message: `Missing required frontmatter field: status (id=${id})` });
    return null;
  }
  const status = statusRaw as ItemStatus;

  const item: PRDItem = { id, title, status, level };

  const description = asString(fm["description"]);
  if (description !== null) item.description = description;

  const priority = asString(fm["priority"]) as Priority | null;
  if (priority !== null) item.priority = priority;

  const tags = asStringList(fm["tags"]);
  if (tags !== null) item.tags = tags;

  const blockedBy = asStringList(fm["blockedBy"]);
  if (blockedBy !== null) item.blockedBy = blockedBy;

  const source = asString(fm["source"]);
  if (source !== null) item.source = source;

  const startedAt = asString(fm["startedAt"]);
  if (startedAt !== null) item.startedAt = startedAt;

  const completedAt = asString(fm["completedAt"]);
  if (completedAt !== null) item.completedAt = completedAt;

  const endedAt = asString(fm["endedAt"]);
  if (endedAt !== null) item.endedAt = endedAt;

  const resolutionType = asString(fm["resolutionType"]) as ResolutionType | null;
  if (resolutionType !== null) item.resolutionType = resolutionType;

  const resolutionDetail = asString(fm["resolutionDetail"]);
  if (resolutionDetail !== null) item.resolutionDetail = resolutionDetail;

  const failureReason = asString(fm["failureReason"]);
  if (failureReason !== null) item.failureReason = failureReason;

  // acceptanceCriteria: preserve whenever present in frontmatter (any level).
  // Feature and task items default to [] when the field is absent; epics and
  // subtasks do not. We use the frontmatter level here so that skip-level
  // placements (e.g. a task at depth 2) get the right default for their
  // actual level rather than for the depth-derived level.
  const ac = asStringList(fm["acceptanceCriteria"]);
  if (ac !== null) {
    item.acceptanceCriteria = ac;
  } else if (level === "feature" || level === "task") {
    item.acceptanceCriteria = [];
  }

  const loe = asString(fm["loe"]);
  if (loe !== null) (item as PRDItem & { loe: string }).loe = loe;

  // Preserve unknown fields (forward-compat: round-trip fidelity for future extensions)
  const knownKeys = new Set([
    "id", "level", "title", "status", "description", "priority", "tags", "blockedBy",
    "source", "startedAt", "completedAt", "endedAt", "resolutionType",
    "resolutionDetail", "failureReason", "acceptanceCriteria", "loe",
  ]);
  for (const [k, v] of Object.entries(fm)) {
    if (!knownKeys.has(k) && v !== null && v !== undefined) {
      (item as Record<string, unknown>)[k] = v;
    }
  }

  // Frontmatter `level` is authoritative — directory depth is just a hint.
  // Skip-level placements (e.g. a task at depth 2 with no intermediate
  // feature) are legal under LEVEL_HIERARCHY, so we surface a warning when
  // depth and frontmatter disagree but never mutate the level.
  if (expectedLevel !== null && level !== expectedLevel) {
    warnings.push({
      path: filePath,
      message: `Frontmatter level "${level}" does not match depth-derived level "${expectedLevel}" — preserving frontmatter (item id=${id})`,
    });
  }

  return item;
}

/**
 * Depth-to-level mapping used as a hint when frontmatter level is missing
 * or to surface a warning when the two disagree. Returns null for depths
 * outside the canonical 4-level hierarchy.
 */
function depthToLevel(depth: number): "epic" | "feature" | "task" | "subtask" | null {
  switch (depth) {
    case 1: return "epic";
    case 2: return "feature";
    case 3: return "task";
    case 4: return "subtask";
    default: return null;
  }
}

// ── Subtask section parsing ───────────────────────────────────────────────────

/**
 * Parse `## Subtask: {title}` sections from the body of a task index.md.
 * Returns an array of subtask PRDItems. Emits warnings for malformed sections.
 */
function parseSubtaskSections(
  text: string,
  filePath: string,
  warnings: ParseWarning[],
): PRDItem[] {
  // Locate body (after closing ---)
  const bodyStart = findBodyStart(text);
  if (bodyStart === -1) return [];
  const body = text.slice(bodyStart);

  // Split on horizontal rules to get raw sections
  // Each section starts with "## Subtask: {title}"
  const rawSections = body.split(/\n---\n|\n---$/);
  const subtasks: PRDItem[] = [];

  for (const section of rawSections) {
    const headingMatch = section.match(/^## Subtask: (.+)$/m);
    if (!headingMatch) continue;

    const title = headingMatch[1].trim();
    const subtask = parseSubtaskSection(section, title, filePath, warnings);
    if (subtask) subtasks.push(subtask);
  }

  return subtasks;
}

/** Parse one subtask section block into a PRDItem. */
function parseSubtaskSection(
  section: string,
  title: string,
  filePath: string,
  warnings: ParseWarning[],
): PRDItem | null {
  // **ID:** `{uuid}`
  const idMatch = section.match(/\*\*ID:\*\*\s*`([^`]+)`/);
  if (!idMatch) {
    warnings.push({ path: filePath, message: `Subtask "${title}" is missing **ID:** field` });
    return null;
  }
  const id = idMatch[1].trim();

  // **Status:** {status}
  const statusMatch = section.match(/\*\*Status:\*\*\s*(\S+)/);
  const status: ItemStatus = statusMatch ? (statusMatch[1].trim() as ItemStatus) : "pending";

  // **Priority:** {priority} (optional)
  const priorityMatch = section.match(/\*\*Priority:\*\*\s*(\S+)/);
  const priority: Priority | undefined = priorityMatch
    ? (priorityMatch[1].trim() as Priority)
    : undefined;

  // Description: text between the header metadata block and **Acceptance Criteria** (or end)
  const description = extractSubtaskDescription(section);

  // **Acceptance Criteria** list
  const acceptanceCriteria = extractSubtaskAC(section);

  const subtask: PRDItem = {
    id,
    title,
    status,
    level: "subtask",
  };
  if (priority !== undefined) subtask.priority = priority;
  if (description) subtask.description = description;
  if (acceptanceCriteria.length > 0) subtask.acceptanceCriteria = acceptanceCriteria;

  return subtask;
}

/**
 * Extract description text from a subtask section.
 * Description is the prose between the last metadata line (ID/Status/Priority)
 * and the **Acceptance Criteria** heading (or end of section).
 */
function extractSubtaskDescription(section: string): string {
  const lines = section.split("\n");
  let metaEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("**ID:**") || lines[i].startsWith("**Status:**") || lines[i].startsWith("**Priority:**")) {
      metaEnd = i;
    }
  }

  const acIdx = lines.findIndex(l => l.startsWith("**Acceptance Criteria**"));
  const end = acIdx !== -1 ? acIdx : lines.length;
  const start = metaEnd + 1;

  const descLines = lines.slice(start, end).join("\n").trim();
  return descLines;
}

/**
 * Extract acceptance criteria bullet list from a subtask section.
 */
function extractSubtaskAC(section: string): string[] {
  const acMatch = section.match(/\*\*Acceptance Criteria\*\*\n([\s\S]+?)(?:\n\n|$)/);
  if (!acMatch) return [];
  const lines = acMatch[1].split("\n");
  const criteria: string[] = [];
  for (const line of lines) {
    const m = line.match(/^- (.+)$/);
    if (m) criteria.push(m[1].trim());
  }
  return criteria;
}

/** Find the character offset of the body (after the closing `---` of frontmatter). */
function findBodyStart(text: string): number {
  // Skip opening ---
  const firstDash = text.indexOf("---");
  if (firstDash === -1) return -1;
  const afterFirst = firstDash + 3;
  // Find closing ---
  const closingDash = text.indexOf("\n---", afterFirst);
  if (closingDash === -1) return -1;
  return closingDash + 4; // skip the \n--- itself
}

// ── YAML frontmatter parser ───────────────────────────────────────────────────
//
// Hand-rolled to avoid external dependencies. Covers the subset used in
// folder-tree index.md files (see docs/architecture/prd-folder-tree-schema.md):
//   - Block mappings with string/list/block-scalar values
//   - Double-quoted and plain scalars
//   - Inline `[]` empty list
//   - `>`, `>-`, `>+`, `|`, `|-`, `|+` block scalars (for description fields)
//   - Block sequences of plain or quoted scalars (for tags, acceptanceCriteria)

function parseFrontmatter(
  text: string,
  filePath: string,
  warnings: ParseWarning[],
): Record<string, unknown> | null {
  const lines = text.split("\n");

  // Find opening ---
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || lines[i].trim() !== "---") {
    warnings.push({ path: filePath, message: "Missing frontmatter opening ---" });
    return null;
  }
  i++;

  // Collect frontmatter lines
  const fmLines: string[] = [];
  while (i < lines.length && lines[i].trim() !== "---") {
    fmLines.push(lines[i]);
    i++;
  }
  if (i >= lines.length) {
    warnings.push({ path: filePath, message: "Unclosed frontmatter block (missing closing ---)" });
    return null;
  }

  try {
    const [parsed] = parseYamlBlock(fmLines, 0, 0);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      warnings.push({ path: filePath, message: "Frontmatter is not a YAML mapping" });
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    warnings.push({ path: filePath, message: `Frontmatter YAML parse error: ${err}` });
    return null;
  }
}

// ── Minimal YAML parser ────────────────────────────────────────────────────────

function countIndent(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
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
      result[split.key] = parseScalar(split.valueStr);
      i++;
    }
  }

  return [result, i];
}

function parseYamlSequence(lines: string[], start: number, seqIndent: number): [unknown[], number] {
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
    // Inline JSON flow mapping (e.g. emitted for object-array fields like `commits`).
    if (rest.startsWith("{") && rest.endsWith("}")) {
      try {
        items.push(JSON.parse(rest));
        i++;
        continue;
      } catch {
        // Fall through to scalar parsing if it isn't valid JSON.
      }
    }
    items.push(parseScalar(rest));
    i++;
  }

  return [items, i];
}

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

function findColonSeparator(s: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== "\\")) inQuote = !inQuote;
    if (!inQuote && s[i] === ":" && s[i + 1] === " ") return i;
  }
  return -1;
}

function parseBlockScalar(
  lines: string[],
  start: number,
  parentIndent: number,
  indicator: BlockScalarIndicator,
): [string, number] {
  let i = start;
  let blockIndent = -1;
  let scanI = i;
  while (scanI < lines.length) {
    if (lines[scanI].trim() === "") { scanI++; continue; }
    blockIndent = countIndent(lines[scanI]);
    break;
  }
  if (blockIndent <= parentIndent) return [applyChomping("", indicator.chomping), i];

  const collected: string[] = [];
  while (i < lines.length) {
    if (lines[i].trim() === "") { collected.push(""); i++; continue; }
    if (countIndent(lines[i]) < blockIndent) break;
    collected.push(lines[i].slice(blockIndent));
    i++;
  }

  while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();

  const content = indicator.style === "literal"
    ? collected.join("\n")
    : foldScalar(collected);

  return [applyChomping(content, indicator.chomping), i];
}

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
  return out.join("\n").replace(/\n\n/g, "\n");
}

function applyChomping(content: string, chomping: "clip" | "strip" | "keep"): string {
  if (chomping === "strip") return content.replace(/\n*$/, "");
  if (chomping === "keep") return content + (content.endsWith("\n") ? "" : "\n");
  if (content === "") return "";
  return content.replace(/\n*$/, "") + "\n";
}

function parseScalar(s: string): unknown {
  s = s.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "[]") return [];
  // Inline JSON flow mapping or sequence (emitted for nested object/array fields).
  if ((s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return JSON.parse(s);
    } catch {
      // Fall through to plain-scalar handling if it isn't valid JSON.
    }
  }
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === "true" || s === "yes") return true;
  if (s === "false" || s === "no") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

// ── Scalar coercions ──────────────────────────────────────────────────────────

/** Return the value as a string, or null if absent/non-string. */
function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** Return the value as a string[], or null if absent. Coerces scalars to single-element list. */
function asStringList(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(item => (typeof item === "string" ? item : String(item)));
  if (typeof v === "string") return [v];
  return null;
}
