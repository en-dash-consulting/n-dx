/**
 * Sourcevision API routes — structured access to analysis data.
 *
 * All endpoints are under /api/sv/.
 *
 * GET /api/sv/manifest      — analysis metadata and git info
 * GET /api/sv/inventory     — file listing with metadata
 * GET /api/sv/imports       — dependency graph
 * GET /api/sv/zones         — architectural zone map
 * GET /api/sv/components    — React component catalog
 * GET /api/sv/context       — full CONTEXT.md contents
 * GET /api/sv/summary       — summary stats across all analyses
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody, errorMessage, pageParams } from "./response-utils.js";
import { DATA_FILES, isRecord } from "../shared/index.js";
import { deriveNextSteps, setArchetypeOverride } from "./domain-gateway.js";
import type { NextStep } from "./domain-gateway.js";

const SV_PREFIX = "/api/sv/";
/** Load zone pins from the project config → sourcevision.zones.pins */
function loadZonePins(ctx: ServerContext): Record<string, string> | null {
  const configPath = resolveLayout(ctx.projectDir).configFile;
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const pins = config?.sourcevision?.zones?.pins;
    if (isRecord(pins)) {
      return pins as Record<string, string>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/sv/<path> routes that serve one analysis file as stored, each with
 * the 404 it answers while that file is absent or unreadable.
 */
const PASS_THROUGH_FILES: ReadonlyMap<string, { file: string; missing: string }> = new Map([
  ["classifications", { file: DATA_FILES.classifications, missing: "No classifications data. Run 'sourcevision analyze' first." }],
  ["manifest", { file: DATA_FILES.manifest, missing: "No manifest data. Run 'sourcevision analyze' first." }],
  ["imports", { file: DATA_FILES.imports, missing: "No imports data. Run 'sourcevision analyze' first." }],
  ["components", { file: DATA_FILES.components, missing: "No components data. Run 'sourcevision analyze' first." }],
  ["callgraph", { file: DATA_FILES.callGraph, missing: "No call graph data. Run 'sourcevision analyze' first." }],
]);

/** Safely read and parse a JSON data file. Returns null on failure. */
function loadDataFile(ctx: ServerContext, filename: string): unknown | null {
  const filePath = join(ctx.svDir, filename);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** Safely read a text data file. Returns null on failure. */
function loadTextFile(ctx: ServerContext, filename: string): string | null {
  const filePath = join(ctx.svDir, filename);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * POST /api/sv/archetype — override a file's archetype classification.
 * Mirrors the MCP `set_file_archetype` tool: validates the file against the
 * inventory and the archetype against known classifications, then persists
 * the override to `.n-dx.json` (applied on the next analyze run).
 */
async function handleArchetypeOverride(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<void> {
  let path = "";
  let archetype = "";
  try {
    const body = await readBody(req, res);
    const input = JSON.parse(body || "{}") as { path?: string; archetype?: string };
    path = String(input.path ?? "");
    archetype = String(input.archetype ?? "");
  } catch {
    errorResponse(res, 400, "Invalid JSON body");
    return;
  }
  if (!path || !archetype) {
    errorResponse(res, 400, "Both 'path' and 'archetype' are required");
    return;
  }

  const inventory = loadDataFile(ctx, DATA_FILES.inventory) as { files?: Array<{ path: string }> } | null;
  if (!inventory?.files?.some((f) => f.path === path)) {
    errorResponse(res, 404, `File "${path}" not found in inventory.`);
    return;
  }

  const classifications = loadDataFile(ctx, "classifications.json") as { archetypes?: Array<{ id: string }> } | null;
  const validArchetypes = classifications?.archetypes?.map((a) => a.id) ?? [];
  if (validArchetypes.length > 0 && !validArchetypes.includes(archetype)) {
    errorResponse(res, 400, `Unknown archetype "${archetype}". Valid archetypes: ${validArchetypes.join(", ")}`);
    return;
  }

  try {
    setArchetypeOverride(ctx.projectDir, path, archetype);
  } catch (err) {
    errorResponse(res, 500, `Failed to persist override: ${errorMessage(err)}`);
    return;
  }

  jsonResponse(res, 200, {
    ok: true,
    path,
    archetype,
    message: `Archetype override saved. Run analyze to apply.`,
  });
}

/** Handle sourcevision API requests. Returns true if the request was handled. */
export function handleSourcevisionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";
  const queryIdx = url.indexOf("?");
  const routePath = queryIdx === -1 ? url : url.slice(0, queryIdx);
  const query = queryIdx === -1 ? "" : url.slice(queryIdx + 1);

  if (!routePath.startsWith(SV_PREFIX)) return false;

  const path = routePath.slice(SV_PREFIX.length);
  const params = new URLSearchParams(query);

  // POST /api/sv/archetype — persist an archetype override (async body read;
  // the dispatcher stays synchronous, the handler completes the response).
  if (path === "archetype" && method === "POST") {
    void handleArchetypeOverride(req, res, ctx);
    return true;
  }

  if (method !== "GET") return false;

  // GET /api/sv/next-steps — prioritized recommendations derived from zone
  // findings (UI twin of the MCP get_next_steps tool).
  if (path === "next-steps") {
    const zones = loadDataFile(ctx, DATA_FILES.zones);
    if (!zones) {
      errorResponse(res, 404, "No zones data. Run 'sourcevision analyze' first.");
      return true;
    }
    try {
      let steps: NextStep[] = deriveNextSteps(zones as Parameters<typeof deriveNextSteps>[0]);
      const priority = params.get("priority");
      if (priority) steps = steps.filter((s) => s.priority === priority);
      const limit = Math.max(0, parseInt(params.get("limit") ?? "", 10) || 10);
      steps = steps.slice(0, limit);
      jsonResponse(res, 200, { steps, total: steps.length });
    } catch (err) {
      errorResponse(res, 500, `Failed to derive next steps: ${errorMessage(err)}`);
    }
    return true;
  }

  // GET /api/sv/manifest, /classifications, /imports, /components, /callgraph
  const passThrough = PASS_THROUGH_FILES.get(path);
  if (passThrough) {
    const data = loadDataFile(ctx, passThrough.file);
    if (!data) {
      errorResponse(res, 404, passThrough.missing);
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/inventory — supports ?offset=N&limit=N for pagination
  if (path === "inventory") {
    const data = loadDataFile(ctx, DATA_FILES.inventory) as Record<string, unknown> | null;
    if (!data) {
      errorResponse(res, 404, "No inventory data. Run 'sourcevision analyze' first.");
      return true;
    }

    // Support pagination via ?offset=N&limit=N query parameters
    const { offset, limit } = pageParams(params);

    if ((offset > 0 || limit > 0) && Array.isArray(data.files)) {
      const allFiles = data.files as unknown[];
      const total = allFiles.length;
      const slicedFiles = limit > 0
        ? allFiles.slice(offset, offset + limit)
        : allFiles.slice(offset);

      jsonResponse(res, 200, {
        ...data,
        files: slicedFiles,
        pagination: { offset, limit: limit || total - offset, total },
      });
    } else {
      jsonResponse(res, 200, data);
    }
    return true;
  }

  // GET /api/sv/zones
  if (path === "zones") {
    const data = loadDataFile(ctx, DATA_FILES.zones);
    if (!data) {
      errorResponse(res, 404, "No zones data. Run 'sourcevision analyze' first.");
      return true;
    }
    // Augment with zone pins from .n-dx.json
    const pins = loadZonePins(ctx);
    if (pins && Object.keys(pins).length > 0) {
      (data as Record<string, unknown>).zonePins = pins;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/context
  if (path === "context") {
    const text = loadTextFile(ctx, "CONTEXT.md");
    if (!text) {
      errorResponse(res, 404, "No CONTEXT.md. Run 'sourcevision analyze' first.");
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/markdown", "Cache-Control": "no-cache" });
    res.end(text);
    return true;
  }

  // GET /api/sv/summary — aggregate stats
  if (path === "summary") {
    const manifest = loadDataFile(ctx, DATA_FILES.manifest) as Record<string, unknown> | null;
    const inventory = loadDataFile(ctx, DATA_FILES.inventory) as Record<string, unknown> | null;
    const zones = loadDataFile(ctx, DATA_FILES.zones) as Record<string, unknown> | null;
    const components = loadDataFile(ctx, DATA_FILES.components) as Record<string, unknown> | null;
    const callGraph = loadDataFile(ctx, DATA_FILES.callGraph) as Record<string, unknown> | null;

    const summary: Record<string, unknown> = {
      hasManifest: !!manifest,
      hasInventory: !!inventory,
      hasZones: !!zones,
      hasComponents: !!components,
      hasCallGraph: !!callGraph,
    };

    if (manifest) {
      summary.project = manifest.project;
      summary.analyzedAt = manifest.timestamp;
    }

    if (inventory) {
      summary.fileCount = Array.isArray(inventory.files) ? inventory.files.length : 0;
      summary.inventorySummary = inventory.summary;
    }

    if (zones) {
      summary.zoneCount = Array.isArray(zones.zones) ? zones.zones.length : 0;
    }

    if (components) {
      summary.componentCount = Array.isArray(components.components) ? components.components.length : 0;
    }

    if (callGraph) {
      summary.callGraphSummary = callGraph.summary;
    }

    jsonResponse(res, 200, summary);
    return true;
  }

  return false;
}
