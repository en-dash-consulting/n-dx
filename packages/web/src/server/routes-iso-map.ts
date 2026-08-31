/**
 * Isometric architecture map route — renders sourcevision's standalone map.
 *
 *   GET /api/iso-map[?source=…&maxNodes=…&externals=…]  → text/html
 *
 * The response is a complete, self-contained HTML document built in memory by
 * sourcevision's `buildIsoModel` + `renderIsoMap` pair. Nothing is written to
 * disk — the dashboard link simply opens this URL in a new tab.
 *
 * Query parameters (all optional):
 *
 * | Param       | Values                          | Default | Meaning |
 * |-------------|---------------------------------|---------|---------|
 * | `source`    | `auto` \| `sourcevision` \| `scan` | `auto`  | Where the model input comes from. `auto` prefers `.sourcevision/` analysis and falls back to a direct filesystem scan. |
 * | `maxNodes`  | positive integer (≤ 500)        | `40`    | Cap on rendered zones; the largest by file count win. |
 * | `externals` | `0` \| `1`                      | `1`     | Whether shared third-party packages get their own column. |
 *
 * All sourcevision imports flow through {@link ./domain-gateway.js} — see the
 * "Gateway modules" section of CLAUDE.md.
 *
 * @module web/server/routes-iso-map
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { errorResponse } from "./response-utils.js";
import { buildIsoModel, renderIsoMap, loadIsoInput } from "./domain-gateway.js";
import type { IsoSourceMode } from "./domain-gateway.js";

/** Route path this handler owns. */
export const ISO_MAP_PATH = "/api/iso-map";

/** Default zone cap, mirroring sourcevision's own `IsoModelOptions` default. */
export const DEFAULT_MAX_NODES = 40;

/**
 * Upper bound on `maxNodes`.
 *
 * The renderer lays every zone out as a solid, so an unbounded value turns a
 * mis-typed query string into a multi-megabyte document. 500 is far above any
 * real repository's zone count while keeping the response bounded.
 */
export const MAX_MAX_NODES = 500;

const SOURCE_MODES: readonly IsoSourceMode[] = ["auto", "sourcevision", "scan"];

interface ParsedIsoParams {
  source: IsoSourceMode;
  maxNodes: number;
  includeExternals: boolean;
}

type ParseResult =
  | { ok: true; params: ParsedIsoParams }
  | { ok: false; reason: string };

/**
 * Validate the query string.
 *
 * Invalid values are rejected rather than silently coerced: a typo'd
 * `maxNodes=fourty` that quietly rendered the default map would look like the
 * parameter was ignored, which is harder to debug than a 400.
 */
export function parseIsoParams(search: URLSearchParams): ParseResult {
  const rawSource = search.get("source");
  let source: IsoSourceMode = "auto";
  if (rawSource !== null && rawSource !== "") {
    if (!(SOURCE_MODES as readonly string[]).includes(rawSource)) {
      return {
        ok: false,
        reason: `Invalid "source": expected one of ${SOURCE_MODES.join(", ")} (got "${rawSource}")`,
      };
    }
    source = rawSource as IsoSourceMode;
  }

  const rawMaxNodes = search.get("maxNodes");
  let maxNodes = DEFAULT_MAX_NODES;
  if (rawMaxNodes !== null && rawMaxNodes !== "") {
    if (!/^\d+$/.test(rawMaxNodes)) {
      return {
        ok: false,
        reason: `Invalid "maxNodes": expected a positive integer (got "${rawMaxNodes}")`,
      };
    }
    const parsed = Number(rawMaxNodes);
    if (parsed < 1 || parsed > MAX_MAX_NODES) {
      return {
        ok: false,
        reason: `Invalid "maxNodes": expected an integer between 1 and ${MAX_MAX_NODES} (got "${rawMaxNodes}")`,
      };
    }
    maxNodes = parsed;
  }

  const rawExternals = search.get("externals");
  let includeExternals = true;
  if (rawExternals !== null && rawExternals !== "") {
    if (rawExternals !== "0" && rawExternals !== "1") {
      return {
        ok: false,
        reason: `Invalid "externals": expected 0 or 1 (got "${rawExternals}")`,
      };
    }
    includeExternals = rawExternals === "1";
  }

  return { ok: true, params: { source, maxNodes, includeExternals } };
}

/** Send a complete HTML document. */
function htmlResponse(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(html);
}

/**
 * Handle `GET /api/iso-map`.
 *
 * Returns `true` when the request was claimed (and answered), `false` when it
 * belongs to another route group.
 */
export function handleIsoMapRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const url = req.url || "/";
  const qIdx = url.indexOf("?");
  const pathOnly = qIdx === -1 ? url : url.slice(0, qIdx);
  if (pathOnly !== ISO_MAP_PATH) return false;

  if ((req.method || "GET") !== "GET") {
    errorResponse(res, 405, "Method not allowed");
    return true;
  }

  const parsed = parseIsoParams(
    qIdx === -1 ? new URLSearchParams() : new URLSearchParams(url.slice(qIdx + 1)),
  );
  if (!parsed.ok) {
    errorResponse(res, 400, parsed.reason);
    return true;
  }

  const { source, maxNodes, includeExternals } = parsed.params;

  let html: string;
  try {
    const input = loadIsoInput(ctx.projectDir, source, {});
    if (!input) {
      // Only reachable for source=sourcevision: the caller demanded analysis
      // data and there is none.
      errorResponse(
        res,
        404,
        "No sourcevision analysis found. Run `ndx analyze .` first, or request ?source=scan to map the project directly.",
      );
      return true;
    }

    if (!input.zones.some((zone) => zone.files.length > 0)) {
      errorResponse(
        res,
        404,
        "Nothing to map: no source files were found in this project. Run `ndx analyze .` to produce a zone map, or check that the server's project directory is correct.",
      );
      return true;
    }

    const model = buildIsoModel(input, { maxNodes, includeExternals });
    html = renderIsoMap(model);
  } catch (err) {
    errorResponse(
      res,
      500,
      `Failed to build the architecture map: ${err instanceof Error ? err.message : String(err)}`,
    );
    return true;
  }

  htmlResponse(res, html);
  return true;
}
