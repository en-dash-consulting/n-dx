/**
 * CLI timeout configuration API routes.
 *
 * Reads and writes CLI timeout settings from `.n-dx.json` under the `cli` key.
 * Surfaces the global default timeout and per-command overrides so users can
 * view and edit them from the web dashboard without touching the CLI.
 *
 * GET /api/cli/timeouts — current timeout configuration
 * PUT /api/cli/timeouts — update timeout values
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The shape returned by GET /api/cli/timeouts. */
export interface CliTimeoutsResponse {
  /** Global timeout override in ms, or null if unset (uses DEFAULT_TIMEOUT_MS). */
  timeoutMs: number | null;
  /** Per-command overrides: command → ms (0 = no timeout). */
  timeouts: Record<string, number>;
  /** Effective default for all bounded commands when no override is set (ms). */
  defaultTimeoutMs: number;
  /** Commands that receive no default timeout (servers / long-running watchers). */
  noDefaultTimeoutCommands: string[];
}

/** The shape expected by PUT /api/cli/timeouts. */
interface CliTimeoutsPutBody {
  /** New global timeout in ms, or null to unset (restore default). */
  timeoutMs?: number | null;
  /** Per-command overrides to update. Values: ms ≥ 0, or null to remove override. */
  timeouts?: Record<string, number | null>;
}

// ---------------------------------------------------------------------------
// Constants (kept in sync with packages/core/cli-timeout.js)
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 minutes
const NO_DEFAULT_TIMEOUT_COMMANDS = ["start", "web", "dev"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NDX_CONFIG = ".n-dx.json";

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

/** Extract the CLI timeout config section from the project config. */
function extractCliTimeouts(projectDir: string): CliTimeoutsResponse {
  const config = readNdxConfig(projectDir);
  const cli = (config.cli ?? {}) as Record<string, unknown>;

  const timeoutMs = typeof cli.timeoutMs === "number" && cli.timeoutMs >= 0
    ? cli.timeoutMs
    : null;

  const rawTimeouts = (cli.timeouts ?? {}) as Record<string, unknown>;
  const timeouts: Record<string, number> = {};
  for (const [cmd, val] of Object.entries(rawTimeouts)) {
    if (typeof val === "number" && val >= 0) {
      timeouts[cmd] = val;
    }
  }

  return {
    timeoutMs,
    timeouts,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    noDefaultTimeoutCommands: NO_DEFAULT_TIMEOUT_COMMANDS,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const TIMEOUTS_PREFIX = "/api/cli/timeouts";

export async function handleCliTimeoutRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /api/cli/timeouts
  if (method === "GET" && url === TIMEOUTS_PREFIX) {
    const data = extractCliTimeouts(ctx.projectDir);
    jsonResponse(res, 200, data);
    return true;
  }

  // PUT /api/cli/timeouts
  if (method === "PUT" && url === TIMEOUTS_PREFIX) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as CliTimeoutsPutBody;

      // Validate timeoutMs if provided
      if ("timeoutMs" in parsed) {
        const val = parsed.timeoutMs;
        if (val !== null && val !== undefined) {
          if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
            errorResponse(res, 400, "timeoutMs must be a non-negative number or null");
            return true;
          }
        }
      }

      // Validate per-command overrides if provided
      if (parsed.timeouts !== null && parsed.timeouts !== undefined) {
        if (typeof parsed.timeouts !== "object" || Array.isArray(parsed.timeouts)) {
          errorResponse(res, 400, "timeouts must be an object mapping command names to ms values");
          return true;
        }
        for (const [cmd, val] of Object.entries(parsed.timeouts)) {
          if (val !== null) {
            if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
              errorResponse(res, 400, `timeouts.${cmd} must be a non-negative number or null (to remove override)`);
              return true;
            }
          }
          if (!/^[a-z][a-z0-9-]*$/.test(cmd)) {
            errorResponse(res, 400, `Invalid command name: "${cmd}". Must be lowercase alphanumeric with hyphens.`);
            return true;
          }
        }
      }

      // Apply changes to .n-dx.json
      const config = readNdxConfig(ctx.projectDir);
      if (!config.cli || typeof config.cli !== "object") {
        config.cli = {};
      }
      const cli = config.cli as Record<string, unknown>;

      const applied: Array<{ field: string; value: number | null }> = [];

      // Apply global timeout change
      if ("timeoutMs" in parsed) {
        if (parsed.timeoutMs === null || parsed.timeoutMs === undefined) {
          delete cli.timeoutMs;
          applied.push({ field: "timeoutMs", value: null });
        } else {
          cli.timeoutMs = parsed.timeoutMs;
          applied.push({ field: "timeoutMs", value: parsed.timeoutMs });
        }
      }

      // Apply per-command overrides
      if (parsed.timeouts) {
        if (!cli.timeouts || typeof cli.timeouts !== "object") {
          cli.timeouts = {};
        }
        const perCmd = cli.timeouts as Record<string, unknown>;
        for (const [cmd, val] of Object.entries(parsed.timeouts)) {
          if (val === null) {
            delete perCmd[cmd];
            applied.push({ field: `timeouts.${cmd}`, value: null });
          } else {
            perCmd[cmd] = val;
            applied.push({ field: `timeouts.${cmd}`, value: val });
          }
        }
        // Remove empty timeouts object
        if (Object.keys(perCmd).length === 0) {
          delete cli.timeouts;
        }
      }

      writeNdxConfig(ctx.projectDir, config);

      jsonResponse(res, 200, { applied });
      return true;
    } catch (err) {
      errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
      return true;
    }
  }

  return false;
}
