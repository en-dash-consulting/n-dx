export type { PRDStore, StoreCapabilities } from "./contracts.js";
export { FileStore, ensureRexDir } from "./file-adapter.js";
export {
  sanitizeBranchName,
  resolveGitBranch,
  getFirstCommitDate,
  generatePRDFilename,
  resolvePRDFilename,
} from "./branch-naming.js";
export {
  discoverPRDFiles,
  parsePRDBranchSegment,
  findPRDFileForBranch,
  resolvePRDFile,
} from "./prd-discovery.js";
export type { PRDFileResolution } from "./prd-discovery.js";
export { withLock, acquireLock } from "./file-lock.js";
export { NotionStore, ensureNotionRexDir } from "./notion-adapter.js";
export type { NotionClient, NotionAdapterConfig } from "./notion-client.js";
export { LiveNotionClient } from "./notion-client.js";
export { SyncEngine } from "../core/sync-engine.js";
export type { SyncDirection, SyncReport, SyncOptions } from "../core/sync-engine.js";
export {
  AdapterRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
  isRedactedField,
} from "./adapter-registry.js";
export type {
  AdapterDefinition,
  AdapterFactory,
  AdapterConfig,
  AdapterConfigField,
  AdapterInfo,
} from "./adapter-registry.js";

// ---- Integration schema system -----------------------------------------------
export {
  validateField,
  validateConfig,
  registerIntegrationSchema,
  getIntegrationSchema,
  listIntegrationSchemas,
  resetIntegrationSchemas,
  toAdapterConfigSchema,
} from "./integration-schema.js";
export type {
  FieldInputType,
  FieldValidationRule,
  FieldSelectOption,
  IntegrationFieldSchema,
  IntegrationSchema,
  IntegrationFieldGroup,
  FieldValidationResult,
} from "./integration-schema.js";
export {
  registerBuiltInSchemas,
  ensureSchemas,
} from "./integration-schemas/index.js";
export { notionIntegrationSchema } from "./integration-schemas/notion.js";
export { jiraIntegrationSchema } from "./integration-schemas/jira.js";

import { FileStore } from "./file-adapter.js";
import { NotionStore } from "./notion-adapter.js";
import { LiveNotionClient } from "./notion-client.js";
import { getDefaultRegistry } from "./adapter-registry.js";
import type { PRDStore } from "./contracts.js";
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
 * Resolve the local PRDStore for a `.rex/` directory.
 *
 * Always returns a FileStore. Remote adapters (e.g. Notion) are accessed
 * only during explicit sync operations via {@link resolveRemoteStore}.
 *
 * This is the preferred way to obtain a store in CLI commands and tools.
 *
 * @param rexDir  Path to the `.rex/` directory.
 * @returns A FileStore instance.
 *
 * @example
 * ```ts
 * const store = await resolveStore(join(dir, ".rex"));
 * const doc = await store.loadDocument();
 * ```
 */
export async function resolveStore(rexDir: string): Promise<PRDStore> {
  return new FileStore(rexDir);
}

/**
 * Resolve a remote PRDStore for sync operations.
 *
 * Reads the adapter configuration from `adapters.json` via the adapter
 * registry. If no adapter name is provided, defaults to `"notion"`.
 *
 * @param rexDir       Path to the `.rex/` directory.
 * @param adapterName  Adapter to resolve (default: `"notion"`).
 * @returns A PRDStore instance for the remote adapter.
 * @throws If the adapter is not configured or unknown.
 */
export async function resolveRemoteStore(
  rexDir: string,
  adapterName: string = "notion",
): Promise<PRDStore> {
  const registry = getDefaultRegistry();
  return registry.createFromConfig(rexDir, adapterName);
}
