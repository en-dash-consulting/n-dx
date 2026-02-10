/**
 * Data loader for sourcevision viewer.
 * Fetches and validates .sourcevision/ JSON files.
 * Supports both server mode (fetch from /data/) and file drop mode.
 */

import type { Manifest, Inventory, Imports, Zones, Components } from "../schema/v1.js";
import {
  validateManifest,
  validateInventory,
  validateImports,
  validateZones,
  validateComponents,
} from "../schema/validate.js";
import { DATA_FILES } from "../schema/data-files.js";
import { migrateData } from "./schema-compat.js";
import type { LoadedData } from "./types.js";

type DataChangeHandler = (data: LoadedData) => void;

let currentData: LoadedData = {
  manifest: null,
  inventory: null,
  imports: null,
  zones: null,
  components: null,
};

let onChange: DataChangeHandler | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastMtimes: Record<string, number> = {};

export function getData(): LoadedData {
  return currentData;
}

export function onDataChange(handler: DataChangeHandler): void {
  onChange = handler;
}

function notifyChange(): void {
  if (onChange) onChange(currentData);
}

/** Load data from the local dev server */
export async function loadFromServer(): Promise<LoadedData> {
  const modules: Array<{
    key: keyof LoadedData;
    file: string;
    validate: (d: unknown) => { ok: boolean; data?: unknown };
  }> = [
    { key: "manifest", file: DATA_FILES.manifest, validate: validateManifest },
    { key: "inventory", file: DATA_FILES.inventory, validate: validateInventory },
    { key: "imports", file: DATA_FILES.imports, validate: validateImports },
    { key: "zones", file: DATA_FILES.zones, validate: validateZones },
    { key: "components", file: DATA_FILES.components, validate: validateComponents },
  ];

  const results = await Promise.allSettled(
    modules.map(async (mod) => {
      const res = await fetch(`/data/${mod.file}`);
      if (!res.ok) return null;
      const raw = await res.json();
      const migrated = migrateData(mod.key, raw);
      const result = mod.validate(migrated);
      if (result.ok) {
        return { key: mod.key, data: result.data };
      }
      console.warn(`Validation failed for ${mod.file}:`, result);
      return null;
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      (currentData as unknown as Record<string, unknown>)[r.value.key] = r.value.data;
    }
  }

  notifyChange();
  return currentData;
}

/** Load data from dropped files */
export async function loadFromFiles(files: FileList): Promise<LoadedData> {
  const fileMap = new Map<string, File>();
  for (const f of files) {
    fileMap.set(f.name, f);
  }

  const modules: Array<{
    key: keyof LoadedData;
    file: string;
    validate: (d: unknown) => { ok: boolean; data?: unknown };
  }> = [
    { key: "manifest", file: DATA_FILES.manifest, validate: validateManifest },
    { key: "inventory", file: DATA_FILES.inventory, validate: validateInventory },
    { key: "imports", file: DATA_FILES.imports, validate: validateImports },
    { key: "zones", file: DATA_FILES.zones, validate: validateZones },
    { key: "components", file: DATA_FILES.components, validate: validateComponents },
  ];

  for (const mod of modules) {
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

/** Start polling for data changes */
export function startPolling(intervalMs: number = 5000): void {
  if (pollTimer) return;

  pollTimer = setInterval(async () => {
    try {
      const res = await fetch("/data/status");
      if (!res.ok) return;
      const status: { mtimes: Record<string, number> } = await res.json();

      // Compare mtimes
      let changed = false;
      for (const [file, mtime] of Object.entries(status.mtimes)) {
        if (lastMtimes[file] !== mtime) {
          changed = true;
          break;
        }
      }

      if (changed) {
        lastMtimes = status.mtimes;
        await loadFromServer();
      }
    } catch {
      // Server may be down — ignore
    }
  }, intervalMs);
}

/** Stop polling for data changes */
export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
