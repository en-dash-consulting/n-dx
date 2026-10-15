/**
 * The two project settings rex owns, read and written from the dashboard.
 *
 * `rex.applyOn` decides when a completed change's amendments reach the product
 * layer; `rex.placement.autoAccept` decides when a placement is taken without
 * a human. Both live in the `rex` section of `.n-dx.json` — the same file and
 * the same keys the CLI reads through `loadApplyOn` / `loadPlacementSettings`,
 * so a value saved here is the value `rex` acts on.
 *
 * What counts as valid is rex's to say, not this route's: the accepted values,
 * the defaults and the fallback for a stored value that is neither all come
 * through the gateway. The parsers are pure, so this route does the file read
 * (as every other settings route here does) and hands rex the parsed section.
 * Their warnings are passed through rather than swallowed — a config hand-edited
 * to `applyOn: "later"` is silently running as `complete`, and the page that
 * edits the setting is the right place to learn that.
 *
 * GET /api/rex/settings — current values, the choices, and any warnings
 * PUT /api/rex/settings — write one or both; null removes the override
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { relativeToRoot, resolveLayout } from "@n-dx/llm-client";
import {
  APPLY_ON,
  DEFAULT_APPLY_ON,
  DEFAULT_PLACEMENT_SETTINGS,
  PLACEMENT_AUTO_ACCEPT,
  parseApplyOn,
  parsePlacementSettings,
  type ApplyOn,
  type PlacementAutoAccept,
} from "./rex-gateway.js";
import type { ServerContext } from "./types.js";
import { commitSettingsChange } from "./settings-commit.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The shape returned by GET /api/rex/settings. */
export interface RexSettingsResponse {
  /** Effective `rex.applyOn` — the stored value, or the default when unset or invalid. */
  applyOn: ApplyOn;
  /** Whether `rex.applyOn` is written in the config at all. */
  applyOnSet: boolean;
  /** Effective `rex.placement.autoAccept`. */
  placementAutoAccept: PlacementAutoAccept;
  /** Whether `rex.placement.autoAccept` is written in the config at all. */
  placementAutoAcceptSet: boolean;
  /** Every value each setting accepts, in the order a chooser should offer them. */
  choices: {
    applyOn: readonly ApplyOn[];
    placementAutoAccept: readonly PlacementAutoAccept[];
  };
  /** What each setting falls back to when unset. */
  defaults: {
    applyOn: ApplyOn;
    placementAutoAccept: PlacementAutoAccept;
  };
  /** Rex's own complaints about stored values it had to fall back from. */
  warnings: string[];
  /**
   * The file the settings live in, relative to the project root; `.n-dx.json`
   * or `.ndx/config.json`. For display: the viewer cannot ask the resolver.
   */
  configFile: string;
}

/** The shape expected by PUT /api/rex/settings. A key left out is left alone. */
interface RexSettingsPutBody {
  /** New `rex.applyOn`, or null to remove the override. */
  applyOn?: ApplyOn | null;
  /** New `rex.placement.autoAccept`, or null to remove the override. */
  placementAutoAccept?: PlacementAutoAccept | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the project config, returning an empty object when absent or unparseable. */
function readNdxConfig(projectDir: string): Record<string, unknown> {
  const configPath = resolveLayout(projectDir).configFile;
  if (!existsSync(configPath)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Write the project config, preserving every key this route does not own. */
function writeNdxConfig(projectDir: string, config: Record<string, unknown>): void {
  const configPath = resolveLayout(projectDir).configFile;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** The `rex` section of the config, or an empty one. */
function rexSectionOf(config: Record<string, unknown>): Record<string, unknown> {
  const raw = config["rex"];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** The `rex.placement` sub-section, or an empty one. */
function placementSectionOf(rex: Record<string, unknown>): Record<string, unknown> {
  const raw = rex["placement"];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function extractRexSettings(projectDir: string): RexSettingsResponse {
  const config = readNdxConfig(projectDir);
  const rex = rexSectionOf(config);

  const { applyOn, warnings: applyWarnings } = parseApplyOn(rex);
  const { settings, warnings: placementWarnings } = parsePlacementSettings(rex);

  const layout = resolveLayout(projectDir);
  return {
    applyOn,
    applyOnSet: rex["applyOn"] !== undefined,
    placementAutoAccept: settings.autoAccept,
    placementAutoAcceptSet: placementSectionOf(rex)["autoAccept"] !== undefined,
    choices: { applyOn: APPLY_ON, placementAutoAccept: PLACEMENT_AUTO_ACCEPT },
    defaults: { applyOn: DEFAULT_APPLY_ON, placementAutoAccept: DEFAULT_PLACEMENT_SETTINGS.autoAccept },
    // Only the warnings about what this route edits: `rex.placement.models` is
    // not on this page, so complaining about it here names a field the reader
    // cannot act on.
    warnings: [...applyWarnings, ...placementWarnings.filter((w) => w.startsWith("rex.placement.autoAccept"))],
    configFile: relativeToRoot(layout, layout.configFile),
  };
}

/**
 * Check one incoming value against the list rex accepts.
 *
 * `undefined` means "not in the body" and `null` means "remove the override";
 * both are fine. Anything else must be a value the parser would keep, because
 * a value it would reject is one the CLI silently ignores — the save would
 * appear to work and change nothing.
 */
function invalidChoice<T extends string>(
  key: string,
  value: unknown,
  allowed: readonly T[],
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return null;
  return `${key} must be one of ${allowed.join(", ")}, or null to use the default`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const REX_SETTINGS_PATH = "/api/rex/settings";

/** Handle the rex settings API. Returns true when the request was handled. */
export async function handleRexSettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  // Strip the query string — a cache-buster must not fall through this
  // exact-equality match to the generic /api/rex/ router's 404.
  const url = (req.url || "/").split("?")[0];
  const method = req.method || "GET";

  if (url !== REX_SETTINGS_PATH) return false;

  if (method === "GET") {
    jsonResponse(res, 200, extractRexSettings(ctx.projectDir));
    return true;
  }

  if (method !== "PUT") return false;

  try {
    const parsed = JSON.parse(await readBody(req, res)) as RexSettingsPutBody;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      errorResponse(res, 400, "Body must be an object");
      return true;
    }

    const problem =
      invalidChoice("applyOn", parsed.applyOn, APPLY_ON) ??
      invalidChoice("placementAutoAccept", parsed.placementAutoAccept, PLACEMENT_AUTO_ACCEPT);
    if (problem) {
      errorResponse(res, 400, problem);
      return true;
    }

    const config = readNdxConfig(ctx.projectDir);
    const rex = rexSectionOf(config);
    config["rex"] = rex;

    const applied: Array<{ field: string; value: string | null }> = [];

    if ("applyOn" in parsed) {
      if (parsed.applyOn === null || parsed.applyOn === undefined) {
        delete rex["applyOn"];
        applied.push({ field: "rex.applyOn", value: null });
      } else {
        rex["applyOn"] = parsed.applyOn;
        applied.push({ field: "rex.applyOn", value: parsed.applyOn });
      }
    }

    if ("placementAutoAccept" in parsed) {
      const placement = placementSectionOf(rex);
      if (parsed.placementAutoAccept === null || parsed.placementAutoAccept === undefined) {
        delete placement["autoAccept"];
        applied.push({ field: "rex.placement.autoAccept", value: null });
      } else {
        placement["autoAccept"] = parsed.placementAutoAccept;
        applied.push({ field: "rex.placement.autoAccept", value: parsed.placementAutoAccept });
      }
      // An empty `placement` is noise in a hand-edited file; drop it rather
      // than leave `"placement": {}` behind a removed override.
      if (Object.keys(placement).length === 0) delete rex["placement"];
      else rex["placement"] = placement;
    }

    // Same for the section itself: nothing of rex's left means no `rex` key.
    if (Object.keys(rex).length === 0) delete config["rex"];

    writeNdxConfig(ctx.projectDir, config);

    // Fail-forward commits the change; a no-op when the mode is off.

    await commitSettingsChange(

      ctx.projectDir,

      resolveLayout(ctx.projectDir).configFile,

      "rex",

    );
    jsonResponse(res, 200, { applied, settings: extractRexSettings(ctx.projectDir) });
    return true;
  } catch (err) {
    errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
    return true;
  }
}
