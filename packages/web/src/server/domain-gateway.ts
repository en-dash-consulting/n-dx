/**
 * Centralized gateway for sourcevision runtime imports.
 *
 * Web route handlers need the sourcevision MCP server factory to serve
 * the `/mcp/sourcevision` endpoint. Rather than importing from "sourcevision"
 * directly in route files, all web→sourcevision runtime imports pass through
 * this single module.
 *
 * By concentrating all web→sourcevision runtime imports here, we ensure:
 * - The cross-package surface is **explicit** (1 re-export, not scattered imports).
 * - The DAG stays **acyclic** — sourcevision never imports from web.
 * - Future changes to sourcevision's public API need only be updated here.
 *
 * @module web/server/domain-gateway
 * @see packages/web/src/server/rex-gateway.ts — web's gateway for rex imports
 * @see packages/hench/src/prd/rex-gateway.ts — hench's equivalent gateway
 */

export { createSourcevisionMcpServer } from "sourcevision";
