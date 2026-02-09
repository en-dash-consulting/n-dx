/**
 * Public API for the rex package.
 *
 * This barrel re-exports the subset of rex internals consumed by
 * downstream packages (hench, cli.js, etc.). All other modules are
 * implementation details and should not be imported directly.
 *
 * @module rex/public
 */

// ---- Store ------------------------------------------------------------------

export { resolveStore } from "./store/index.js";
export type { PRDStore } from "./store/types.js";

// ---- Schema types -----------------------------------------------------------

export type { PRDItem, ItemStatus } from "./schema/v1.js";

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
