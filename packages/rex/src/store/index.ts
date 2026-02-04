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
