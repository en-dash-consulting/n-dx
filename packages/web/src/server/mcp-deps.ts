/**
 * Centralized gateway for domain-package runtime imports.
 *
 * The web package reads most domain data from the filesystem (`.rex/prd.json`,
 * `.sourcevision/` data files, `.hench/runs/`) to stay loosely coupled.
 * Runtime imports from domain packages are concentrated here: MCP server
 * factories plus rex domain types/constants used by server routes.
 *
 * This mirrors the pattern established in `packages/hench/src/prd/ops.ts`:
 * a single gateway module that makes the cross-package dependency surface
 * explicit and easy to audit.
 *
 * ## Coupling budget
 *
 * | Coupling type              | Count | Where                         |
 * |---------------------------|-------|-------------------------------|
 * | Runtime imports (this file)| 2     | MCP server factories          |
 * | Rex domain re-exports      | 13    | Types, constants, type guards |
 * | Filesystem reads           | many  | routes-rex, routes-sv, routes-hench |
 * | Subprocess calls           | 1     | rex CLI for `analyze`         |
 *
 * By concentrating runtime imports here, we ensure:
 * - Adding a new cross-package import requires a **deliberate** edit to
 *   this gateway, not a casual `import` in a route file.
 * - The rest of the web server has **zero** runtime coupling to domain
 *   packages — it reads JSON files and shells out to CLIs.
 * - Future refactors (e.g., moving MCP to a separate process) have a
 *   single file to update.
 *
 * @module web/server/mcp-deps
 * @see packages/hench/src/prd/ops.ts — hench's equivalent gateway
 */

// ---- Rex MCP server factory -------------------------------------------------
export { createRexMcpServer } from "rex";

// ---- Sourcevision MCP server factory ----------------------------------------
export { createSourcevisionMcpServer } from "sourcevision";

// ---- Rex domain types & constants -------------------------------------------
// Previously duplicated in rex-domain.ts; now imported from the canonical source.
// Viewer-side types (packages/web/src/viewer/components/prd-tree/types.ts)
// remain as intentional duplicates since browser-bundled code cannot import
// Node.js packages at runtime.

export type { Priority, ItemLevel, ItemStatus } from "rex";
export type { RequirementCategory, RequirementValidationType } from "rex";
export {
  PRIORITY_ORDER,
  LEVEL_HIERARCHY,
  VALID_LEVELS,
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_REQUIREMENT_CATEGORIES,
  VALID_VALIDATION_TYPES,
  CHILD_LEVEL,
  isPriority,
  isItemLevel,
  isRequirementCategory,
  isValidationType,
} from "rex";
