/**
 * Markdown serializer — converts a PRDDocument to the rex/v1 markdown format.
 *
 * See packages/rex/docs/prd-markdown-schema.md for the authoritative spec.
 * Consult that document first for any questions about the format.
 *
 * Key decisions:
 * - Field ordering in rex-meta blocks: id, level, status, priority first,
 *   then all remaining known fields in alphabetical order.
 * - Empty arrays are omitted (canonical serialized form).
 * - Undefined/null values are omitted.
 * - UUIDs and ISO timestamps are always double-quoted.
 * - Unknown PRDItem fields are collected into _passthrough.
 * - Requirement.acceptanceCriteria is always written even when empty (required field).
 *
 * @module rex/store/markdown-serializer
 */

import type { PRDDocument, PRDItem, ItemLevel } from "../schema/index.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Heading depth for each item level (H2–H5). */
const LEVEL_TO_DEPTH: Record<ItemLevel, number> = {
  epic: 2,
  feature: 3,
  task: 4,
  subtask: 5,
};

/** Identity + state fields serialized first in every rex-meta block. */
const ORDERED_FIRST: ReadonlyArray<string> = ["id", "level", "status", "priority"];

/**
 * All known PRDItem fields that are serialized directly in the rex-meta
 * YAML block (not as passthrough). Must stay in sync with the schema spec.
 */
const YAML_KNOWN_FIELDS = new Set([
  "id", "level", "status", "priority", "branch", "sourceFile", "tags", "source", "blockedBy",
  "startedAt", "completedAt", "endedAt", "activeIntervals",
  "acceptanceCriteria",
  "loe", "loeRationale", "loeConfidence",
  "tokenUsage", "duration",
  "resolutionType", "resolutionDetail", "failureReason",
  "requirements",
  "overrideMarker", "mergedProposals",
]);

/**
 * Fields encoded in document structure (heading, prose, children nesting)
 * rather than in the rex-meta YAML block.
 */
const STRUCTURAL_FIELDS = new Set(["title", "description", "children"]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a PRDDocument to a rex/v1 markdown string.
 *
 * The output is deterministic for a given input: field ordering is fixed,
 * values are canonically quoted, and empty arrays are always omitted.
 */
export function serializeDocument(doc: PRDDocument): string {
  const parts: string[] = [];

  // Front-matter
  parts.push("---");
  parts.push(`schema: ${doc.schema}`);

  // Extra document-level passthrough fields (not schema/title/items)
  const knownDocFields = new Set(["schema", "title", "items"]);
  for (const [key, value] of Object.entries(doc)) {
    if (knownDocFields.has(key)) continue;
    if (value === undefined || value === null) continue;
    const line = serializeYamlEntry(key, value, "");
    if (line) parts.push(line);
  }

  parts.push("---");
  parts.push("");
  parts.push(`# ${doc.title}`);
  parts.push("");

  for (const item of doc.items) {
    parts.push(...serializeItemSection(item, true));
  }

  // Ensure exactly one trailing newline
  const result = parts.join("\n");
  return result.trimEnd() + "\n";
}

// ── Item serialization ────────────────────────────────────────────────────────

function serializeItemSection(item: PRDItem, isRoot: boolean): string[] {
  const depth = LEVEL_TO_DEPTH[item.level];
  const hashes = "#".repeat(depth);
  const lines: string[] = [];

  lines.push(`${hashes} ${item.title}`);
  lines.push("");

  // rex-meta fenced block
  lines.push("```rex-meta");
  const meta = buildMetaObject(item, isRoot);
  const yamlBody = serializeMapping(meta, "");
  if (yamlBody) lines.push(yamlBody);
  lines.push("```");
  lines.push("");

  // Prose description
  if (item.description) {
    lines.push(item.description);
    lines.push("");
  }

  // Children (DFS pre-order)
  if (item.children && item.children.length > 0) {
    for (const child of item.children) {
      lines.push(...serializeItemSection(child, false));
    }
  }

  return lines;
}

/**
 * Build the ordered meta object for YAML serialization.
 * 1. id, level, status, priority (in that order)
 * 2. Remaining known fields, alphabetically
 * 3. Unknown fields collected into _passthrough
 */
function buildMetaObject(item: PRDItem, isRoot: boolean): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  if (isRoot && item.level !== "epic") {
    meta.root = true;
  }

  // Step 1: ordered first
  for (const key of ORDERED_FIRST) {
    const value = item[key];
    if (value !== undefined && value !== null) {
      meta[key] = value;
    }
  }

  // Step 2: remaining known fields, alphabetically
  const remainingKnown = [...YAML_KNOWN_FIELDS]
    .filter(k => !ORDERED_FIRST.includes(k))
    .sort();

  for (const key of remainingKnown) {
    const value = item[key];
    if (value === undefined || value === null) continue;

    // acceptanceCriteria: skip empty array on item (unlike Requirement)
    if (key === "acceptanceCriteria" && Array.isArray(value) && value.length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;

    meta[key] = value;
  }

  // Step 3: collect unknown fields into _passthrough
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (YAML_KNOWN_FIELDS.has(key)) continue;
    if (STRUCTURAL_FIELDS.has(key)) continue;
    if (value === undefined || value === null) continue;
    passthrough[key] = value;
  }
  if (Object.keys(passthrough).length > 0) {
    meta["_passthrough"] = passthrough;
  }

  return meta;
}

// ── YAML serialization ────────────────────────────────────────────────────────

/**
 * Serialize a top-level block mapping.
 * Returns the YAML string (without trailing newline) for the body of a block.
 */
function serializeMapping(obj: Record<string, unknown>, indent: string): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const line = serializeYamlEntry(key, value, indent);
    if (line !== null) lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Serialize a single key-value entry to one or more YAML lines joined with \n.
 * Returns null if the value should be omitted.
 */
function serializeYamlEntry(key: string, value: unknown, indent: string): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value === "number" || typeof value === "boolean") {
    return `${indent}${key}: ${value}`;
  }

  if (typeof value === "string") {
    return `${indent}${key}: ${quoteYamlString(value)}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const seqLines = [`${indent}${key}:`];
    for (const item of value) {
      seqLines.push(...serializeSequenceItem(item, indent + "  "));
    }
    return seqLines.join("\n");
  }

  if (typeof value === "object") {
    const mappingBody = serializeMapping(value as Record<string, unknown>, indent + "  ");
    if (!mappingBody) return null;
    return `${indent}${key}:\n${mappingBody}`;
  }

  return null;
}

/**
 * Serialize a sequence item (element of a YAML array).
 * Objects: first field on the "- " line, remaining fields indented.
 * Scalars: "- value".
 * Returns one or more lines.
 */
function serializeSequenceItem(item: unknown, indent: string): string[] {
  if (item === undefined || item === null) return [];

  if (typeof item === "number" || typeof item === "boolean") {
    return [`${indent}- ${item}`];
  }

  if (typeof item === "string") {
    return [`${indent}- ${quoteYamlString(item)}`];
  }

  if (typeof item === "object" && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    const entries = Object.entries(obj).filter(([key, v]) => {
      if (v === undefined || v === null) return false;
      // acceptanceCriteria: [] must always be written on Requirement objects
      if (key === "acceptanceCriteria" && Array.isArray(v)) return true;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    });

    if (entries.length === 0) return [`${indent}- {}`];

    const [firstKey, firstVal] = entries[0];
    const lines: string[] = [];

    // First entry on same line as "- "
    if (typeof firstVal === "number" || typeof firstVal === "boolean") {
      lines.push(`${indent}- ${firstKey}: ${firstVal}`);
    } else if (typeof firstVal === "string") {
      lines.push(`${indent}- ${firstKey}: ${quoteYamlString(firstVal)}`);
    } else if (Array.isArray(firstVal)) {
      if (firstVal.length === 0) {
        lines.push(`${indent}- ${firstKey}: []`);
      } else {
        lines.push(`${indent}- ${firstKey}:`);
        for (const el of firstVal) {
          lines.push(...serializeSequenceItem(el, indent + "    "));
        }
      }
    } else if (typeof firstVal === "object" && firstVal !== null) {
      const body = serializeMapping(firstVal as Record<string, unknown>, indent + "    ");
      lines.push(`${indent}- ${firstKey}:`);
      if (body) lines.push(body);
    } else {
      lines.push(`${indent}- ${firstKey}: ${firstVal}`);
    }

    // Remaining entries: indented by 2 (past the "- ")
    const restIndent = indent + "  ";
    for (const [key, val] of entries.slice(1)) {
      if (val === undefined || val === null) continue;
      if (Array.isArray(val) && val.length === 0) {
        // Special case: acceptanceCriteria on Requirement must always be written
        if (key === "acceptanceCriteria") {
          lines.push(`${restIndent}${key}: []`);
        }
        continue;
      }
      const line = serializeYamlEntry(key, val, restIndent);
      if (line !== null) lines.push(line);
    }

    return lines;
  }

  return [];
}

// ── YAML string quoting ───────────────────────────────────────────────────────

/** Patterns that require a string to be double-quoted in YAML. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T/;
const YAML_BOOL_NULL_RE = /^(null|true|false|yes|no|on|off|~)$/i;
const LOOKS_LIKE_NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const YAML_INDICATOR_START_RE = /^[:{}&*#[\]|>%@`!?,]/;

function mustQuoteYamlString(s: string): boolean {
  if (s === "") return true;
  if (UUID_RE.test(s)) return true;
  if (ISO_TS_RE.test(s)) return true;
  if (YAML_BOOL_NULL_RE.test(s)) return true;
  if (LOOKS_LIKE_NUMBER_RE.test(s)) return true;
  if (YAML_INDICATOR_START_RE.test(s)) return true;
  if (s.includes(": ")) return true;
  if (/ #/.test(s)) return true;
  if (s !== s.trim()) return true;
  if (s.includes("\n") || s.includes("\r")) return true;
  // Quote strings containing backslashes or double quotes for readability
  // and to prevent ambiguity when the string is re-read.
  if (s.includes("\\") || s.includes('"')) return true;
  return false;
}

function quoteYamlString(s: string): string {
  if (!mustQuoteYamlString(s)) return s;
  // Double-quote with escaping
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}
