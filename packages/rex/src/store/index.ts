export type { PRDStore, StoreCapabilities } from "./types.js";
export { FileStore, ensureRexDir } from "./file-adapter.js";
export { NotionStore, ensureNotionRexDir } from "./notion-adapter.js";
export type { NotionClient, NotionAdapterConfig } from "./notion-client.js";
export { LiveNotionClient } from "./notion-client.js";
export { SyncEngine } from "../core/sync-engine.js";
export type { SyncDirection, SyncReport, SyncOptions } from "../core/sync-engine.js";

import { FileStore } from "./file-adapter.js";
import { NotionStore } from "./notion-adapter.js";
import { LiveNotionClient } from "./notion-client.js";
import type { PRDStore } from "./types.js";
import type { NotionAdapterConfig } from "./notion-client.js";

export function createStore(adapter: string, rexDir: string): PRDStore {
  switch (adapter) {
    case "file":
      return new FileStore(rexDir);
    default:
      throw new Error(
        `Unknown adapter "${adapter}". Available adapters: file, notion`,
      );
  }
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
