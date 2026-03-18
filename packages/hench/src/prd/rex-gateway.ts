/**
 * Centralized gateway for rex runtime imports.
 *
 * Hench needs several rex functions at runtime (tree traversal, task
 * selection, timestamp computation, auto-completion).  Rather than
 * scattering `import … from "@n-dx/rex"` across 9+ files, every runtime
 * import is funnelled through this single module.  This makes the
 * cross-package dependency surface explicit and easy to audit.
 *
 * ## Dependency DAG invariant
 *
 * Hench is the only domain package that imports from another domain
 * package (rex).  This creates a strict one-way dependency:
 *
 * ```
 *   hench → rex → llm-client
 *   hench → llm-client
 *   sourcevision → llm-client
 * ```
 *
 * By concentrating all hench→rex runtime imports here, we ensure:
 * - The cross-package surface is **explicit** (re-exports, not scattered
 *   imports).
 * - The DAG stays **acyclic** — rex never imports from hench.
 * - Future changes to rex's public API need only be updated in this
 *   single file.
 *
 * ## Migration safety
 *
 * This gateway is the sole cross-zone coupling surface for ~160 hench
 * files. To mitigate blast radius from rex API changes:
 *
 * 1. **Contract test** — `tests/unit/prd/rex-gateway.test.ts` verifies
 *    every re-export exists and is callable, catching API drift at test
 *    time rather than in production agent loops.
 *
 * 2. **Domain-aligned sections** — re-exports are grouped by concern
 *    (store, tree, task-selection, validation, etc.). If rex ever splits
 *    into sub-packages, each section can be migrated independently.
 *
 * 3. **Narrow consumer surface** — only 3 files import from this
 *    gateway (cli/commands/run.ts, agent/planning/brief.ts,
 *    tools/rex.ts). Each imports only the subset it needs.
 *
 * ## Maximum-scope policy
 *
 * This gateway intentionally limits its surface to the rex APIs that
 * hench needs for its core mission: picking a task, running an agent
 * loop, and recording the result. Categories explicitly in-scope and
 * out-of-scope are listed below. New re-exports must fit an in-scope
 * category — if they don't, the feature should be reconsidered or the
 * policy updated with a documented rationale.
 *
 * **In-scope (re-export permitted):**
 * - Schema version contract (read/validate prd.json compatibility)
 * - Store factory (open a PRDStore for reading/writing)
 * - Tree traversal (findItem, walkTree — locate items in the tree)
 * - Task selection (findNextTask, findActionableTasks, collectCompletedIds)
 * - Timestamp computation (status change timestamps)
 * - Parent auto-completion (bubble-up completion when children finish)
 * - Requirements validation (verify task acceptance criteria)
 * - Level helpers (isRootLevel, isWorkItem — classify items)
 * - Finding acknowledgment (load/save/acknowledge sourcevision findings)
 *
 * **Out-of-scope (must NOT be re-exported):**
 * - PRD mutation (insertChild, updateInTree, removeFromTree — hench
 *   mutates via rex MCP tools, not direct tree manipulation)
 * - Analytics & health (computeEpicStats, computeHealthScore — these
 *   serve the dashboard/UI, not the agent loop)
 * - Merge/consolidation (validateMerge, mergeItems — user-facing operations)
 * - Reorganize/reshape (detectReorganizations, applyReshape — LLM-powered
 *   restructuring is an interactive workflow, not an agent concern)
 * - MCP server factory (createRexMcpServer — web-tier concern only)
 * - Domain constants (PRIORITY_ORDER, LEVEL_HIERARCHY — UI display aids)
 *
 * **Type-only** imports (`import type { PRDStore, … }`) must also
 * flow through this gateway to prevent the type-import promotion
 * erosion path — a type import can be promoted to a runtime import
 * during refactoring, silently bypassing the gateway pattern.
 * This is enforced by domain-isolation.test.js.
 *
 * @module hench/prd/rex-gateway
 * @see packages/web/src/server/domain-gateway.ts — web's equivalent gateway
 * @see packages/hench/tests/unit/prd/rex-gateway.test.ts — contract test
 */

// ---- Schema version contract ------------------------------------------------
export { SCHEMA_VERSION, isCompatibleSchema, assertSchemaVersion } from "@n-dx/rex";

// ---- Store factory ----------------------------------------------------------
export { resolveStore } from "@n-dx/rex";

// ---- Tree utilities ---------------------------------------------------------
export { findItem, walkTree } from "@n-dx/rex";

// ---- Task selection ---------------------------------------------------------
export { findNextTask, findActionableTasks, collectCompletedIds } from "@n-dx/rex";

// ---- Timestamps -------------------------------------------------------------
export { computeTimestampUpdates } from "@n-dx/rex";

// ---- Parent auto-completion -------------------------------------------------
export { findAutoCompletions } from "@n-dx/rex";

// ---- Requirements validation ------------------------------------------------
export {
  collectRequirements,
  validateAutomatedRequirements,
  formatRequirementsValidation,
} from "@n-dx/rex";

// ---- Level helpers ----------------------------------------------------------
export { isRootLevel, isWorkItem } from "@n-dx/rex";

// ---- Finding acknowledgment -------------------------------------------------
export { loadAcknowledged, saveAcknowledged, acknowledgeFinding } from "@n-dx/rex";

// ---- Type re-exports --------------------------------------------------------
// All type imports from rex must flow through this gateway to prevent
// type-import promotion erosion (a type import can be promoted to a
// runtime import during refactoring, silently bypassing the gateway).
export type { PRDStore, PRDItem, ItemStatus, ResolutionType, CommandExecutor, TreeEntry } from "@n-dx/rex";
