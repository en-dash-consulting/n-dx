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

/**
 * SDLC readiness (`.sourcevision/readiness.json`).
 *
 * `analyze` scores the detected SDLC profile and writes the result beside it;
 * the status route reads that file so the sidebar and, later, the hub card can
 * show the headline without re-scoring on a polling path. Type-only, like the
 * artifact types above — the scorer itself stays in sourcevision, so nothing
 * here can recompute a score the CLI would disagree with.
 */
export type { ReadinessScore } from "@n-dx/sourcevision";

/**
 * Cross-repo analysis artifacts, read by `GET /api/status`.
 *
 * `RepoIdentity` is who the analysed repository is independently of where it
 * sits on disk — the one field on the manifest that survives leaving its own
 * directory, which is what lets the hub label a card with a repository rather
 * than a path. `OutboundData` and `InfrastructureData` are the two artifacts
 * the status route counts, so the card can say how much of each the last
 * analysis found without the hub ever opening `.sourcevision/` itself.
 */
export type { RepoIdentity, OutboundData, InfrastructureData } from "@n-dx/sourcevision";

/**
 * Live analyze progress (`.sourcevision/.cache/analyze-progress.json`).
 *
 * The one sourcevision file read through a loader rather than parsed at the
 * read site: whether a `running` file is still running depends on its pid,
 * and "the previous run" is a lookup in `analyses.jsonl`. Both rules belong
 * to the writer, so the server takes the reader rather than restating them.
 * The same goes for what an analyze process's command line looks like, which
 * the Stop route checks before signalling a recorded pid.
 */
export { readAnalyzeProgress, analyzeProgressPath, confirmAnalyzeProcess } from "@n-dx/sourcevision";
export type { AnalyzeProgressReport, ProcessCommandLine } from "@n-dx/sourcevision";
