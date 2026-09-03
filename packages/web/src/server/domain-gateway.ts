/**
 * Centralized gateway for sourcevision runtime imports.
 *
 * Web route handlers need the sourcevision MCP server factory to serve
 * the `/mcp/sourcevision` endpoint, the next-step derivation used by the
 * Overview panel, the archetype override writer used by the Files tab, and
 * the isometric-map builder behind `/api/iso-map`. Rather than importing from
 * "@n-dx/sourcevision" directly in route files, all web→sourcevision runtime
 * imports pass through this single module.
 *
 * By concentrating all web→sourcevision runtime imports here, we ensure:
 * - The cross-package surface is **explicit** (one re-export list, not
 *   scattered imports).
 * - The DAG stays **acyclic** — sourcevision never imports from web.
 * - Future changes to sourcevision's public API need only be updated here.
 *
 * @module web/server/domain-gateway
 * @see packages/web/src/server/rex-gateway.ts — web's gateway for rex imports
 * @see packages/hench/src/prd/rex-gateway.ts — hench's equivalent gateway
 */

export {
  createSourcevisionMcpServer,
  deriveNextSteps,
  setArchetypeOverride,
  buildIsoModel,
  renderIsoMap,
  loadIsoInput,
  hasSourcevision,
} from "@n-dx/sourcevision";
export type { NextStep, IsoModel, IsoModelInput, IsoSourceMode } from "@n-dx/sourcevision";
