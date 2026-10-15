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
import {
  resolveLayout,
  isProjectFeatureEnabled,
  FAIL_FORWARD_FEATURE,
  FAIL_FORWARD_DEFAULT,
} from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { commitSettingsChange } from "./settings-commit.js";
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
  /** Longer explanation revealed by the toggle's info control. */
  details?: string;
  package: "sourcevision" | "rex" | "hench" | "git";
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
  {
    key: "sourcevision.ask",
    label: "Ask Panel",
    description: "Show the SourceVision Ask page: a prompt/response exchange that answers questions about this project from the existing analysis.",
    impact: "Each question spends tokens on an LLM call. When disabled, Ask stays hidden from the SourceVision sidebar.",
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
  // ── Git ───────────────────────────────────────────────────────────
  {
    key: FAIL_FORWARD_FEATURE,
    label: "Fail-forward mode",
    description: "Commit automatically at the end of every run, every loop iteration, and every settings change, using a fixed message for each kind. Work is saved as it happens instead of piling up uncommitted.",
    impact: "Commits only the paths each step touched, and never pushes. Your own in-progress work is left alone. History gains one small commit per step.",
    details: [
      "What gets committed, and when:",
      "\u2022 After each autonomous run, and after each iteration of a loop \u2014 so an "
        + "interrupted loop still leaves its finished iterations committed.",
      "\u2022 After a settings change, including one made from the pre-run menu.",
      "\u2022 After the PRD or a SourceVision scan is rewritten.",
      "",
      "Each commit uses a fixed message for its kind and stages only the paths that "
        + "step touched, so anything you are in the middle of is left untouched and "
        + "unstaged. Commits carry the usual N-DX trailers. Nothing is ever pushed \u2014 "
        + "committing is the whole promise.",
      "",
      "Off by default. With it off, nothing is committed automatically and behaviour "
        + "is exactly as before.",
    ].join("\n"),
    package: "git",
    stability: "experimental",
    defaultValue: FAIL_FORWARD_DEFAULT,
  },
  {
    key: "git.autoCommitGenerated",
    label: "Auto-commit generated files",
    description: "When every uncommitted file came from the same tool — all PRD files, or all SourceVision scan output — commit them automatically with a constant message instead of waiting for the button in the git panel.",
    impact: "Only ever commits a tree that contains nothing else, and never pushes. A tree holding any of your own work is left alone.",
    package: "git",
    stability: "experimental",
    defaultValue: false,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the project config, returning empty object on failure. */
function readNdxConfig(projectDir: string): Record<string, unknown> {
  const configPath = resolveLayout(projectDir).configFile;
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

/** Write the project config preserving existing content. */
function writeNdxConfig(projectDir: string, config: Record<string, unknown>): void {
  const configPath = resolveLayout(projectDir).configFile;
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
      ...(def.details ? { details: def.details } : {}),
      package: def.package,
      stability: def.stability,
      enabled,
      defaultValue: def.defaultValue,
    };
  });
}

/**
 * Read one feature toggle's effective value for a project.
 *
 * For routes that must not act when their feature is off. Reads `.n-dx.json`
 * per call rather than caching: toggles are edited from the dashboard while the
 * server runs, and a route that answers from a cached value would keep serving
 * a feature the user just turned off.
 *
 * Fails closed in every ambiguous case — unreadable config, malformed config,
 * or a key that is not in the registry all yield the registry default, and an
 * unknown key yields `false`. A gate that opens when it cannot tell is not a
 * gate.
 */
/**
 * Every distinct `package` the registry uses.
 *
 * The settings page renders package sections in a fixed order and drops any
 * package missing from that order, so a toggle in a package the viewer does
 * not list is invisible. This is the list the viewer is checked against.
 */
export function featureRegistryPackages(): string[] {
  return [...new Set(FEATURE_REGISTRY.map((d) => d.package))];
}

export function isFeatureEnabled(projectDir: string, key: string): boolean {
  const def = FEATURE_REGISTRY.find((d) => d.key === key);
  if (!def) return false;

  // The read itself lives in llm-client, because `ndx work` and the hench run
  // loop need the same answer and never go through this server. Two readers
  // of one toggle would eventually disagree.
  return isProjectFeatureEnabled(projectDir, key, def.defaultValue);
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
  // Strip the query string — a trailing "?_=1" cache-buster (or any future
  // query param) must not fall through this exact-equality match to a 404.
  const url = (req.url || "/").split("?")[0];
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
      const body = await readBody(req, res);
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
      // Fail-forward commits the change; a no-op when the mode is off.
      await commitSettingsChange(
        ctx.projectDir,
        resolveLayout(ctx.projectDir).configFile,
        "features",
      );

      jsonResponse(res, 200, { applied });
      return true;
    } catch (err) {
      errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
      return true;
    }
  }

  return false;
}
