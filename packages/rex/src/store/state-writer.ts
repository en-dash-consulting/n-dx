/**
 * The single reader and writer of per-folder `state.yaml` (rex schema v2).
 *
 * Each folder in the v2 tree commits one `state.yaml` holding tool-written
 * state for the folder item and its leaf files, keyed by item id (see
 * `StateFile` and `ItemState` in `schema/v2.ts`). Every state write goes
 * through {@link saveStateFile}, so the file's format and the `revisedAt`
 * rule live in one place.
 *
 * ## File contract
 *
 * ```yaml
 * schema: "rex/v2"
 * items:
 *   "<item id>":
 *     status: "completed"
 *     checks: [{"at":"…","requirementId":"r1","result":"pass"}]
 * ```
 *
 * - Three fixed indents: top-level keys at 0, item ids at 2, fields at 4.
 * - Every value fits on its line: a JSON value (valid YAML flow), a
 *   single-quoted scalar, or a plain scalar (read as a string). Block
 *   scalars, block collections, anchors and tags are refused, so any
 *   1.x reader can delimit every key it does not know.
 * - Written output is canonical: `schema`, then `items` sorted by id, then
 *   other top-level keys by name; within a row, known fields in `ItemState`
 *   order, then other fields by name; values as compact JSON with object keys
 *   sorted; LF line endings and a final newline. Empty rows are dropped (an
 *   absent row reads as `pending` with no stamps). Output depends on content
 *   alone, never on insertion order.
 * - Keys this build does not know keep their original line byte for byte
 *   while their value is unchanged, so an older install never rewrites or
 *   drops a field a newer one added. Comments and blank lines are not kept.
 *
 * ## Locking
 *
 * {@link saveStateFile} refuses to run outside the PRD lock for its `rexDir`
 * (`store.withTransaction` holds it). Loading needs no lock, but a
 * read-modify-write must load inside the same transaction it saves in.
 *
 * @module rex/store/state-writer
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ItemStateSchema, SCHEMA_VERSION_V2, StateFileSchema, type Criterion, type StateFile } from "../schema/v2.js";
import { specHash } from "../schema/v2-rules.js";
import { atomicWrite } from "./atomic-write.js";
import { isLockHeld } from "./file-lock.js";
import { prdLockPath } from "./paths.js";

export const STATE_FILE_NAME = "state.yaml";

/** The spec text `metAt` hashes: statement and criteria (constraints pass only a statement). */
export type ProductSpec = { statement?: string; criteria?: Criterion[] };

export interface SaveStateOptions {
  /** The workspace's `.rex` directory; its PRD lock must be held. */
  rexDir: string;
  /**
   * Current spec of every product node this write must reconcile
   * `revisedAt` for, by id. Required so a writer states which nodes it
   * vouches for; change-layer folders pass an empty map.
   */
  specs: ReadonlyMap<string, ProductSpec>;
  /** Clock for `revisedAt` stamps. */
  now?: () => Date;
}

/** Known row fields in `ItemState` declaration order: the order they are written in. */
const KNOWN_ROW_KEYS: readonly string[] = Object.keys(ItemStateSchema.shape);
const KNOWN_ROW_KEY_SET: ReadonlySet<string> = new Set(KNOWN_ROW_KEYS);
const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set(["schema", "items"]);

const ROW_INDENT = "  ";
const FIELD_INDENT = "    ";

/** One unknown key as read: its line (after indentation) and the value it parsed to. */
interface RawEntry {
  line: string;
  value: unknown;
}

/** Unknown keys of a parsed file, by row id (`null` for top-level keys). */
type RawIndex = Map<string | null, Map<string, RawEntry>>;

/** Original lines of each parsed file's unknown keys, consulted when that file object is serialized. */
const rawLines = new WeakMap<StateFile, RawIndex>();

export function stateFilePath(folderDir: string): string {
  return join(folderDir, STATE_FILE_NAME);
}

export function emptyStateFile(): StateFile {
  return { schema: SCHEMA_VERSION_V2, items: {} };
}

export interface ParseStateOptions {
  /**
   * Accept any `schema` stamp, for read-only inspection of a tree from a
   * newer major. Rows are still validated; the stamp is kept as read, so
   * {@link saveStateFile} still refuses the file.
   */
  ignoreSchemaStamp?: boolean;
}

/** Read a folder's `state.yaml`; a missing file reads as empty. */
export async function loadStateFile(folderDir: string, options: ParseStateOptions = {}): Promise<StateFile> {
  const path = stateFilePath(folderDir);
  const text = await readIfExists(path);
  return text === null ? emptyStateFile() : parseStateYaml(text, path, options);
}

/**
 * Write a folder's `state.yaml` under the PRD lock. Reconciles `revisedAt`
 * for every node in `options.specs` first (mutating `file`), validates, and
 * skips the write when the bytes on disk already match. Returns whether the
 * file was written.
 */
export async function saveStateFile(folderDir: string, file: StateFile, options: SaveStateOptions): Promise<boolean> {
  if (!isLockHeld(prdLockPath(options.rexDir))) {
    throw new Error(
      `${STATE_FILE_NAME} writes must run inside store.withTransaction: the PRD lock for ${options.rexDir} is not held`,
    );
  }
  const path = stateFilePath(folderDir);
  reconcileRevisedAt(file, options.specs, (options.now ?? (() => new Date()))());
  assertValid(file, path);
  const text = serializeStateYaml(file);
  if ((await readIfExists(path)) === text) return false;
  await atomicWrite(path, text);
  return true;
}

/**
 * Apply the `ItemState.revisedAt` rule to each node in `specs`: stamp it when
 * the spec first hashes differently from `metAt`, keep an existing stamp
 * while it still differs, and clear it once the hash equals `metAt` again (a
 * re-stamp or a revert) or when the node was never met.
 */
function reconcileRevisedAt(file: StateFile, specs: ReadonlyMap<string, ProductSpec>, now: Date): void {
  for (const [id, spec] of specs) {
    const row = file.items[id];
    if (!row) continue;
    if (!row.metAt || specHash(spec) === row.metAt) delete row.revisedAt;
    else row.revisedAt ??= now.toISOString();
  }
}

// ── Parse ────────────────────────────────────────────────────────────

/** Parse and validate `state.yaml` text. `source` names the file in errors. */
export function parseStateYaml(text: string, source: string = STATE_FILE_NAME, options: ParseStateOptions = {}): StateFile {
  const file: Record<string, unknown> = {};
  const items: Record<string, Record<string, unknown>> = {};
  const raw: RawIndex = new Map();
  let inItems = false;
  let row: Record<string, unknown> | null = null;
  let rowId: string | null = null;

  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const where = `${source}:${index + 1}`;
    const indent = line.length - line.trimStart().length;
    const body = line.slice(indent);
    if (line.slice(0, indent).includes("\t")) throw new Error(`${where}: tabs are not allowed in indentation`);
    const { key, value } = splitKeyLine(body, where);

    if (indent === 0) {
      if (Object.hasOwn(file, key)) throw new Error(`${where}: duplicate key "${key}"`);
      row = null;
      inItems = key === "items";
      if (inItems) {
        if (value !== "" && value !== "{}") throw new Error(`${where}: "items" must be a mapping of item ids`);
        file.items = items;
        return;
      }
      file[key] = parseValue(value, where);
      if (!KNOWN_TOP_KEYS.has(key)) entriesFor(raw, null).set(key, { line: body, value: file[key] });
    } else if (indent === ROW_INDENT.length && inItems) {
      if (value !== "" && value !== "{}") throw new Error(`${where}: item "${key}" must be a mapping of fields`);
      if (Object.hasOwn(items, key)) throw new Error(`${where}: duplicate item "${key}"`);
      row = items[key] = {};
      rowId = key;
    } else if (indent === FIELD_INDENT.length && row) {
      if (Object.hasOwn(row, key)) throw new Error(`${where}: duplicate field "${key}"`);
      row[key] = parseValue(value, where);
      if (!KNOWN_ROW_KEY_SET.has(key)) entriesFor(raw, rowId).set(key, { line: body, value: row[key] });
    } else {
      throw new Error(`${where}: unexpected indentation (expected ${inItems ? "2 for an item id or 4 for a field" : "0"})`);
    }
  });

  file.items ??= items;
  const parsed = file as StateFile;
  assertValid(options.ignoreSchemaStamp ? { ...parsed, schema: SCHEMA_VERSION_V2 } : parsed, source);
  rawLines.set(parsed, raw);
  return parsed;
}

function entriesFor(raw: RawIndex, rowId: string | null): Map<string, RawEntry> {
  let entries = raw.get(rowId);
  if (!entries) raw.set(rowId, (entries = new Map()));
  return entries;
}

const QUOTED_KEY = /^("(?:[^"\\]|\\.)*")\s*:(?:\s+(.*))?$/;
const PLAIN_KEY = /^([^\s"'#:][^:]*?)\s*:(?:\s+(.*))?$/;

function splitKeyLine(body: string, where: string): { key: string; value: string } {
  const quoted = QUOTED_KEY.exec(body);
  if (quoted) return { key: JSON.parse(quoted[1]) as string, value: (quoted[2] ?? "").trim() };
  const plain = PLAIN_KEY.exec(body);
  if (plain) return { key: plain[1], value: (plain[2] ?? "").trim() };
  throw new Error(`${where}: expected "key: value"`);
}

/** Leading characters of YAML constructs that would span lines or need a full YAML parser. */
const UNSUPPORTED_VALUE = /^(?:[|>&*!%@`]|-(?:\s|$))/;

function parseValue(text: string, where: string): unknown {
  if (text === "") throw new Error(`${where}: missing value (block collections are not supported; write the value as JSON)`);
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: a single-quoted or plain YAML scalar, checked below.
  }
  const single = /^'((?:[^']|'')*)'$/.exec(text);
  if (single) return single[1].replace(/''/g, "'");
  if (/^["'[{]/.test(text) || UNSUPPORTED_VALUE.test(text)) {
    throw new Error(`${where}: unsupported or malformed value ${JSON.stringify(text)}; write the value as one line of JSON`);
  }
  return text;
}

// ── Serialize ────────────────────────────────────────────────────────

/** Canonical `state.yaml` text for `file` (see the module's file contract). */
export function serializeStateYaml(file: StateFile): string {
  const raw = rawLines.get(file);
  const lines: string[] = [];
  if (file.schema !== undefined) lines.push(`schema: ${canonicalJson(file.schema)}`);

  const rows = Object.keys(file.items)
    .sort()
    .map((id) => ({ id, fields: rowLines(file.items[id], raw?.get(id)) }))
    .filter(({ fields }) => fields.length > 0);
  if (rows.length === 0) lines.push("items: {}");
  else {
    lines.push("items:");
    for (const { id, fields } of rows) lines.push(`${ROW_INDENT}${JSON.stringify(id)}:`, ...fields);
  }

  const topRaw = raw?.get(null);
  for (const key of Object.keys(file).filter((k) => !KNOWN_TOP_KEYS.has(k)).sort()) {
    const line = keyLine(key, file[key], topRaw);
    if (line !== null) lines.push(line);
  }
  return lines.join("\n") + "\n";
}

function rowLines(row: Record<string, unknown>, raw: Map<string, RawEntry> | undefined): string[] {
  const unknown = Object.keys(row).filter((k) => !KNOWN_ROW_KEY_SET.has(k)).sort();
  return [...KNOWN_ROW_KEYS, ...unknown]
    .map((key) => keyLine(key, row[key], raw))
    .filter((line): line is string => line !== null)
    .map((line) => FIELD_INDENT + line);
}

/** One `key: value` line: the original line for an unchanged unknown key, else canonical. */
function keyLine(key: string, value: unknown, raw: Map<string, RawEntry> | undefined): string | null {
  if (value === undefined) return null;
  const json = canonicalJson(value);
  const original = raw?.get(key);
  if (original && canonicalJson(original.value) === json) return original.line;
  return `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key)}: ${json}`;
}

/** Compact JSON with every object's keys sorted. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

// ── Shared ───────────────────────────────────────────────────────────

function assertValid(file: StateFile, source: string): void {
  const result = StateFileSchema.safeParse(file);
  if (result.success) return;
  const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  throw new Error(`${source}: invalid ${STATE_FILE_NAME}: ${issues}`);
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
