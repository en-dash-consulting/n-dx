/**
 * Data loader for sourcevision viewer.
 * Fetches and validates .sourcevision/ JSON files.
 * Supports both server mode (fetch from /data/) and file drop mode.
 *
 * Memory-efficient strategies:
 * - loadModules(): lazy-load data files on demand in parallel
 * - Selective refresh: only reload files whose mtime changed
 */

import type { Manifest, Inventory, Imports, Zones, Components, CallGraph } from "./external.js";
import {
  validateManifest,
  validateInventory,
  validateImports,
  validateZones,
  validateComponents,
  validateCallGraph,
} from "./validate.js";
import { DATA_FILES } from "./external.js";
import { migrateData } from "./schema-compat.js";
import type { LoadedData } from "./types.js";
import { registerPoller, unregisterPoller } from "./polling/polling-manager.js";

type DataChangeHandler = (data: LoadedData) => void;

/** Module definition for lazy loading. */
interface ModuleDef {
  key: keyof LoadedData;
  file: string;
  validate: (d: unknown) => { ok: boolean; data?: unknown };
}

const MODULE_DEFS: ModuleDef[] = [
  { key: "manifest", file: DATA_FILES.manifest, validate: validateManifest },
  { key: "inventory", file: DATA_FILES.inventory, validate: validateInventory },
  { key: "imports", file: DATA_FILES.imports, validate: validateImports },
  { key: "zones", file: DATA_FILES.zones, validate: validateZones },
  { key: "components", file: DATA_FILES.components, validate: validateComponents },
  { key: "callGraph", file: DATA_FILES.callGraph, validate: validateCallGraph },
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

/** Check if we're running in server mode */
export async function detectMode(): Promise<"server" | "static"> {
  try {
    const res = await fetch("/data");
    if (res.ok) return "server";
  } catch {
    // Not in server mode
  }
  return "static";
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

/** Stop polling for data changes */
export function stopPolling(): void {
  if (!pollingActive) return;
  pollingActive = false;
  unregisterPoller("loader:data-status");
}
