/**
 * Feature toggles API routes.
 *
 * Manages feature flags stored in `.n-dx.json` under the `features` key.
 * Flags are organized by package (sourcevision, rex, hench) and control
 * experimental or problematic features across the n-dx toolkit.
 *
 * GET /api/features   — current feature flags with metadata
 * PUT /api/features   — update feature flags
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

// ---------------------------------------------------------------------------
// Types — canonical definitions in src/shared/features.ts
// ---------------------------------------------------------------------------

export type { FeatureToggle, FeaturesResponse } from "../shared/index.js";
import type { FeatureToggle, FeaturesResponse } from "../shared/index.js";

// ---------------------------------------------------------------------------
// Feature registry — defines all known feature flags
// ---------------------------------------------------------------------------

interface FeatureDefinition {
  key: string;
  label: string;
  description: string;
  impact: string;
  package: "sourcevision" | "rex" | "hench";
  stability: "experimental" | "stable" | "deprecated";
  defaultValue: boolean;
}

/**
 * Central registry of all feature toggles across n-dx packages.
 * Add new features here as they are developed.
 */
const FEATURE_REGISTRY: FeatureDefinition[] = [
  // ── SourceVision ──────────────────────────────────────────────────
  {
    key: "sourcevision.callGraph",
    label: "Call Graph Analysis",
    description: "Enable call graph extraction during analysis. Traces function calls across files to build a dependency graph at the function level.",
    impact: "Increases analysis time and memory usage. Large codebases may see significant slowdown.",
    package: "sourcevision",
    stability: "experimental",
    defaultValue: false,
  },
  {
    key: "sourcevision.enrichment",
    label: "AI Enrichment Passes",
    description: "Enable AI-powered enrichment that adds architectural insights, problem detection, and improvement suggestions to the analysis.",
    impact: "Requires an API key or CLI access. Each enrichment pass uses token budget.",
    package: "sourcevision",
    stability: "stable",
    defaultValue: true,
  },
  {
    key: "sourcevision.componentCatalog",
    label: "React Component Catalog",
    description: "Extract React/Preact component metadata including props, hooks usage, and component hierarchy.",
    impact: "Only useful for React/Preact projects. Adds a small amount of analysis time.",
    package: "sourcevision",
    stability: "stable",
    defaultValue: true,
  },
  {
    key: "sourcevision.prMarkdown",
    label: "PR Markdown Page",
    description: "Show the SourceVision PR Markdown page in navigation.",
    impact: "When disabled, PR Markdown remains hidden from the SourceVision sidebar.",
    package: "sourcevision",
    stability: "experimental",
    defaultValue: false,
  },
  // ── Rex ────────────────────────────────────────────────────────────
  {
    key: "rex.autoComplete",
    label: "Auto-Complete Parent Items",
    description: "Automatically mark parent items (features, epics) as complete when all children are done.",
    impact: "Parent items transition to 'completed' without manual intervention. Disable if you prefer explicit completion.",
    package: "rex",
    stability: "stable",
    defaultValue: true,
  },
  {
    key: "rex.showTokenBudget",
    label: "Show Token Budget",
    description: "Display token budget information on Rex task line items and in the detail side panel. When disabled, only non-zero token usage badges are shown.",
    impact: "Adds budget percentage and remaining capacity indicators to task views. No performance impact.",
    package: "rex",
    stability: "stable",
    defaultValue: false,
  },
  {
    key: "rex.budgetEnforcement",
    label: "Budget Enforcement",
    description: "Enforce token and cost budgets during rex analyze operations. When exceeded, operations are blocked or warned.",
    impact: "When enabled, analysis operations may be interrupted if budget limits are reached.",
    package: "rex",
    stability: "stable",
    defaultValue: false,
  },
  {
    key: "rex.notionSync",
    label: "Notion Sync",
    description: "Enable two-way synchronization between the local PRD and a Notion database. Shows the Notion tab in the Rex sidebar.",
    impact: "Requires Notion integration setup. Sync operations may modify both local and remote data.",
    package: "rex",
    stability: "experimental",
    defaultValue: false,
  },
  {
    key: "rex.integrations",
    label: "Integrations",
    description: "Show the Integrations tab in the Rex sidebar for configuring external service connections.",
    impact: "No performance impact. Hides integration configuration UI when disabled.",
    package: "rex",
    stability: "experimental",
    defaultValue: false,
  },
  // ── Hench ─────────────────────────────────────────────────────────
  {
    key: "hench.autoRetry",
    label: "Automatic Retry on Failure",
    description: "Automatically retry failed task runs with exponential backoff when transient errors occur.",
    impact: "May consume additional tokens when retrying. Useful for flaky API connections.",
    package: "hench",
    stability: "stable",
    defaultValue: true,
  },
  {
    key: "hench.guardRails",
    label: "Guard Rails",
    description: "Enforce security boundaries: blocked file paths, allowed commands, size limits, and timeouts.",
    impact: "When disabled, the agent has unrestricted file and command access. Keep enabled for safety.",
    package: "hench",
    stability: "stable",
    defaultValue: true,
  },
  {
    key: "hench.adaptiveWorkflow",
    label: "Adaptive Workflow Adjustment",
    description: "Allow the agent to dynamically adjust its workflow based on task complexity and past performance.",
    impact: "May change execution parameters between runs. Provides better results but less predictable behavior.",
    package: "hench",
    stability: "experimental",
    defaultValue: false,
  },
];

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

/** Get a nested value from an object by dot-separated path. */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a nested value in an object by dot-separated path. */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Build toggles list with current values from config. */
function buildToggles(projectDir: string): FeatureToggle[] {
  const config = readNdxConfig(projectDir);
  const features = (config.features ?? {}) as Record<string, unknown>;

  return FEATURE_REGISTRY.map((def) => {
    // Key in features section is relative (e.g., "sourcevision.callGraph")
    const stored = getByPath(features, def.key);
    const enabled = typeof stored === "boolean" ? stored : def.defaultValue;

    return {
      key: def.key,
      label: def.label,
      description: def.description,
      impact: def.impact,
      package: def.package,
      stability: def.stability,
      enabled,
      defaultValue: def.defaultValue,
    };
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const FEATURES_PREFIX = "/api/features";

export async function handleFeaturesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /api/features — return all toggles with current state
  if (method === "GET" && url === FEATURES_PREFIX) {
    const toggles = buildToggles(ctx.projectDir);
    jsonResponse(res, 200, { toggles } satisfies FeaturesResponse);
    return true;
  }

  // PUT /api/features — update one or more toggle values
  if (method === "PUT" && url === FEATURES_PREFIX) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as { changes: Record<string, boolean> };

      if (!parsed.changes || typeof parsed.changes !== "object") {
        errorResponse(res, 400, "Request body must include a 'changes' object mapping feature keys to boolean values.");
        return true;
      }

      // Validate all keys exist in registry
      const validKeys = new Set(FEATURE_REGISTRY.map((d) => d.key));
      const invalidKeys = Object.keys(parsed.changes).filter((k) => !validKeys.has(k));
      if (invalidKeys.length > 0) {
        errorResponse(res, 400, `Unknown feature key(s): ${invalidKeys.join(", ")}`);
        return true;
      }

      // Validate all values are boolean
      for (const [key, value] of Object.entries(parsed.changes)) {
        if (typeof value !== "boolean") {
          errorResponse(res, 400, `Feature "${key}" value must be a boolean, got ${typeof value}`);
          return true;
        }
      }

      // Apply changes to .n-dx.json
      const config = readNdxConfig(ctx.projectDir);
      if (!config.features || typeof config.features !== "object") {
        config.features = {};
      }
      const features = config.features as Record<string, unknown>;

      const applied: Array<{ key: string; enabled: boolean }> = [];
      for (const [key, value] of Object.entries(parsed.changes)) {
        setByPath(features, key, value);
        applied.push({ key, enabled: value });
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
