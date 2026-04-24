/**
 * Store adapter interface for rex PRD persistence.
 *
 * Every storage backend (local filesystem, Notion, future databases)
 * implements {@link PRDStore}. The interface covers four concerns:
 *
 * 1. **Document CRUD** — load/save the full PRD tree plus single-item
 *    get/add/update/remove for granular mutations.
 * 2. **Execution log** — append-only log of agent actions and events.
 * 3. **Configuration** — project-level settings (adapter choice, model, etc.).
 * 4. **Workflow** — human-readable workflow state (markdown).
 *
 * Adapters may mix backends: NotionStore keeps the PRD tree in Notion
 * but stores config, logs, and workflow on the local filesystem.
 *
 * @module store/contracts
 */

import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Describes what a store adapter supports beyond the base contract.
 *
 * Consumers can branch on these flags to enable optional features
 * (e.g. optimistic locking when transactions are available).
 */
export interface StoreCapabilities {
  /** Adapter identifier (e.g. `"file"`, `"notion"`). */
  adapter: string;

  /** Whether the adapter supports atomic multi-item writes. */
  supportsTransactions: boolean;

  /**
   * Whether the adapter can emit change events.
   * When `true`, consumers may subscribe to live updates.
   */
  supportsWatch: boolean;
}

/**
 * Optional write-time behavior flags for item mutations.
 */
export interface WriteOptions {
  /**
   * When true, stamp branch/sourceFile attribution for the write path.
   * Kept opt-in so proposal imports can preserve their original sourceFile.
   */
  applyAttribution?: boolean;

  /**
   * Project directory used for git branch resolution.
   * Implementations may fall back to their own local project root.
   */
  projectDir?: string;
}

// ---------------------------------------------------------------------------
// PRDStore — the adapter interface
// ---------------------------------------------------------------------------

/**
 * Unified storage interface that all rex backends implement.
 *
 * **Implementors must guarantee:**
 * - All methods are async and never throw for expected empty states
 *   (e.g. `getItem` returns `null`, `readLog` returns `[]`).
 * - `addItem` / `updateItem` / `removeItem` throw when the target or
 *   parent cannot be found.
 * - `saveDocument` is a full replacement — the stored state after the
 *   call must exactly match the provided document.
 * - Log entries are durably appended; `readLog` returns them in
 *   chronological (append) order.
 *
 * @example
 * ```ts
 * const store: PRDStore = createStore("file", ".rex");
 * const doc = await store.loadDocument();
 * await store.addItem({ id: "t1", title: "Task", status: "pending", level: "task" });
 * await store.appendLog({ timestamp: new Date().toISOString(), event: "item_added", itemId: "t1" });
 * ```
 */
export interface PRDStore {
  // ---- Document CRUD -----------------------------------------------------

  /**
   * Load the full PRD document tree.
   * @returns The current document state.
   * @throws If the backing store is missing or contains invalid data.
   */
  loadDocument(): Promise<PRDDocument>;

  /**
   * Persist a full PRD document, replacing whatever was stored.
   * @param doc - The complete document to write.
   */
  saveDocument(doc: PRDDocument): Promise<void>;

  /**
   * Retrieve a single item by ID, searching the full tree.
   * @param id - The PRD item ID (UUID).
   * @returns The item, or `null` if not found.
   */
  getItem(id: string): Promise<PRDItem | null>;

  /**
   * Add a new item to the PRD tree.
   * @param item - The item to insert.
   * @param parentId - Optional parent ID. When provided the item is nested
   *   under that parent; when omitted it is appended at the root.
   * @throws If `parentId` is provided but does not exist.
   */
  addItem(item: PRDItem, parentId?: string, options?: WriteOptions): Promise<void>;

  /**
   * Apply a partial update to an existing item.
   * @param id - The item to update.
   * @param updates - Fields to merge into the existing item.
   * @throws If the item does not exist.
   */
  updateItem(id: string, updates: Partial<PRDItem>, options?: WriteOptions): Promise<void>;

  /**
   * Remove an item (and its descendants) from the tree.
   * @param id - The item to remove.
   * @throws If the item does not exist.
   */
  removeItem(id: string): Promise<void>;

  // ---- Configuration -----------------------------------------------------

  /**
   * Load the project configuration.
   *
   * Implementations should merge any project-level overrides
   * (e.g. `.n-dx.json`) on top of the stored config.
   *
   * @returns The merged configuration.
   * @throws If the config file is missing or invalid.
   */
  loadConfig(): Promise<RexConfig>;

  /**
   * Persist the project configuration.
   * @param config - The full configuration to write.
   */
  saveConfig(config: RexConfig): Promise<void>;

  // ---- Execution log -----------------------------------------------------

  /**
   * Append a single entry to the execution log.
   *
   * The log is append-only — entries are never modified or deleted.
   *
   * @param entry - The log entry to persist.
   * @throws If the entry fails schema validation.
   */
  appendLog(entry: LogEntry): Promise<void>;

  /**
   * Read log entries in chronological order.
   * @param limit - When provided, return only the most recent N entries.
   * @returns Log entries, oldest first. Empty array when no log exists.
   */
  readLog(limit?: number): Promise<LogEntry[]>;

  // ---- Workflow ----------------------------------------------------------

  /**
   * Load the human-readable workflow document.
   * @returns The workflow markdown content.
   */
  loadWorkflow(): Promise<string>;

  /**
   * Persist the workflow document.
   * @param content - Markdown content to write.
   */
  saveWorkflow(content: string): Promise<void>;

  // ---- Introspection -----------------------------------------------------

  // ---- Transactions --------------------------------------------------------

  /**
   * Execute a read-modify-write transaction under a file lock.
   *
   * The callback receives the loaded document. Any mutations to it are
   * saved atomically when the callback returns. The lock is held for the
   * entire duration, preventing concurrent writers from interleaving.
   *
   * CLI commands that do their own load→mutate→save (reorganize, prune,
   * reshape) should use this instead of calling loadDocument/saveDocument
   * directly.
   *
   * @param fn - Receives the loaded document; return value is passed through.
   * @throws If the lock cannot be acquired (another writer is active).
   */
  withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T>;

  // ---- Introspection -------------------------------------------------------

  /**
   * Return the adapter's capability flags.
   *
   * This is synchronous — capabilities are known at construction time.
   */
  capabilities(): StoreCapabilities;
}
