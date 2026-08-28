/**
 * Three-way, frontmatter-aware merge of PRD markdown — the core of the
 * `rex merge-driver` git merge driver.
 *
 * PRD items live as markdown files with YAML frontmatter under
 * `.rex/prd_tree/`. Git's default text merge produces spurious conflicts on
 * them (two branches touching adjacent frontmatter lines) and, worse, silent
 * mis-merges of list fields. This module merges at FIELD granularity with a
 * rule per field class:
 *
 *   - `tags` / `blockedBy`  — three-way set merge: additions from both sides
 *     land, removals from either side stick. Never conflicts.
 *   - `status` / `priority` — when both sides changed to different values,
 *     the side with the later `lastModified` wins (the stamping added by the
 *     Collaboration Foundation work). No usable timestamps → real conflict.
 *   - `lastModified`        — the later of the two.
 *   - every other field, and the body below the frontmatter — plain
 *     three-way: a change on one side wins; identical changes collapse;
 *     divergent changes are a genuine conflict.
 *
 * Genuine conflicts render standard `<<<<<<<`/`=======`/`>>>>>>>` markers in
 * place and are reported to the caller, which exits nonzero so git marks the
 * path conflicted. Everything mergeable still merges around them.
 *
 * The merge works on raw frontmatter *chunks* (a top-level `key:` line plus
 * its indented continuation lines), parsing values only where a field class
 * needs semantics — so unknown fields, formatting, and quoting survive
 * untouched, matching the serializer's round-trip fidelity guarantee.
 *
 * @module rex/core/merge-driver
 */

// ── Public types ──────────────────────────────────────────────────────────────

/** Result of a three-way PRD markdown merge. */
export interface PrdMergeOutcome {
  /** The merged document; contains conflict markers when `conflicts` is non-empty. */
  merged: string;
  /** Names of fields (or `"body"`) that genuinely conflict. Empty means clean. */
  conflicts: string[];
}

/** Field classes with special merge semantics. */
const SET_MERGE_FIELDS = new Set(["tags", "blockedBy"]);
const LATEST_WINS_FIELDS = new Set(["status", "priority"]);
const LAST_MODIFIED = "lastModified";

const OURS_LABEL = "ours";
const THEIRS_LABEL = "theirs";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Merge `ours` and `theirs` against their common `ancestor`.
 *
 * All three are full file texts (frontmatter + body). A missing side is
 * passed as `""` — e.g. a file that did not exist in the ancestor.
 */
export function mergePrdMarkdown(
  ancestor: string,
  ours: string,
  theirs: string,
): PrdMergeOutcome {
  const base = splitDocument(ancestor);
  const mine = splitDocument(ours);
  const other = splitDocument(theirs);

  // A side without parseable frontmatter cannot be merged field-wise; fall
  // back to whole-document three-way so nothing is silently dropped.
  if (!mine.hasFrontmatter || !other.hasFrontmatter || !base.hasFrontmatter) {
    const doc = mergeText(ancestor, ours, theirs, "document");
    return { merged: doc.text, conflicts: doc.conflict ? ["document"] : [] };
  }

  const conflicts: string[] = [];
  const mergedChunks: string[] = [];

  // Timestamps for the latest-wins class, read once per side.
  const ourStamp = parseScalar(mine.fields.get(LAST_MODIFIED));
  const theirStamp = parseScalar(other.fields.get(LAST_MODIFIED));

  // Field order: ours first (it is what git leaves in the work tree), then
  // fields only theirs has, in theirs' order.
  const orderedKeys = [...mine.order];
  for (const key of other.order) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }
  // Fields deleted from both sides but present in the ancestor need no slot.

  for (const key of orderedKeys) {
    const b = base.fields.get(key);
    const o = mine.fields.get(key);
    const t = other.fields.get(key);

    if (SET_MERGE_FIELDS.has(key)) {
      const chunk = mergeSetField(key, b, o, t);
      if (chunk !== undefined) mergedChunks.push(chunk);
      continue;
    }

    if (key === LAST_MODIFIED) {
      const later = pickLater(o, t);
      if (later !== undefined) mergedChunks.push(later);
      continue;
    }

    const generic = mergeChunk(b, o, t);
    if (generic.kind === "value") {
      if (generic.value !== undefined) mergedChunks.push(generic.value);
      continue;
    }

    // Divergent change. status/priority defer to the later lastModified.
    if (LATEST_WINS_FIELDS.has(key) && ourStamp !== undefined && theirStamp !== undefined && ourStamp !== theirStamp) {
      const winner = ourStamp > theirStamp ? o : t;
      if (winner !== undefined) mergedChunks.push(winner);
      continue;
    }

    conflicts.push(key);
    mergedChunks.push(conflictBlock(o, t));
  }

  const body = mergeText(base.body, mine.body, other.body, "body");
  if (body.conflict) conflicts.push("body");

  const frontmatter = mergedChunks.join("\n");
  const merged = `---\n${frontmatter}${frontmatter ? "\n" : ""}---\n${body.text}`;
  return { merged, conflicts };
}

// ── Document splitting ────────────────────────────────────────────────────────

interface SplitDocument {
  hasFrontmatter: boolean;
  /** Field name → raw chunk (its `key:` line plus continuation lines). */
  fields: Map<string, string>;
  /** Field names in file order. */
  order: string[];
  /** Everything after the closing `---` (leading newline stripped). */
  body: string;
}

const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):/;

function splitDocument(text: string): SplitDocument {
  const empty: SplitDocument = { hasFrontmatter: false, fields: new Map(), order: [], body: text };
  const lines = text.split(/\r?\n/);

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || lines[i].trim() !== "---") return empty;
  i++;

  const fmLines: string[] = [];
  while (i < lines.length && lines[i].trim() !== "---") {
    fmLines.push(lines[i]);
    i++;
  }
  if (i >= lines.length) return empty; // unclosed frontmatter

  const fields = new Map<string, string>();
  const order: string[] = [];
  let currentKey: string | null = null;
  let currentChunk: string[] = [];
  const flush = (): void => {
    if (currentKey === null) return;
    fields.set(currentKey, currentChunk.join("\n"));
    order.push(currentKey);
  };
  for (const line of fmLines) {
    const m = TOP_LEVEL_KEY.exec(line);
    if (m) {
      flush();
      currentKey = m[1];
      currentChunk = [line];
    } else if (currentKey !== null) {
      currentChunk.push(line);
    }
    // Lines before any key (stray comments) are dropped — the serializer
    // never emits them.
  }
  flush();

  const body = lines.slice(i + 1).join("\n");
  return { hasFrontmatter: true, fields, order, body };
}

// ── Field-class merges ────────────────────────────────────────────────────────

type ChunkMerge = { kind: "value"; value: string | undefined } | { kind: "conflict" };

/**
 * Generic three-way on raw chunks. `undefined` means "field absent on that
 * side". Returns a conflict only when both sides changed to different states.
 */
function mergeChunk(
  base: string | undefined,
  ours: string | undefined,
  theirs: string | undefined,
): ChunkMerge {
  if (ours === theirs) return { kind: "value", value: ours };
  if (ours === base) return { kind: "value", value: theirs };
  if (theirs === base) return { kind: "value", value: ours };
  return { kind: "conflict" };
}

/** Three-way set merge for list fields: additions from both, removals stick. */
function mergeSetField(
  key: string,
  base: string | undefined,
  ours: string | undefined,
  theirs: string | undefined,
): string | undefined {
  const b = parseList(base);
  const o = parseList(ours);
  const t = parseList(theirs);

  const removed = new Set([
    ...b.filter((v) => !o.includes(v)),
    ...b.filter((v) => !t.includes(v)),
  ]);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const v of [...o, ...t]) {
    if (removed.has(v) || seen.has(v)) continue;
    seen.add(v);
    values.push(v);
  }

  if (values.length === 0) return undefined; // field vanished
  return [`${key}:`, ...values.map((v) => `  - ${JSON.stringify(v)}`)].join("\n");
}

/** The chunk whose scalar value is lexically later (ISO timestamps sort correctly). */
function pickLater(ours: string | undefined, theirs: string | undefined): string | undefined {
  const o = parseScalar(ours);
  const t = parseScalar(theirs);
  if (o === undefined) return theirs;
  if (t === undefined) return ours;
  return o >= t ? ours : theirs;
}

// ── Body / whole-text merge ───────────────────────────────────────────────────

function mergeText(
  base: string,
  ours: string,
  theirs: string,
  _label: string,
): { text: string; conflict: boolean } {
  if (ours === theirs) return { text: ours, conflict: false };
  if (ours === base) return { text: theirs, conflict: false };
  if (theirs === base) return { text: ours, conflict: false };
  return { text: conflictBlock(ours, theirs), conflict: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function conflictBlock(ours: string | undefined, theirs: string | undefined): string {
  return [
    `<<<<<<< ${OURS_LABEL}`,
    ...(ours !== undefined && ours !== "" ? [ours] : []),
    "=======",
    ...(theirs !== undefined && theirs !== "" ? [theirs] : []),
    `>>>>>>> ${THEIRS_LABEL}`,
  ].join("\n");
}

/** Scalar value of a single-line chunk, unquoted; undefined for absent/multi-line. */
function parseScalar(chunk: string | undefined): string | undefined {
  if (chunk === undefined || chunk.includes("\n")) return undefined;
  const value = chunk.slice(chunk.indexOf(":") + 1).trim();
  if (value === "") return undefined;
  return stripQuotes(value);
}

/** Values of a list chunk (block `- "x"` lines or inline `[...]`). */
function parseList(chunk: string | undefined): string[] {
  if (chunk === undefined) return [];
  const lines = chunk.split("\n");
  const head = lines[0].slice(lines[0].indexOf(":") + 1).trim();

  if (head.startsWith("[")) {
    try {
      const parsed = JSON.parse(head) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Not JSON — fall through to block parsing.
    }
  }

  const values: string[] = [];
  for (const line of lines.slice(1)) {
    const m = /^\s*-\s*(.*)$/.exec(line);
    if (m) values.push(stripQuotes(m[1].trim()));
  }
  return values;
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}
