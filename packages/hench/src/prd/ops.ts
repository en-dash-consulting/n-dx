/**
 * Centralized gateway for rex runtime imports.
 *
 * Hench needs several rex functions at runtime (tree traversal, task
 * selection, timestamp computation, auto-completion).  Rather than
 * scattering `import … from "rex"` across 9+ files, every runtime
 * import is funnelled through this single module.  This makes the
 * cross-package dependency surface explicit and easy to audit.
 *
 * ## Dependency DAG invariant
 *
 * Hench is the only domain package that imports from another domain
 * package (rex).  This creates a strict one-way dependency:
 *
 * ```
 *   hench → rex → claude-client ← sourcevision
 * ```
 *
 * By concentrating all hench→rex runtime imports here, we ensure:
 * - The cross-package surface is **explicit** (8 re-exports, not 14
 *   scattered imports).
 * - The DAG stays **acyclic** — rex never imports from hench.
 * - Future changes to rex's public API need only be updated in this
 *   single file.
 *
 * **Type-only** imports (`import type { PRDStore, … } from "rex"`)
 * are deliberately excluded — they are erased at compile time and
 * create zero runtime coupling.  Those stay at the call-site where
 * they provide local type-safety.
 *
 * @module hench/prd/ops
 * @see packages/web/src/server/mcp-deps.ts — web's equivalent gateway (MCP factories)
 */

// ---- Store factory ----------------------------------------------------------
export { resolveStore } from "rex";

// ---- Tree utilities ---------------------------------------------------------
export { findItem, walkTree } from "rex";

// ---- Task selection ---------------------------------------------------------
export { findNextTask, findActionableTasks, collectCompletedIds } from "rex";

// ---- Timestamps -------------------------------------------------------------
export { computeTimestampUpdates } from "rex";

// ---- Parent auto-completion -------------------------------------------------
export { findAutoCompletions } from "rex";

// ---- Requirements validation ------------------------------------------------
export {
  collectRequirements,
  validateAutomatedRequirements,
  formatRequirementsValidation,
} from "rex";
