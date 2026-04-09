/**
 * Prompt verbosity API routes.
 *
 * Reads and writes the `prompts.verbosity` setting from `.n-dx.json`.
 * Exposes the compact/verbose toggle so the web settings panel can persist
 * the preference without requiring CLI access.
 *
 * GET /api/prompts/verbosity  — current verbosity value and metadata
 * PUT /api/prompts/verbosity  — update verbosity value
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid verbosity modes. */
export type PromptVerbosity = "compact" | "verbose";

/** The shape returned by GET /api/prompts/verbosity. */
export interface PromptVerbosityResponse {
  /** Current verbosity setting ("compact" | "verbose"). */
  verbosity: PromptVerbosity;
  /** Default verbosity when no override is set. */
  defaultVerbosity: PromptVerbosity;
}

/** The shape expected by PUT /api/prompts/verbosity. */
interface PromptVerbosityPutBody {
  verbosity: PromptVerbosity;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_VERBOSITY: PromptVerbosity = "compact";
const VALID_VERBOSITIES: PromptVerbosity[] = ["compact", "verbose"];
const NDX_CONFIG = ".n-dx.json";
const ROUTE = "/api/prompts/verbosity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read .n-dx.json, returning empty object on failure. */
function readNdxConfig(projectDir: string): Record<string, unknown> {
  const configPath = join(projectDir, NDX_CONFIG);
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

/** Write .n-dx.json preserving existing content. */
function writeNdxConfig(projectDir: string, config: Record<string, unknown>): void {
  const configPath = join(projectDir, NDX_CONFIG);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** Extract current verbosity from config. */
function extractVerbosity(projectDir: string): PromptVerbosityResponse {
  const config = readNdxConfig(projectDir);
  const prompts = (config.prompts ?? {}) as Record<string, unknown>;
  const raw = prompts.verbosity;
  const verbosity = raw === "verbose" ? "verbose" : DEFAULT_VERBOSITY;
  return { verbosity, defaultVerbosity: DEFAULT_VERBOSITY };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handlePromptVerbosityRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /api/prompts/verbosity
  if (method === "GET" && url === ROUTE) {
    const data = extractVerbosity(ctx.projectDir);
    jsonResponse(res, 200, data);
    return true;
  }

  // PUT /api/prompts/verbosity
  if (method === "PUT" && url === ROUTE) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as PromptVerbosityPutBody;

      if (!parsed.verbosity || !VALID_VERBOSITIES.includes(parsed.verbosity)) {
        errorResponse(
          res,
          400,
          `verbosity must be one of: ${VALID_VERBOSITIES.join(", ")}. Got: ${JSON.stringify(parsed.verbosity)}`,
        );
        return true;
      }

      const config = readNdxConfig(ctx.projectDir);
      if (!config.prompts || typeof config.prompts !== "object") {
        config.prompts = {};
      }
      (config.prompts as Record<string, unknown>).verbosity = parsed.verbosity;
      writeNdxConfig(ctx.projectDir, config);

      const updated = extractVerbosity(ctx.projectDir);
      jsonResponse(res, 200, updated);
      return true;
    } catch (err) {
      errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
      return true;
    }
  }

  return false;
}
