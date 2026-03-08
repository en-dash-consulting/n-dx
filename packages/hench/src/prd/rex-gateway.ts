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
 * **Type-only** imports (`import type { PRDStore, … } from "rex"`)
 * are deliberately excluded — they are erased at compile time and
 * create zero runtime coupling.  Those stay at the call-site where
 * they provide local type-safety.
 *
 * @module hench/prd/rex-gateway
 * @see packages/web/src/server/domain-gateway.ts — web's equivalent gateway
 * @see packages/hench/tests/unit/prd/rex-gateway.test.ts — contract test
 */

// ---- Schema version ---------------------------------------------------------
export { SCHEMA_VERSION } from "rex";

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

// ---- Level helpers ----------------------------------------------------------
export { isRootLevel, isWorkItem } from "rex";

// ---- Finding acknowledgment -------------------------------------------------
export { loadAcknowledged, saveAcknowledged, acknowledgeFinding } from "rex";
