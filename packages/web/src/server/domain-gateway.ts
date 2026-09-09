/**
 * Centralized gateway for sourcevision runtime imports.
 *
 * Web route handlers need the sourcevision MCP server factory to serve
 * the `/mcp/sourcevision` endpoint, the next-step derivation used by the
 * Overview panel, the archetype override writer used by the Files tab, the
 * isometric-map builder behind `/api/iso-map`, and the analysis-output schema
 * types that describe the `.sourcevision/*.json` files the server reads from
 * disk. Rather than importing from "@n-dx/sourcevision" directly in route
 * files, all web→sourcevision imports — runtime *and* type — pass through
 * this single module.
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

/**
 * Analysis-output schema types.
 *
 * These describe the shape of the `.sourcevision/*.json` artifacts. The server
 * reads those files from disk (sourcevision exposes no loader — see its
 * `public.ts` API philosophy note), so the types are what keep the read sites
 * honest about the schema they are parsing. Re-exported here so a route or
 * helper never reaches for "@n-dx/sourcevision" itself.
 */
export type { Manifest, Inventory, Imports, Zones, Components } from "@n-dx/sourcevision";
