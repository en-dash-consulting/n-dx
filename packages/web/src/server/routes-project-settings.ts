/**
 * Project settings API routes.
 *
 * Reads and writes project-level settings from `.n-dx.json`:
 * - web.port (dashboard server port)
 * - language (project language override)
 * - sourcevision.zones.mergeThreshold (zone merge sensitivity)
 * - sourcevision.zones.pins (file → zone override map)
 *
 * GET /api/project-settings   — current project settings
 * PUT /api/project-settings   — update project settings
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/project-settings. */
export interface ProjectSettingsResponse {
  /** Web dashboard port (null = default 3117). */
  port: number | null;
  /** Project language override (null = auto-detect). */
  language: string | null;
  /** Sourcevision zone merge threshold, 0–1 (null = default 0.5). */
  sourcevisionMergeThreshold: number | null;
  /** Sourcevision zone pin overrides: file path → zone ID. */
  sourcevisionPins: Record<string, string>;
}

/** Shape expected by PUT /api/project-settings. */
interface ProjectSettingsPutBody {
  port?: number | null;
  language?: string | null;
  sourcevisionMergeThreshold?: number | null;
  /** Per-pin updates: file path → zone ID (or null to remove). */
  sourcevisionPins?: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NDX_CONFIG = ".n-dx.json";
const VALID_LANGUAGES = new Set(["typescript", "javascript", "go", "auto"]);
const MIN_PORT = 1;
const MAX_PORT = 65535;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readNdxConfig(projectDir: string): Record<string, unknown> {
  const configPath = join(projectDir, NDX_CONFIG);
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function writeNdxConfig(projectDir: string, config: Record<string, unknown>): void {
  const configPath = join(projectDir, NDX_CONFIG);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function extractProjectSettings(projectDir: string): ProjectSettingsResponse {
  const config = readNdxConfig(projectDir);
  const web = (config["web"] ?? {}) as Record<string, unknown>;
  const sv = (config["sourcevision"] ?? {}) as Record<string, unknown>;
  const zones = (sv["zones"] ?? {}) as Record<string, unknown>;

  const portRaw = web["port"];
  const port =
    typeof portRaw === "number" &&
    Number.isInteger(portRaw) &&
    portRaw >= MIN_PORT &&
    portRaw <= MAX_PORT
      ? portRaw
      : null;

  const language = typeof config["language"] === "string" ? config["language"] : null;

  const thresholdRaw = zones["mergeThreshold"];
  const sourcevisionMergeThreshold =
    typeof thresholdRaw === "number" && Number.isFinite(thresholdRaw)
      ? thresholdRaw
      : null;

  const rawPins = (zones["pins"] ?? {}) as Record<string, unknown>;
  const sourcevisionPins: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawPins)) {
    if (typeof v === "string") sourcevisionPins[k] = v;
  }

  return { port, language, sourcevisionMergeThreshold, sourcevisionPins };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const SETTINGS_PREFIX = "/api/project-settings";

/** Handle project settings API requests. Returns true if the request was handled. */
export async function handleProjectSettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /api/project-settings
  if (method === "GET" && url === SETTINGS_PREFIX) {
    jsonResponse(res, 200, extractProjectSettings(ctx.projectDir));
    return true;
  }

  // PUT /api/project-settings
  if (method === "PUT" && url === SETTINGS_PREFIX) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as ProjectSettingsPutBody;

      // Validate port
      if ("port" in parsed) {
        const v = parsed.port;
        if (v !== null && v !== undefined) {
          if (!Number.isInteger(v) || v < MIN_PORT || v > MAX_PORT) {
            errorResponse(res, 400, `port must be an integer between ${MIN_PORT} and ${MAX_PORT}`);
            return true;
          }
        }
      }

      // Validate language
      if ("language" in parsed) {
        const v = parsed.language;
        if (v !== null && v !== undefined && !VALID_LANGUAGES.has(v)) {
          errorResponse(
            res,
            400,
            `language must be one of: ${[...VALID_LANGUAGES].join(", ")}`,
          );
          return true;
        }
      }

      // Validate mergeThreshold
      if ("sourcevisionMergeThreshold" in parsed) {
        const v = parsed.sourcevisionMergeThreshold;
        if (v !== null && v !== undefined) {
          if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
            errorResponse(res, 400, "sourcevisionMergeThreshold must be a number between 0 and 1");
            return true;
          }
        }
      }

      // Validate pins
      if (parsed.sourcevisionPins !== null && parsed.sourcevisionPins !== undefined) {
        if (typeof parsed.sourcevisionPins !== "object" || Array.isArray(parsed.sourcevisionPins)) {
          errorResponse(res, 400, "sourcevisionPins must be an object");
          return true;
        }
        for (const [k, v] of Object.entries(parsed.sourcevisionPins)) {
          if (v !== null && typeof v !== "string") {
            errorResponse(res, 400, `sourcevisionPins["${k}"] must be a string or null`);
            return true;
          }
        }
      }

      // Apply changes
      const config = readNdxConfig(ctx.projectDir);
      const applied: string[] = [];

      if ("port" in parsed) {
        if (!config["web"] || typeof config["web"] !== "object") config["web"] = {};
        const web = config["web"] as Record<string, unknown>;
        if (parsed.port === null || parsed.port === undefined) {
          delete web["port"];
        } else {
          web["port"] = parsed.port;
        }
        applied.push("web.port");
      }

      if ("language" in parsed) {
        if (parsed.language === null || parsed.language === undefined) {
          delete config["language"];
        } else {
          config["language"] = parsed.language;
        }
        applied.push("language");
      }

      if ("sourcevisionMergeThreshold" in parsed) {
        if (!config["sourcevision"] || typeof config["sourcevision"] !== "object") {
          config["sourcevision"] = {};
        }
        const sv = config["sourcevision"] as Record<string, unknown>;
        if (!sv["zones"] || typeof sv["zones"] !== "object") sv["zones"] = {};
        const zones = sv["zones"] as Record<string, unknown>;
        if (
          parsed.sourcevisionMergeThreshold === null ||
          parsed.sourcevisionMergeThreshold === undefined
        ) {
          delete zones["mergeThreshold"];
        } else {
          zones["mergeThreshold"] = parsed.sourcevisionMergeThreshold;
        }
        // Remove empty zones object
        if (Object.keys(zones).length === 0) delete sv["zones"];
        applied.push("sourcevision.zones.mergeThreshold");
      }

      if (parsed.sourcevisionPins) {
        if (!config["sourcevision"] || typeof config["sourcevision"] !== "object") {
          config["sourcevision"] = {};
        }
        const sv = config["sourcevision"] as Record<string, unknown>;
        if (!sv["zones"] || typeof sv["zones"] !== "object") sv["zones"] = {};
        const zones = sv["zones"] as Record<string, unknown>;
        if (!zones["pins"] || typeof zones["pins"] !== "object") zones["pins"] = {};
        const pins = zones["pins"] as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed.sourcevisionPins)) {
          if (v === null) {
            delete pins[k];
          } else {
            pins[k] = v;
          }
        }
        // Remove empty pins object
        if (Object.keys(pins).length === 0) delete zones["pins"];
        applied.push("sourcevision.zones.pins");
      }

      writeNdxConfig(ctx.projectDir, config);
      jsonResponse(res, 200, {
        applied,
        settings: extractProjectSettings(ctx.projectDir),
      });
      return true;
    } catch (err) {
      errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
      return true;
    }
  }

  return false;
}
