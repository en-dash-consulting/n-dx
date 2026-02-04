export type { PRDStore, StoreCapabilities } from "./types.js";
export { FileStore, ensureRexDir } from "./file-adapter.js";
export { NotionStore, ensureNotionRexDir } from "./notion-adapter.js";
export type { NotionClient, NotionAdapterConfig } from "./notion-client.js";
export { LiveNotionClient } from "./notion-client.js";
export { SyncEngine } from "../core/sync-engine.js";
export type { SyncDirection, SyncReport, SyncOptions } from "../core/sync-engine.js";
export {
  AdapterRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
} from "./adapter-registry.js";
export type {
  AdapterDefinition,
  AdapterFactory,
  AdapterConfig,
  AdapterConfigField,
  AdapterInfo,
} from "./adapter-registry.js";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FileStore } from "./file-adapter.js";
import { NotionStore } from "./notion-adapter.js";
import { LiveNotionClient } from "./notion-client.js";
import { getDefaultRegistry } from "./adapter-registry.js";
import type { PRDStore } from "./types.js";
import type { NotionAdapterConfig } from "./notion-client.js";

/**
 * Create a PRDStore for the given adapter name.
 *
 * Uses the default {@link AdapterRegistry} to resolve the adapter.
 * For adapters that require configuration (e.g. Notion), pass additional
 * config via `createStoreWithConfig` or use the registry directly.
 */
export function createStore(adapter: string, rexDir: string): PRDStore {
  return getDefaultRegistry().create(adapter, rexDir, {});
}

/**
 * Create a PRDStore with explicit adapter configuration.
 *
 * Validates config against the adapter's schema before creating the store.
 */
export function createStoreWithConfig(
  adapter: string,
  rexDir: string,
  config: Record<string, unknown>,
): PRDStore {
  return getDefaultRegistry().create(adapter, rexDir, config);
}

/**
 * Create a Notion-backed store.
 *
 * Requires a NotionAdapterConfig with token and databaseId.
 * The rexDir is still used for config, logs, and workflow files.
 */
export function createNotionStore(
  rexDir: string,
  config: NotionAdapterConfig,
): PRDStore {
  const client = new LiveNotionClient(config.token);
  return new NotionStore(rexDir, client, config);
}

/**
 * Resolve the correct PRDStore for a `.rex/` directory by reading the
 * configured adapter from `config.json`.
 *
 * Resolution order:
 * 1. Read `config.json` → use the `adapter` field (e.g. `"file"`, `"notion"`).
 * 2. For adapters that require config (e.g. Notion), load saved adapter
 *    config from `adapters.json` via the registry.
 * 3. Falls back to the `"file"` adapter if config is missing or unreadable.
 *
 * This is the preferred way to obtain a store in CLI commands and tools.
 * It ensures the user's configured adapter is respected.
 *
 * @param rexDir  Path to the `.rex/` directory.
 * @returns A PRDStore instance for the configured adapter.
 *
 * @example
 * ```ts
 * const store = await resolveStore(join(dir, ".rex"));
 * const doc = await store.loadDocument();
 * ```
 */
export async function resolveStore(rexDir: string): Promise<PRDStore> {
  const registry = getDefaultRegistry();

  let adapterName = "file";
  try {
    const raw = await readFile(join(rexDir, "config.json"), "utf-8");
    const config = JSON.parse(raw);
    if (typeof config.adapter === "string" && config.adapter.length > 0) {
      adapterName = config.adapter;
    }
  } catch {
    // Config missing or unreadable — use default
  }

  // Simple adapters (no required config fields) can be created directly
  const def = registry.get(adapterName);
  if (!def) {
    // Unknown adapter in config — fall back to file
    return new FileStore(rexDir);
  }

  const hasRequiredConfig = Object.values(def.configSchema).some((f) => f.required);
  if (!hasRequiredConfig) {
    return registry.create(adapterName, rexDir, {});
  }

  // Adapter requires config — load from adapters.json
  return registry.createFromConfig(rexDir, adapterName);
}
