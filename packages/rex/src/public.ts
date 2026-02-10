/**
 * Public API for the rex package.
 *
 * This barrel re-exports the subset of rex internals consumed by
 * downstream packages (hench, cli.js, etc.). All other modules are
 * implementation details and should not be imported directly.
 *
 * ## Architectural isolation
 *
 * Rex depends only on `@n-dx/claude-client` (the shared foundation)
 * and has **no dependency on hench or sourcevision**. This strict
 * one-way dependency ensures the monorepo's DAG remains acyclic:
 *
 * ```
 *   hench → rex → claude-client ← sourcevision
 * ```
 *
 * Rex can be built, tested, and published independently. Changes here
 * never create import cycles because no rex module imports from a
 * downstream package.
 *
 * ## Cross-package imports
 *
 * Hench uses `import type { PRDStore, PRDItem, ... } from "rex"` for
 * compile-time type safety. These `import type` statements are erased
 * during compilation and create zero runtime coupling — the packages
 * remain independently deployable. This is the correct pattern for
 * sharing domain contracts across Node.js packages.
 *
 * Runtime imports from rex are funnelled through a single gateway module
 * (`hench/src/prd/ops.ts`) to keep the cross-package surface explicit
 * and auditable.
 *
 * Validation functions (Zod schemas) are NOT exported here. Consumers
 * that need runtime validation should import directly from
 * `rex/src/schema/validate.js` to avoid forcing Zod as a transitive
 * dependency on type-only consumers.
 *
 * @module rex/public
 */

// ---- Store ------------------------------------------------------------------

export { resolveStore } from "./store/index.js";
export type { PRDStore } from "./store/types.js";

// ---- Schema types & constants -----------------------------------------------

export type { PRDItem, PRDDocument, ItemLevel, ItemStatus, Priority } from "./schema/v1.js";
export {
  PRIORITY_ORDER,
  LEVEL_HIERARCHY,
  VALID_LEVELS,
  VALID_STATUSES,
  VALID_PRIORITIES,
  CHILD_LEVEL,
  isPriority,
  isItemLevel,
  isItemStatus,
} from "./schema/v1.js";

// ---- Core: tree utilities ---------------------------------------------------

export { findItem, walkTree, computeStats, collectAllIds } from "./core/tree.js";
export type { TreeEntry, TreeStats } from "./core/tree.js";

// ---- Core: task selection ---------------------------------------------------

export {
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  extractTaskKeywords,
  matchTasksByKeywords,
} from "./core/next-task.js";
export type { TaskMatch } from "./core/next-task.js";

// ---- Core: keywords ---------------------------------------------------------

export { extractKeywords, scoreMatch } from "./core/keywords.js";

// ---- Core: timestamps -------------------------------------------------------

export { computeTimestampUpdates } from "./core/timestamps.js";

// ---- Core: parent auto-completion -------------------------------------------

export { findAutoCompletions } from "./core/parent-completion.js";

// ---- Core: parent status reset ----------------------------------------------

export { findParentResets } from "./core/parent-reset.js";
export { cascadeParentReset } from "./core/cascade-reset.js";

// ---- Core: merge/consolidation ----------------------------------------------

export { validateMerge, previewMerge, mergeItems } from "./core/merge.js";
export type { MergeOptions, MergeValidation, MergePreview, MergeResult } from "./core/merge.js";

// ---- MCP server factory -----------------------------------------------------

export { createRexMcpServer } from "./cli/mcp.js";
