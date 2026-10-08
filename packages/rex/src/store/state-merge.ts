/**
 * Three-way merge of a v2 `state.yaml`: the core of the `rex merge-state` git
 * merge driver.
 *
 * Parallel branches each write the same folder's `state.yaml` (a child added
 * on each, two tasks completed in one folder). A text merge conflicts on
 * adjacent rows; this merges the file as a map keyed by item id.
 *
 * ## Rules
 *
 * - **Rows** merge by id. A row on one side only is kept, so concurrent child
 *   adds merge cleanly. A row removed on one side and unchanged on the other
 *   is removed; removed against modified keeps the modified row (state is
 *   never dropped silently).
 * - **Fields** merge three-way by value: a change on one side wins, identical
 *   changes collapse. When both sides changed a field to different values:
 *   - `metAt` is recomputed, not picked: the side whose value equals the
 *     spec hash of the node's current statement and criteria
 *     (`specHash`) is the node's met hash, and `revisedAt` is cleared since
 *     the spec now matches it. With no spec, or neither value matching, it
 *     conflicts.
 *   - `status` is recomputed from the merged row: a merged `completedAt`
 *     means the item was completed, and the timestamp rules clear
 *     `completedAt` whenever an item leaves `completed`, so the status is
 *     `completed`. Otherwise it conflicts. The same holds when only
 *     `completedAt` diverged and the later side's completion was kept.
 *   - `startedAt` and `revisedAt` take the earlier stamp; `lastModified`
 *     the later.
 *   - Every other field, `lastModifiedBy` included, takes the side with the
 *     later `lastModified`. With no usable stamps it conflicts.
 * - **Top-level keys** (`schema` and keys a newer build added) merge
 *   three-way by value; a divergent change conflicts.
 *
 * A side that does not parse falls back to a whole-file three-way. Conflicts
 * render git's markers around the conflicting field's two lines, and are
 * reported so the driver exits nonzero and git marks the path conflicted.
 *
 * Output is the state writer's canonical form (`serializeStateYaml`). Unknown
 * keys keep their value, though not their original spelling.
 *
 * @module rex/store/state-merge
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { NodeIntentSchema, type ItemState, type StateFile } from "../schema/v2.js";
import { specHash } from "../schema/v2-rules.js";
import { parseFrontmatter, type ParseWarning } from "./folder-tree-parser.js";
import { canonicalJson, emptyStateFile, parseStateYaml, serializeStateYaml, type ProductSpec } from "./state-writer.js";

/** Result of a three-way `state.yaml` merge. */
export interface StateMergeOutcome {
  /** The merged file; contains conflict markers when `conflicts` is non-empty. */
  merged: string;
  /** What genuinely conflicts: `<item id>.<field>`, a top-level key, or the whole file. Empty means clean. */
  conflicts: string[];
}

export interface StateMergeOptions {
  /** Current spec of product nodes by id, for recomputing a divergent `metAt`. */
  specs?: ReadonlyMap<string, ProductSpec>;
}

type Row = Record<string, unknown>;

/** A field both sides changed differently, rendered as markers in the output. */
interface Conflict {
  label: string;
  ours: unknown;
  theirs: unknown;
}

const OURS_MARKER = "<<<<<<< ours";
const SPLIT_MARKER = "=======";
const THEIRS_MARKER = ">>>>>>> theirs";
/** Stand-in value for a conflicting field; a NUL never occurs in a parsed value's JSON. */
const SENTINEL_PREFIX = "\u0000rex-state-conflict:";

/**
 * Merge `ours` and `theirs` against their common `ancestor`. All three are
 * full `state.yaml` texts; a side with no file is passed as `""`.
 */
export function mergeStateYaml(ancestor: string, ours: string, theirs: string, options: StateMergeOptions = {}): StateMergeOutcome {
  let files: [StateFile, StateFile, StateFile];
  try {
    files = [parseSide(ancestor, "ancestor"), parseSide(ours, "ours"), parseSide(theirs, "theirs")];
  } catch (err) {
    return mergeWholeFile(ancestor, ours, theirs, (err as Error).message);
  }
  const [base, mine, other] = files;
  const conflicts: Conflict[] = [];
  const merged: StateFile = { ...emptyStateFile(), items: {} };

  for (const key of unionKeys(base, mine, other).filter((k) => k !== "items")) {
    const value = mergeValue(base[key], mine[key], other[key]);
    if (value.kind === "value") setOrDelete(merged, key, value.value);
    else merged[key] = conflictSentinel(conflicts, key, mine[key], other[key]);
  }

  for (const id of unionKeys(base.items, mine.items, other.items).sort()) {
    const row = mergeRow(id, base.items[id], mine.items[id], other.items[id], options.specs?.get(id), conflicts);
    if (row) merged.items[id] = row as ItemState;
  }

  return { merged: renderConflicts(serializeStateYaml(merged), conflicts), conflicts: conflicts.map((c) => c.label) };
}

function parseSide(text: string, side: string): StateFile {
  return text.trim() === "" ? emptyStateFile() : parseStateYaml(text, `${side} state.yaml`);
}

// ── Rows ─────────────────────────────────────────────────────────

function mergeRow(
  id: string,
  base: Row | undefined,
  ours: Row | undefined,
  theirs: Row | undefined,
  spec: ProductSpec | undefined,
  conflicts: Conflict[],
): Row | undefined {
  if (ours === undefined || theirs === undefined) {
    const kept = ours ?? theirs;
    // Removed on one side: honour it only when the other side left the row as it was.
    return kept === undefined || (base !== undefined && sameValue(kept, base)) ? undefined : kept;
  }

  const ancestor = base ?? {};
  const row: Row = {};
  const divergent: string[] = [];
  for (const key of unionKeys(ancestor, ours, theirs)) {
    const value = mergeValue(ancestor[key], ours[key], theirs[key]);
    if (value.kind === "value") setOrDelete(row, key, value.value);
    else divergent.push(key);
  }

  const later = laterSide(ours, theirs);
  const conflict = (key: string): void => {
    row[key] = conflictSentinel(conflicts, `${id}.${key}`, ours[key], theirs[key]);
  };
  // `status` reads the merged `completedAt`, so it resolves last.
  const ordered = [...divergent.filter((k) => k !== "status"), ...divergent.filter((k) => k === "status")];
  for (const key of ordered) {
    const o = ours[key];
    const t = theirs[key];
    switch (key) {
      case "metAt": {
        const hash = spec ? specHash(spec) : undefined;
        if (hash !== undefined && (o === hash || t === hash)) row.metAt = hash;
        else conflict(key);
        break;
      }
      case "status":
        if (isValue(row.completedAt)) row.status = "completed";
        else conflict(key);
        break;
      case "startedAt":
      case "revisedAt":
        setOrDelete(row, key, earlier(o, t));
        break;
      case "lastModified":
        setOrDelete(row, key, laterOf(o, t));
        break;
      default:
        if (later === undefined) conflict(key);
        else setOrDelete(row, key, later === "ours" ? o : t);
    }
  }
  // A recomputed `metAt` equals the current spec hash, so the spec is no longer revised.
  if (divergent.includes("metAt") && spec && row.metAt === specHash(spec)) delete row.revisedAt;
  // A `completedAt` taken from one side by `lastModified` while `status` came
  // from the other (re-completed here, failed there) must not leave a
  // completion under a non-completed status: recompute it the same way.
  if (divergent.includes("completedAt") && isValue(row.completedAt) && isValue(row.status)) row.status = "completed";
  return row;
}

/** A merged value that is present and not a conflict stand-in. */
function isValue(value: unknown): boolean {
  return value !== undefined && !(typeof value === "string" && value.startsWith(SENTINEL_PREFIX));
}

/** The side whose `lastModified` is later; undefined when either is missing or they tie. */
function laterSide(ours: Row, theirs: Row): "ours" | "theirs" | undefined {
  const o = ours.lastModified;
  const t = theirs.lastModified;
  if (typeof o !== "string" || typeof t !== "string" || o === t) return undefined;
  return o > t ? "ours" : "theirs";
}

/** The earlier of two ISO stamps (ISO strings sort chronologically); a missing side yields the other. */
function earlier(a: unknown, b: unknown): unknown {
  if (typeof a !== "string") return b;
  if (typeof b !== "string") return a;
  return a <= b ? a : b;
}

/** The later of two ISO stamps; a missing side yields the other. */
function laterOf(a: unknown, b: unknown): unknown {
  if (typeof a !== "string") return b;
  if (typeof b !== "string") return a;
  return a >= b ? a : b;
}

// ── Values ───────────────────────────────────────────────────────

type ValueMerge = { kind: "value"; value: unknown } | { kind: "conflict" };

/** Plain three-way on values (`undefined` = absent on that side). */
function mergeValue(base: unknown, ours: unknown, theirs: unknown): ValueMerge {
  if (sameValue(ours, theirs)) return { kind: "value", value: ours };
  if (sameValue(ours, base)) return { kind: "value", value: theirs };
  if (sameValue(theirs, base)) return { kind: "value", value: ours };
  return { kind: "conflict" };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  return canonicalJson(a) === canonicalJson(b);
}

function setOrDelete(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function unionKeys(...objects: Array<Record<string, unknown>>): string[] {
  return [...new Set(objects.flatMap((o) => Object.keys(o)))];
}

// ── Conflicts ────────────────────────────────────────────────────

function conflictSentinel(conflicts: Conflict[], label: string, ours: unknown, theirs: unknown): string {
  conflicts.push({ label, ours, theirs });
  return `${SENTINEL_PREFIX}${conflicts.length - 1}`;
}

/** Replace each sentinel's line with git conflict markers around both sides' lines. */
function renderConflicts(text: string, conflicts: readonly Conflict[]): string {
  if (conflicts.length === 0) return text;
  return text
    .split("\n")
    .flatMap((line) => {
      const index = conflicts.findIndex((_c, i) => line.includes(JSON.stringify(`${SENTINEL_PREFIX}${i}`)));
      if (index === -1) return [line];
      const { ours, theirs } = conflicts[index];
      const prefix = line.slice(0, line.indexOf(JSON.stringify(`${SENTINEL_PREFIX}${index}`)));
      const side = (value: unknown): string[] => (value === undefined ? [] : [prefix + canonicalJson(value)]);
      return [OURS_MARKER, ...side(ours), SPLIT_MARKER, ...side(theirs), THEIRS_MARKER];
    })
    .join("\n");
}

/** Whole-file three-way, for a side that does not parse. */
function mergeWholeFile(ancestor: string, ours: string, theirs: string, reason: string): StateMergeOutcome {
  if (ours === theirs || theirs === ancestor) return { merged: ours, conflicts: [] };
  if (ours === ancestor) return { merged: theirs, conflicts: [] };
  const body = (text: string): string[] => (text === "" ? [] : [text.replace(/\n$/, "")]);
  const merged = [OURS_MARKER, ...body(ours), SPLIT_MARKER, ...body(theirs), THEIRS_MARKER].join("\n") + "\n";
  return { merged, conflicts: [`state.yaml (${reason})`] };
}

// ── Specs ────────────────────────────────────────────────────────

/**
 * The spec (`specHash` input) of every product node stored directly in
 * `folderDir`: the folder's `index.md` and its leaf `.md` files. Capabilities
 * hash statement and criteria, constraints their statement. Files that are not
 * valid product-node intent are skipped; a missing folder yields an empty map.
 */
export async function readFolderSpecs(folderDir: string): Promise<Map<string, ProductSpec>> {
  const specs = new Map<string, ProductSpec>();
  let names: string[];
  try {
    names = (await readdir(folderDir, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return specs;
    throw err;
  }
  const warnings: ParseWarning[] = [];
  for (const name of names) {
    const path = join(folderDir, name);
    const fm = parseFrontmatter(await readFile(path, "utf-8"), path, warnings);
    const intent = fm ? NodeIntentSchema.safeParse(fm) : undefined;
    if (!intent?.success) continue;
    const node = intent.data;
    if (node.type === "capability") specs.set(node.id, { statement: node.statement, criteria: node.criteria });
    else if (node.type === "constraint") specs.set(node.id, { statement: node.statement });
  }
  return specs;
}
