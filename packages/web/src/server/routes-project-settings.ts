/**
 * Project settings API routes.
 *
 * Reads and writes project-level settings from `.n-dx.json`:
 * - web.port (dashboard server port)
 * - language (project language override)
 * - sourcevision.zones.mergeThreshold (small-zone merge threshold, in files)
 * - sourcevision.zones.pins (file → zone override map)
 * - web.sidecarGithubReads, which lives in the user's local config and is
 *   written by the Sidecar settings writer (sidecar/settings.ts)
 *
 * GET /api/project-settings   — current project settings
 * PUT /api/project-settings   — update project settings
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { commitSettingsChange } from "./settings-commit.js";
import { readNdxConfig, writeNdxConfig } from "./ndx-config-file.js";
import { jsonResponse, errorResponse, errorMessage, readBody } from "./response-utils.js";
import { planSidecarSettings, readSidecarSettings, saveSidecarSettings } from "./sidecar/settings.js";
import { PROJECT_LANGUAGES, isProjectLanguage } from "../shared/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/project-settings. */
export interface ProjectSettingsResponse {
  /** Web dashboard port (null = default 3117). */
  port: number | null;
  /** Project language override (null = auto-detect). */
  language: string | null;
  /** Sourcevision small-zone merge threshold — minimum zone size in files (null = default 3). */
  sourcevisionMergeThreshold: number | null;
  /** Sourcevision zone pin overrides: file path → zone ID. */
  sourcevisionPins: Record<string, string>;
  /**
   * `web.sidecarGithubReads` in force: whether branch health and the Sidecar
   * may run gh. Served here as well as by /api/sidecar/settings because branch
   * health reads it with the Sidecar off, when the Sidecar routes refuse.
   * False when it could not be read.
   */
  githubReads: boolean;
  /**
   * Why `githubReads` could not be read (a config file that does not parse),
   * else null. Only that setting fails: the rest of the response still loads.
   */
  githubReadsError: string | null;
}

/** Shape expected by PUT /api/project-settings. */
interface ProjectSettingsPutBody {
  port?: number | null;
  language?: string | null;
  sourcevisionMergeThreshold?: number | null;
  /** Per-pin updates: file path → zone ID (or null to remove). */
  sourcevisionPins?: Record<string, string | null>;
  /** `web.sidecarGithubReads`, saved to the local config as the Sidecar route saves it; null clears it. */
  githubReads?: boolean | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_PORT = 1;
const MAX_PORT = 65535;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

  return { port, language, sourcevisionMergeThreshold, sourcevisionPins, ...readGithubReads(projectDir) };
}

/**
 * GitHub reads, read apart from the project's own keys: it parses the local
 * config as well, and a half-edited one must not take Analysis and Dashboard
 * settings down with it. Unreadable, it stays off, and the error says why.
 */
function readGithubReads(projectDir: string): Pick<ProjectSettingsResponse, "githubReads" | "githubReadsError"> {
  try {
    return { githubReads: readSidecarSettings(projectDir).githubReads, githubReadsError: null };
  } catch (err) {
    return { githubReads: false, githubReadsError: `GitHub reads could not be read from the project config: ${errorMessage(err)}` };
  }
}

/**
 * The first problem with a PUT body's project-config fields, or null. GitHub
 * reads is not checked here: the Sidecar settings planner owns that rule.
 */
function projectSettingsProblem(parsed: ProjectSettingsPutBody): string | null {
  if ("port" in parsed) {
    const v = parsed.port;
    if (v !== null && v !== undefined) {
      if (!Number.isInteger(v) || v < MIN_PORT || v > MAX_PORT) {
        return `port must be an integer between ${MIN_PORT} and ${MAX_PORT}`;
      }
    }
  }

  if ("language" in parsed) {
    const v = parsed.language;
    if (v !== null && v !== undefined && (typeof v !== "string" || !isProjectLanguage(v))) {
      return `language must be one of: ${PROJECT_LANGUAGES.map((l) => l.id).join(", ")}`;
    }
  }

  // mergeThreshold is the minimum zone size in files — a count, not a ratio.
  if ("sourcevisionMergeThreshold" in parsed) {
    const v = parsed.sourcevisionMergeThreshold;
    if (v !== null && v !== undefined) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return "sourcevisionMergeThreshold must be a non-negative integer (minimum zone size in files)";
      }
    }
  }

  if (parsed.sourcevisionPins !== null && parsed.sourcevisionPins !== undefined) {
    if (typeof parsed.sourcevisionPins !== "object" || Array.isArray(parsed.sourcevisionPins)) {
      return "sourcevisionPins must be an object";
    }
    for (const [k, v] of Object.entries(parsed.sourcevisionPins)) {
      if (v !== null && typeof v !== "string") {
        return `sourcevisionPins["${k}"] must be a string or null`;
      }
    }
  }

  return null;
}

/** `parent[key]` as an object, set to a fresh one first when it is not one. */
function childObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  if (!parent[key] || typeof parent[key] !== "object") parent[key] = {};
  return parent[key] as Record<string, unknown>;
}

/**
 * Write a validated PUT body's project-config fields into `config`. Returns
 * the config keys it set or removed, in the order the response lists them.
 */
function applyProjectSettings(config: Record<string, unknown>, parsed: ProjectSettingsPutBody): string[] {
  const applied: string[] = [];

  if ("port" in parsed) {
    const web = childObject(config, "web");
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
    const sv = childObject(config, "sourcevision");
    const zones = childObject(sv, "zones");
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
    const zones = childObject(childObject(config, "sourcevision"), "zones");
    const pins = childObject(zones, "pins");
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

  return applied;
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
  // Strip the query string — a trailing "?_=1" cache-buster (or any future
  // query param) must not fall through this exact-equality match to a 404.
  const url = (req.url || "/").split("?")[0];
  const method = req.method || "GET";

  // GET /api/project-settings
  if (method === "GET" && url === SETTINGS_PREFIX) {
    jsonResponse(res, 200, extractProjectSettings(ctx.projectDir));
    return true;
  }

  // PUT /api/project-settings
  if (method === "PUT" && url === SETTINGS_PREFIX) {
    try {
      const body = await readBody(req, res);
      const parsed = JSON.parse(body) as ProjectSettingsPutBody;

      const problem = projectSettingsProblem(parsed);
      if (problem) {
        errorResponse(res, 400, problem);
        return true;
      }

      // Validate GitHub reads (the Sidecar settings planner owns the rule).
      const githubReadsPlan = "githubReads" in parsed ? planSidecarSettings({ githubReads: parsed.githubReads }) : null;
      if (githubReadsPlan && "error" in githubReadsPlan) {
        errorResponse(res, 400, githubReadsPlan.error);
        return true;
      }

      const config = readNdxConfig(ctx.projectDir);
      const applied = applyProjectSettings(config, parsed);

      // Only rewrite (and commit) the project config when one of its own keys changed.
      if (applied.length > 0) {
        writeNdxConfig(ctx.projectDir, config);
        // Fail-forward commits the change; a no-op when the mode is off.
        await commitSettingsChange(
          ctx.projectDir,
          resolveLayout(ctx.projectDir).configFile,
          "project",
        );
      }

      // GitHub reads lands in the user's local config, never the shared one.
      if (githubReadsPlan) {
        const saved = saveSidecarSettings(ctx.projectDir, { githubReads: parsed.githubReads });
        if ("error" in saved) {
          errorResponse(res, 400, saved.error);
          return true;
        }
        applied.push("web.sidecarGithubReads");
      }
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
