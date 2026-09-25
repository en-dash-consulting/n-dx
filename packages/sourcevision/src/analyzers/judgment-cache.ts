/**
 * Content-addressed cache for Jev answers.
 *
 * A judgment is a pure function of (question, the state it looks at, model):
 * ask the same thing about the same evidence and the answer is the same. That
 * makes re-runs of `sv analyze` mostly re-asking questions already answered —
 * the file classifications, the grades of findings that did not change — so
 * `askJev` consults this cache per question, sends only the misses, and
 * stores what comes back.
 *
 * ## Keys
 *
 * A request carries one shared `state` for many questions, and most questions
 * look at one slice of it (`files.f3`, `zones.web-viewer`). Keying on the
 * whole state would make one changed file invalidate every question in the
 * batch, so the key is built from the question plus only the state subtrees
 * its backticked paths name. A question that names no resolvable path is
 * keyed on the whole state.
 *
 * ## Storage
 *
 * `.sourcevision/.cache/judgments.json`, machine-local, bounded by
 * {@link JUDGMENT_CACHE_MAX_ENTRIES} (oldest dropped), written atomically.
 * Safe to delete; the next run simply re-asks.
 *
 * @module sourcevision/analyzers/judgment-cache
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JevAnswer, JevQuestion, JsonValue } from "./jev-client.js";

export const JUDGMENT_CACHE_FILE = "judgments.json";
export const JUDGMENT_CACHE_MAX_ENTRIES = 20_000;
const CACHE_VERSION = 1;

interface CacheEntry {
  answer: JevAnswer;
  model: string;
  /** Epoch ms; eviction order. */
  at: number;
}

interface CacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

let _path: string | undefined;
let _entries: Record<string, CacheEntry> | undefined;

/**
 * Point the cache at a `.sourcevision` directory. Until this is called (the
 * CLI does it beside `setProjectDir`) the cache is inert and every question
 * is a miss that is not stored — library callers and tests see no files.
 */
export function configureJudgmentCache(opts: { svDir: string } | undefined): void {
  _path = opts ? join(opts.svDir, ".cache", JUDGMENT_CACHE_FILE) : undefined;
  _entries = undefined;
}

export function isJudgmentCacheConfigured(): boolean {
  return _path !== undefined;
}

function load(): Record<string, CacheEntry> {
  if (_entries) return _entries;
  _entries = {};
  if (_path && existsSync(_path)) {
    try {
      const parsed = JSON.parse(readFileSync(_path, "utf-8")) as CacheFile;
      if (parsed.version === CACHE_VERSION && parsed.entries && typeof parsed.entries === "object") {
        _entries = parsed.entries;
      }
    } catch {
      // A corrupt cache is a cache miss, not a failure.
    }
  }
  return _entries;
}

function persist(): void {
  if (!_path || !_entries) return;
  const keys = Object.keys(_entries);
  if (keys.length > JUDGMENT_CACHE_MAX_ENTRIES) {
    keys.sort((a, b) => _entries![a].at - _entries![b].at);
    for (const k of keys.slice(0, keys.length - JUDGMENT_CACHE_MAX_ENTRIES)) delete _entries[k];
  }
  const file: CacheFile = { version: CACHE_VERSION, entries: _entries };
  try {
    mkdirSync(dirname(_path), { recursive: true });
    const tmp = `${_path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(file));
    renameSync(tmp, _path);
  } catch {
    // Never fail an analysis for its cache.
  }
}

// ── Keys ─────────────────────────────────────────────────────────────────────

/** Deterministic JSON: object keys sorted at every level. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/** Backticked state paths in a question's instructions, e.g. `files.f3`. */
export function referencedPaths(question: JevQuestion): string[] {
  const out: string[] = [];
  for (const m of question.instructions.matchAll(/`([A-Za-z0-9_$][A-Za-z0-9_$.\-\[\]]*)`/g)) out.push(m[1]);
  return out;
}

/** Resolve `a.b[0].c` against a JSON value; undefined when any step is missing. */
export function resolvePath(state: JsonValue, path: string): JsonValue | undefined {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: JsonValue | undefined = state;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) ? cur[Number(part)] : (cur as Record<string, JsonValue>)[part];
  }
  return cur;
}

/**
 * The cache key for one question: the question, the model, and the slices of
 * state it references — or the whole state when it references none.
 */
export function judgmentKey(state: JsonValue, question: JevQuestion, model: string): string {
  const slices: Record<string, JsonValue> = {};
  let resolved = 0;
  for (const p of referencedPaths(question)) {
    const v = resolvePath(state, p);
    if (v !== undefined) {
      slices[p] = v;
      resolved++;
    }
  }
  const payload = canonicalJSON({ model, question, state: resolved > 0 ? slices : state });
  return createHash("sha256").update(payload).digest("hex");
}

// ── Lookup ───────────────────────────────────────────────────────────────────

export interface CacheLookup {
  /** Answers found, by question id. */
  hits: Record<string, JevAnswer>;
  /** Questions still to ask. */
  misses: Record<string, JevQuestion>;
  /** Key per question id, for {@link storeJudgments}. */
  keys: Record<string, string>;
  /** Model recorded on the newest hit; the response's model when nothing was fetched. */
  model?: string;
}

export function lookupJudgments(
  state: JsonValue,
  questions: Record<string, JevQuestion>,
  model: string,
): CacheLookup {
  const result: CacheLookup = { hits: {}, misses: {}, keys: {} };
  if (!_path) {
    result.misses = { ...questions };
    return result;
  }
  const entries = load();
  let newest = 0;
  for (const [id, q] of Object.entries(questions)) {
    const key = judgmentKey(state, q, model);
    result.keys[id] = key;
    const hit = entries[key];
    if (hit && hit.answer.type === q.type) {
      result.hits[id] = hit.answer;
      if (hit.at > newest) {
        newest = hit.at;
        result.model = hit.model;
      }
    } else {
      result.misses[id] = q;
    }
  }
  return result;
}

/** Store fetched answers under the keys from {@link lookupJudgments} and persist. */
export function storeJudgments(
  keys: Record<string, string>,
  answers: Record<string, JevAnswer>,
  model: string,
): void {
  if (!_path) return;
  const entries = load();
  const at = Date.now();
  let stored = 0;
  for (const [id, answer] of Object.entries(answers)) {
    const key = keys[id];
    if (!key) continue;
    entries[key] = { answer, model, at };
    stored++;
  }
  if (stored > 0) persist();
}
