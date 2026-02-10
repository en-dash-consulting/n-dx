/**
 * Centralized gateway for domain-package runtime imports.
 *
 * The web package reads most domain data from the filesystem (`.rex/prd.json`,
 * `.sourcevision/` data files, `.hench/runs/`) to stay loosely coupled.  The
 * **only** runtime imports from other domain packages are the MCP server
 * factory functions, which are re-exported here.
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
 * | Filesystem reads           | many  | routes-rex, routes-sv, routes-hench |
 * | Subprocess calls           | 1     | rex CLI for `analyze`         |
 * | Type duplication           | 1     | rex-domain.ts                 |
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
