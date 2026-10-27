/**
 * Data loader for sourcevision viewer.
 * Fetches and validates .sourcevision/ JSON files.
 * Supports both server mode (fetch from /data/) and file drop mode.
 *
 * Memory-efficient strategies:
 * - loadModules(): lazy-load data files on demand in parallel
 * - Selective refresh: only reload files whose mtime changed
 */

import type { Manifest, Inventory, Imports, Zones, Components, CallGraph } from "../external.js";
import { DATA_FILES } from "../external.js";
import {
  validate,
  ManifestSchema,
  InventorySchema,
  ImportsSchema,
  ZonesSchema,
  ComponentsSchema,
  CallGraphSchema,
} from "./schema/validate.js";
import { migrateData } from "./schema/compat.js";
import type { LoadedData } from "../types.js";
import { registerPoller, unregisterPoller } from "../polling/index.js";

type DataChangeHandler = (data: LoadedData) => void;

/** Module definition for lazy loading. */
interface ModuleDef {
  key: keyof LoadedData;
  file: string;
  validate: (d: unknown) => { ok: boolean; data?: unknown };
}

const MODULE_DEFS: ModuleDef[] = [
  { key: "manifest", file: DATA_FILES.manifest, validate: (data) => validate(ManifestSchema, data) },
  { key: "inventory", file: DATA_FILES.inventory, validate: (data) => validate(InventorySchema, data) },
  { key: "imports", file: DATA_FILES.imports, validate: (data) => validate(ImportsSchema, data) },
  { key: "zones", file: DATA_FILES.zones, validate: (data) => validate(ZonesSchema, data) },
  { key: "components", file: DATA_FILES.components, validate: (data) => validate(ComponentsSchema, data) },
  { key: "callGraph", file: DATA_FILES.callGraph, validate: (data) => validate(CallGraphSchema, data) },
];

/** Map from data filename to its module key, for selective refresh. */
const FILE_TO_KEY: Record<string, keyof LoadedData> = {};
for (const mod of MODULE_DEFS) {
  FILE_TO_KEY[mod.file] = mod.key;
}

let currentData: LoadedData = {
  manifest: null,
  inventory: null,
  imports: null,
  zones: null,
  components: null,
  callGraph: null,
};

let onChange: DataChangeHandler | null = null;
let pollingActive = false;
let lastMtimes: Record<string, number> = {};

export function getData(): LoadedData {
  return currentData;
}

export function onDataChange(handler: DataChangeHandler): void {
  onChange = handler;
}

/** Remove the current data-change handler (for cleanup on unmount). */
export function clearOnChange(): void {
  onChange = null;
}

function notifyChange(): void {
  if (onChange) onChange(currentData);
}

/** Fetch, validate, and store a single module. Returns true on success. */
async function fetchModule(mod: ModuleDef): Promise<boolean> {
  try {
    const res = await fetch(`/data/${mod.file}`);
    if (!res.ok) return false;
    const raw = await res.json();
    const migrated = migrateData(mod.key, raw);
    const result = mod.validate(migrated);
    if (result.ok) {
      (currentData as unknown as Record<string, unknown>)[mod.key] = result.data;
      return true;
    }
    console.warn(`Validation failed for ${mod.file}:`, result);
    return false;
  } catch {
    return false;
  }
}

/**
 * Lazy-load multiple modules in parallel. Only fetches modules that
 * are not already loaded. Returns the current data state.
 */
export async function loadModules(keys: Array<keyof LoadedData>): Promise<LoadedData> {
  const toLoad = keys
    .filter((key) => currentData[key] === null)
    .map((key) => MODULE_DEFS.find((m) => m.key === key))
    .filter((mod): mod is ModuleDef => mod !== undefined);

  if (toLoad.length > 0) {
    await Promise.allSettled(toLoad.map((mod) => fetchModule(mod)));
    notifyChange();
  }
  return currentData;
}

/** Load data from dropped files */
export async function loadFromFiles(files: FileList): Promise<LoadedData> {
  const fileMap = new Map<string, File>();
  for (const f of files) {
    fileMap.set(f.name, f);
  }

  for (const mod of MODULE_DEFS) {
    const file = fileMap.get(mod.file);
    if (!file) continue;

    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const migrated = migrateData(mod.key, raw);
      const result = mod.validate(migrated);
      if (result.ok) {
        (currentData as unknown as Record<string, unknown>)[mod.key] = result.data;
      } else {
        console.warn(`Validation failed for ${mod.file}:`, result);
      }
    } catch (err) {
      console.warn(`Failed to parse ${mod.file}:`, err);
    }
  }

  notifyChange();
  return currentData;
}

/**
 * What the first `GET /data` said about where this page is running.
 *
 * - `server`: a dashboard server answered; load from it.
 * - `static`: nothing serves `/data` here (a `file://` open, or a plain
 *   static host without the export's fetch adapter) — offer file drop.
 * - `unavailable`: a server answered but would not serve the dashboard. The
 *   hub says 503 while a project has no running server and 502 while the
 *   child is unreachable, so a tab opened while `ndx start` is still bringing
 *   the project up lands here; 401 is a missing or rotated token, 421 a
 *   wrong Host, 409 the hub root with several projects. `status` 0 means
 *   the request itself failed on an http(s) page — the server is gone.
 *   Offering file drop for any of these sends the reader to copy files the
 *   server already has.
 */
export type ServerProbe =
  | { mode: "server" }
  | { mode: "static" }
  | { mode: "unavailable"; status: number; detail: string | null };

export interface ServerProbeOptions {
  fetchFn?: typeof fetch;
  /** Pauses between attempts, in ms; attempts = length + 1. `[]` probes once. */
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  /**
   * Whether a request that throws may succeed shortly (an http page whose
   * server is restarting) or never will (a `file://` page). Defaults from
   * `location.protocol`.
   */
  retryNetworkErrors?: boolean;
}

/** About ten seconds in total: long enough for `ndx start` to bring the project server up. */
export const SERVER_PROBE_DELAYS_MS: readonly number[] = [500, 1000, 2000, 3000, 3500];

/**
 * Classify one `/data` status. `retry` says the same request stands a chance
 * of succeeding a moment later, so the probe should wait and ask again.
 */
export function classifyProbeStatus(status: number): { result: ServerProbe; retry: boolean } {
  if (status >= 200 && status < 300) return { result: { mode: "server" }, retry: false };
  if (status === 404) return { result: { mode: "static" }, retry: false };
  const result: ServerProbe = { mode: "unavailable", status, detail: null };
  // Gateway answers: the hub is up, the project server is not (yet).
  const retry = status === 502 || status === 503 || status === 504 || (status >= 500 && status < 600);
  return { result, retry };
}

/** The `error` (and `hint`) a JSON refusal carries, or null. */
async function readErrorDetail(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown; hint?: unknown } | null;
    if (!body || typeof body !== "object") return null;
    const parts = [body.error, body.hint].filter((p): p is string => typeof p === "string" && p.length > 0);
    return parts.length > 0 ? parts.join(" ") : null;
  } catch {
    return null;
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask `/data` where this page is running, retrying while the answer may
 * still change. A one-shot probe locked a tab into file-drop mode whenever
 * the hub answered 503 during startup; this one keeps asking for about ten
 * seconds, and reports a refusal as a refusal.
 */
export async function probeServer(options: ServerProbeOptions = {}): Promise<ServerProbe> {
  const fetchFn = options.fetchFn ?? fetch;
  const delays = options.delaysMs ?? SERVER_PROBE_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  const retryNetworkErrors = options.retryNetworkErrors
    ?? (typeof location !== "undefined" && location.protocol.startsWith("http"));

  let last: ServerProbe = { mode: "static" };
  for (let attempt = 0; ; attempt++) {
    let retry = false;
    try {
      const res = await fetchFn("/data");
      const classified = classifyProbeStatus(res.status);
      last = classified.result.mode === "unavailable"
        ? { ...classified.result, detail: await readErrorDetail(res) }
        : classified.result;
      retry = classified.retry;
    } catch (err) {
      last = retryNetworkErrors
        ? { mode: "unavailable", status: 0, detail: err instanceof Error ? err.message : null }
        : { mode: "static" };
      retry = retryNetworkErrors;
    }
    if (!retry || attempt >= delays.length) return last;
    await sleep(delays[attempt]!);
  }
}

/** Check if we're running in server mode. Prefer {@link probeServer}, which says why not. */
export async function detectMode(): Promise<"server" | "static"> {
  return (await probeServer()).mode === "server" ? "server" : "static";
}

/**
 * Selectively reload only the data files whose mtime has changed.
 * More memory-efficient than reloading all files on every change.
 */
async function refreshChangedModules(newMtimes: Record<string, number>): Promise<void> {
  const changedKeys: Array<keyof LoadedData> = [];

  for (const [file, mtime] of Object.entries(newMtimes)) {
    if (lastMtimes[file] !== mtime) {
      const key = FILE_TO_KEY[file];
      if (key) {
        changedKeys.push(key);
      }
    }
  }

  if (changedKeys.length === 0) return;

  lastMtimes = newMtimes;

  // Only fetch the modules that actually changed
  const toLoad = changedKeys
    .map((key) => MODULE_DEFS.find((m) => m.key === key))
    .filter((mod): mod is ModuleDef => mod !== undefined);

  if (toLoad.length > 0) {
    await Promise.allSettled(toLoad.map((mod) => fetchModule(mod)));
    notifyChange();
  }
}

/** The polling callback, extracted for registration with the polling manager. */
async function pollForChanges(): Promise<void> {
  try {
    const res = await fetch("/data/status");
    if (!res.ok) return;
    const status: { mtimes: Record<string, number> } = await res.json();

    // Check if any file changed
    let changed = false;
    for (const [file, mtime] of Object.entries(status.mtimes)) {
      if (lastMtimes[file] !== mtime) {
        changed = true;
        break;
      }
    }

    if (changed) {
      await refreshChangedModules(status.mtimes);
    }
  } catch {
    // Server may be down — ignore
  }
}

/**
 * Start polling for data changes (selective refresh — only changed files).
 * Registers with the centralized polling manager for automatic
 * suspend/resume based on tab visibility.
 */
export function startPolling(intervalMs: number = 5000): void {
  if (pollingActive) return;
  pollingActive = true;
  registerPoller("loader:data-status", pollForChanges, intervalMs);
}

/**
 * Stop polling for data changes.
 * Unregisters from the centralized polling manager.
 */
export function stopPolling(): void {
  if (!pollingActive) return;
  pollingActive = false;
  unregisterPoller("loader:data-status");
}
