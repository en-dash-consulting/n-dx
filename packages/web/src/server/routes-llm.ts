/**
 * LLM provider configuration API routes.
 *
 * Reads and writes LLM provider settings from `.n-dx.json` under the
 * `llm` key (modern namespace) and `claude` key (legacy namespace), merged
 * with `.n-dx.local.json` (local wins) for reads — the same "local wins"
 * overlay `packages/core/config.js` and `@n-dx/llm-client`'s config loader
 * apply, so a per-machine override in the gitignored local file is reflected
 * here too. Writes still go to the shared `.n-dx.json` only.
 * Auth-sensitive fields (api_key, api_endpoint, cli_path) are omitted
 * from the response; only vendor selection and model names are exposed.
 *
 * GET /api/llm/config   — current LLM provider configuration
 * PUT /api/llm/config   — update LLM provider configuration
 * POST /api/llm/config/preview — resolve unsaved edits in memory; writes nothing
 * GET /api/llm/catalog  — per-vendor model catalog and provider choices hench accepts
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
import { invalidateAuthCheckCache } from "./routes-commands.js";
import {
  LLM_VENDOR,
  TIER_MODELS,
  MODEL_COSTS,
  isModelCompatibleWithVendor,
  resolveClaudeConfig,
  parseLLMConfig,
  resolveLayout,
  getNextFailoverAttempt,
} from "@n-dx/llm-client";
import type { LLMConfig, LLMVendor, ClaudeFieldSource, ListableVendor } from "@n-dx/llm-client";
import { VENDOR_PROVIDERS, validateConfigKeyValue, validateProviderForVendor } from "./hench-config-fields.js";
import {
  readConfigSnapshot,
  readEffectiveNdxConfig,
  resolveEffectiveAgentConfig,
  resolveEffectiveAgentConfigFrom,
  resolveEffectiveAgentModel,
  resolveEffectiveProvider,
  readHenchAgentSettings,
  readHenchReviewSettings,
} from "./effective-agent-config.js";
import type { ConfigSnapshot } from "./effective-agent-config.js";
import { HENCH_REVIEW_PATHS, REVIEW_MODEL_PATH, buildReviewInfo, validateReviewChange } from "./llm-review.js";
import type { ReviewInfo } from "./llm-review.js";
import {
  getLiveVendorProbe,
  clearLlmCatalogCache,
  claudeReadiness,
  codexReadiness,
  googleReadiness,
  localReadiness,
} from "./llm-catalog.js";
import type { CliInfo, LiveVendorProbe, VendorReadiness } from "./llm-catalog.js";
import { buildTierTable } from "./llm-tiers.js";
import type { TierRow } from "./llm-tiers.js";
import type { EffectiveAgentConfig } from "./effective-agent-config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VendorConfig {
  model: string | null;
  lightModel: string | null;
}

/** Second-model verifier config, nested under `local`. */
export interface LocalVerifierVendorConfig {
  host: string | null;
  port: number | null;
  model: string | null;
  maxCycles: number | null;
}

/** Local model config shape returned by GET /api/llm/config. */
export interface LocalVendorConfig {
  model: string | null;
  lightModel: string | null;
  host: string | null;
  port: number | null;
  /** Max context window (tokens) hench pre-checks a brief against before sending. */
  maxContextTokens: number | null;
  /**
   * Per-request timeout in ms for local completions (0 = no timeout).
   * Null means unset — the provider default of 5 min applies. Distinct from
   * `cli.timeoutMs`, which bounds a whole command rather than one request.
   */
  timeoutMs: number | null;
  /** Second-model review pass config. All fields null when unset. */
  verifier: LocalVerifierVendorConfig;
}

/** Shape returned by GET /api/llm/config. */
export interface LlmConfigResponse {
  /** Active LLM vendor: "claude", "codex", "google", "local", or null if unset. */
  vendor: string | null;
  /**
   * Claude settings, resolved **per field** across `llm.claude.*` and the
   * legacy top-level `claude.*` — see `claudeSources` for which location each
   * value came from.
   */
  claude: VendorConfig;
  /** Codex-specific settings from llm.codex.* */
  codex: VendorConfig;
  /** Google Gemini settings from llm.google.* */
  google: VendorConfig;
  /** Local server settings from llm.local.* */
  local: LocalVendorConfig;
  /**
   * Where each resolved Claude field came from, so the dashboard can mark a
   * value as still living under a deprecated key. Only fields that resolved to
   * a value appear. Writes always go to the modern `llm.claude.*` namespace —
   * a `"legacy"` source is a display fact, never a write target.
   */
  claudeSources: Partial<Record<"model" | "lightModel", ClaudeFieldSource>>;
  /** Enable automatic failover on model/vendor errors. */
  autoFailover?: boolean;
  /**
   * The per-vendor agent model override, `hench.models.<vendor>` in the project
   * config (`.n-dx.json` merged with the local overlay). A vendor with no
   * override is absent. This is the key the picker writes — not the merged
   * view `effective` reports, which also folds in `.hench/config.json`.
   */
  agentModels: Partial<Record<LLMVendor, string>>;
  /**
   * What `ndx work` runs with no flags, resolved across `.n-dx.json` and
   * `.hench/config.json`. Every other field on this response is a configured
   * key; this one is the answer those keys add up to. See
   * `effective-agent-config.ts` for the resolution and why web keeps a twin of
   * it.
   */
  effective: EffectiveAgentConfig;
  /**
   * Why `ndx work` would refuse to run {@link LlmConfigResponse.effective};
   * empty when it would run. The viewer renders these and runs no check of its
   * own, so the rules live only here, beside the validators they come from.
   */
  effectiveProblems: EffectiveProblem[];
  /**
   * The model tier table for the active vendor: the model each tier resolves
   * to, the key that supplied it, and the commands that run on it. See
   * `llm-tiers.ts`.
   */
  tiers: TierRow[];
  /**
   * Failover chain information.
   */
  failover: FailoverInfo;
  /**
   * The review pass: its saved settings, each reviewer vendor's model, and
   * whether review can run for the active vendor and provider. See
   * `llm-review.ts`.
   */
  review: ReviewInfo;
}

/** Failover information for the active vendor/provider combination. */
export interface FailoverInfo {
  /** Whether automatic failover is enabled in the config. */
  enabled: boolean;
  /** Whether failover can fire for this config (true only for Claude + API). */
  applies: boolean;
  /** Why applies is false (empty when applies is true). */
  reason?: string;
  /** The effective model followed by the next three models in the failover chain. */
  chain: string[];
}

/** One reason the resolved agent config would be refused. */
export interface EffectiveProblem {
  field: "provider" | "model";
  message: string;
}

/** Shape expected by PUT /api/llm/config. */
interface LlmConfigPutBody {
  /** Dot-path → string, boolean, number, or null value. */
  changes: Record<string, string | boolean | number | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_VENDORS: ReadonlySet<string> = new Set([
  LLM_VENDOR.CLAUDE,
  LLM_VENDOR.CODEX,
  LLM_VENDOR.GOOGLE,
  LLM_VENDOR.LOCAL,
]);

/**
 * Legacy top-level `claude.*` write paths, mapped to the key that replaces
 * them.
 *
 * Reads still fold these in per field (see `resolveClaudeConfig`), so an
 * existing project keeps working untouched; writes go to `llm.claude.*` only.
 * Only the two fields the dashboard can set are listed — the auth fields are
 * not writable through this route at all, under either name.
 */
const DEPRECATED_WRITE_PATHS: Readonly<Record<string, string>> = {
  "claude.model": "llm.claude.model",
  "claude.lightModel": "llm.claude.lightModel",
};

/** Writable paths. Auth fields (api_key, api_endpoint, cli_path) are excluded. */
const VALID_PATHS = new Set([
  "llm.vendor",
  // Standard-tier shorthand for the active vendor. Was writable via the CLI
  // but absent here, so the dashboard could not see or set the field with the
  // highest precedence over the model actually used.
  "llm.model",
  "llm.claude.model",
  "llm.claude.lightModel",
  "llm.codex.model",
  "llm.codex.lightModel",
  "llm.google.model",
  "llm.google.lightModel",
  "llm.local.model",
  "llm.local.lightModel",
  "llm.local.host",
  "llm.local.port",
  "llm.local.maxContextTokens",
  "llm.local.timeoutMs",
  "llm.local.verifier.host",
  "llm.local.verifier.port",
  "llm.local.verifier.model",
  "llm.local.verifier.maxCycles",
  "llm.autoFailover",
  "llm.escalation.enabled",
  "llm.escalation.maxSteps",
  // `claude.model` / `claude.lightModel` used to be listed here. They are read
  // (per field, beside their `llm.claude.*` twins) but no longer written — see
  // DEPRECATED_WRITE_PATHS above, which refuses them by name.
]);

/** Routing tiers a `llm.routes.<class>` value may name. */
const TASK_TIERS: ReadonlySet<string> = new Set(["light", "standard", "heavy", "free"]);

/** Effort levels a `llm.effort.<class>` value may name. */
const EFFORT_LEVELS: ReadonlySet<string> = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * Path families whose trailing segments are variable, so they cannot be
 * enumerated in {@link VALID_PATHS}: `llm.tiers.<vendor>.<tier>`,
 * `llm.routes.<class>`, and `llm.effort.<class>`.
 */
const PARAMETERIZED_PREFIXES = ["llm.tiers.", "llm.routes.", "llm.effort."] as const;

/**
 * Sections holding a flat map keyed by task class.
 *
 * Task classes contain dots (`agent.execute`), and so does the path syntax, so
 * these paths must set one literal key rather than nesting — nested config is
 * silently ignored by the flat-map extractor in `loadLLMConfig`, which would
 * make the write appear to succeed and do nothing.
 */
const FLAT_MAP_PREFIXES = ["llm.routes.", "llm.effort."] as const;

/** `hench.models.<vendor>` — the agent model override `ndx work` honours after `--model`. */
const AGENT_MODEL_PATH = /^hench\.models\.(claude|codex|google|local)$/;

/**
 * The vendor a model-valued path is scoped to, or null for any other path:
 * `llm.<vendor>.model`, `llm.<vendor>.lightModel`, `llm.tiers.<vendor>.<tier>`, and
 * `hench.models.<vendor>`.
 */
function modelPathVendor(path: string): LLMVendor | null {
  const agent = AGENT_MODEL_PATH.exec(path);
  if (agent) return agent[1] as LLMVendor;
  const llm = /^llm\.(claude|codex|google|local)\.(model|lightModel)$/.exec(path) ?? REVIEW_MODEL_PATH.exec(path);
  if (llm) return llm[1] as LLMVendor;
  const tier = /^llm\.(claude|codex|google|local)\.tiers\.(light|standard|heavy|free)$/.exec(path);
  if (tier) return tier[1] as LLMVendor;
  const tierPath = /^llm\.tiers\.(claude|codex|google|local)\./.exec(path);
  if (tierPath) return tierPath[1] as LLMVendor;
  return null;
}

/**
 * Refuse a model id the vendor cannot run — the check `ndx work` applies, made
 * at write time so the next run does not fail on it. `local` runs whatever the
 * server has loaded, so any id is accepted there. Returns an error message, or
 * null when the change is acceptable (including a delete).
 */
function validateModelForVendor(path: string, value: unknown): string | null {
  const vendor = modelPathVendor(path);
  if (!vendor || vendor === LLM_VENDOR.LOCAL) return null;
  if (typeof value !== "string" || value === "") return null;
  if (isModelCompatibleWithVendor(vendor, value)) return null;
  return `Model "${value}" is not a ${vendor} model; "${path}" was not changed.`;
}

function isWritablePath(path: string): boolean {
  if (VALID_PATHS.has(path)) return true;
  if (AGENT_MODEL_PATH.test(path)) return true;
  if (HENCH_REVIEW_PATHS.has(path) || REVIEW_MODEL_PATH.test(path)) return true;
  return PARAMETERIZED_PREFIXES.some(
    (prefix) => path.startsWith(prefix) && path.length > prefix.length,
  );
}

/** Split a path into object keys, keeping flat-map task classes intact. */
function splitConfigPath(path: string): string[] {
  for (const prefix of FLAT_MAP_PREFIXES) {
    if (path.startsWith(prefix) && path.length > prefix.length) {
      return [...prefix.slice(0, -1).split("."), path.slice(prefix.length)];
    }
  }
  return path.split(".");
}

/**
 * Reject a parameterized path or value the resolver could not honor.
 * Returns an error message, or null when the change is acceptable.
 */
function validateRoutingChange(path: string, value: unknown): string | null {
  if (path.startsWith("llm.tiers.")) {
    const rest = path.slice("llm.tiers.".length);
    const segments = rest.split(".");
    if (segments.length !== 2) {
      return `Invalid path "${path}". Expected llm.tiers.<vendor>.<tier>.`;
    }
    const [vendor, tier] = segments;
    if (!VALID_VENDORS.has(vendor)) {
      return `Unknown vendor "${vendor}" in "${path}". Expected one of: ${[...VALID_VENDORS].join(", ")}.`;
    }
    if (!TASK_TIERS.has(tier)) {
      return `Unknown tier "${tier}" in "${path}". Expected one of: ${[...TASK_TIERS].join(", ")}.`;
    }
    // Model ID validation is performed by validateModelForVendor, called after this path check
    if (typeof value !== "string") {
      return `Value for "${path}" must be a model ID string.`;
    }
    return null;
  }

  if (path.startsWith("llm.routes.")) {
    if (typeof value !== "string" || !TASK_TIERS.has(value)) {
      return `Value for "${path}" must be one of: ${[...TASK_TIERS].join(", ")}; got ${JSON.stringify(value)}.`;
    }
    return null;
  }

  if (path.startsWith("llm.effort.")) {
    if (typeof value !== "string" || !EFFORT_LEVELS.has(value)) {
      return `Value for "${path}" must be one of: ${[...EFFORT_LEVELS].join(", ")}; got ${JSON.stringify(value)}.`;
    }
    return null;
  }

  if (path === "llm.escalation.maxSteps") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      return `Value for "${path}" must be a non-negative integer, got ${JSON.stringify(value)}.`;
    }
    return null;
  }

  return null;
}

/** Paths that accept numeric values (stored as numbers in JSON). */
const NUMERIC_PATHS = new Set([
  "llm.local.port",
  "llm.local.maxContextTokens",
  "llm.local.timeoutMs",
  "llm.local.verifier.port",
  "llm.local.verifier.maxCycles",
  "llm.escalation.maxSteps",
  "hench.review.rounds",
]);

/** Numeric paths validated as a TCP port (1–65535) rather than a plain positive integer. */
const PORT_PATHS = new Set(["llm.local.port", "llm.local.verifier.port"]);

/** Numeric paths where 0 is meaningful (0 = no timeout) and must not be rejected. */
const NON_NEGATIVE_PATHS = new Set(["llm.local.timeoutMs"]);

/** Paths that accept boolean values. */
const BOOLEAN_PATHS = new Set(["llm.autoFailover", "llm.escalation.enabled"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/** Read the shared, git-tracked project config only. Writes always target this file. */
function readNdxConfig(projectDir: string): Record<string, unknown> {
  return readJsonFile(resolveLayout(projectDir).configFile);
}

// `readEffectiveNdxConfig` (shared config deep-merged with the gitignored
// `.n-dx.local.json` overlay, local wins) lives in effective-agent-config.ts
// beside the snapshot it feeds. Use it for anything the user should *see*; use
// `readNdxConfig` for anything about to be *written back*, so a write never
// flattens the local overlay's values into the shared file.

function writeNdxConfig(projectDir: string, config: Record<string, unknown>): void {
  const configPath = resolveLayout(projectDir).configFile;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** Read a string leaf from a nested object. Returns null if absent or not a string. */
function getString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Read a numeric leaf from a nested object. Returns null if absent or not a number. */
function getNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}

/** Set a nested value by dot-separated path, creating intermediate objects. */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = splitConfigPath(path);
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

/** Delete a nested key by dot-separated path. */
function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const parts = splitConfigPath(path);
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== "object") return;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  if (current != null && typeof current === "object") {
    delete (current as Record<string, unknown>)[parts[parts.length - 1]];
  }
}

/**
 * Drop `hench.models` / `hench.review` once their last key is cleared, and
 * `hench` once that leaves it empty, so "Use project default" leaves no residue
 * in `.n-dx.json`. Only ever removes objects this route emptied itself.
 */
function pruneEmptyHenchSections(config: Record<string, unknown>): void {
  const hench = config["hench"];
  if (!hench || typeof hench !== "object") return;
  const henchObj = hench as Record<string, unknown>;
  for (const section of ["models", "review"]) {
    const value = henchObj[section];
    if (value && typeof value === "object" && Object.keys(value).length === 0) {
      delete henchObj[section];
    }
  }
  if (Object.keys(henchObj).length === 0) delete config["hench"];
}

/**
 * Read the active `llm.vendor` from `.n-dx.json` merged with the local
 * overlay (local wins), or null if unset. Shared with `routes-hench.ts` and
 * `routes-adaptive.ts` so a hench-config `provider` write can be validated
 * against the vendor actually in effect.
 */
export function resolveActiveVendor(projectDir: string): string | null {
  const config = readEffectiveNdxConfig(projectDir);
  const llm = (config["llm"] ?? {}) as Record<string, unknown>;
  return typeof llm["vendor"] === "string" ? llm["vendor"] : null;
}

/** The agent's vendor and model as the Live views show them; both null when the config cannot be resolved. */
export interface ActiveAgentModel {
  vendor: string | null;
  model: string | null;
}

const activeAgentModels = new Map<string, ActiveAgentModel>();

/**
 * The vendor and model `ndx work` runs — the `effective` block of
 * `GET /api/llm/config`, so the Live strip and Robot Wrangler name the same
 * robot. Remembered per project for {@link lastActiveAgentModel}.
 *
 * A config that fails to resolve (malformed `.n-dx.json`) yields nulls and a
 * log line rather than a throw: the Live views must keep answering, and the
 * LLM settings page is where that error is reported.
 */
export async function resolveActiveAgentModel(projectDir: string): Promise<ActiveAgentModel> {
  let resolved: ActiveAgentModel;
  try {
    const { vendor, model } = await resolveEffectiveAgentConfig(projectDir);
    resolved = { vendor, model };
  } catch (err) {
    console.error(`[llm] effective agent config unresolved for ${projectDir}: ${(err as Error).message}`);
    resolved = { vendor: null, model: null };
  }
  activeAgentModels.set(projectDir, resolved);
  return resolved;
}

/** The last {@link resolveActiveAgentModel} answer for the project, for synchronous snapshot builders. */
export function lastActiveAgentModel(projectDir: string): ActiveAgentModel {
  return activeAgentModels.get(projectDir) ?? { vendor: null, model: null };
}

/**
 * Refusals `ndx work` would raise for the resolved config. The provider check
 * is the one the dashboard already applies on write; the model check is
 * llm-client's, skipped for `local` where any loaded model id is valid.
 */
function findEffectiveProblems(effective: EffectiveAgentConfig): EffectiveProblem[] {
  const problems: EffectiveProblem[] = [];
  const providerError = validateProviderForVendor(effective.provider, effective.vendor);
  if (providerError) problems.push({ field: "provider", message: providerError });
  if (
    effective.vendor !== LLM_VENDOR.LOCAL &&
    !isModelCompatibleWithVendor(effective.vendor, effective.model)
  ) {
    problems.push({
      field: "model",
      message: `Model "${effective.model}" is not a ${effective.vendor} model.`,
    });
  }
  return problems;
}

/** `hench.models.<vendor>` entries from a parsed project config; non-string and unknown-vendor keys are skipped. */
function readAgentModels(config: Record<string, unknown>): Partial<Record<LLMVendor, string>> {
  const hench = (config["hench"] ?? {}) as Record<string, unknown>;
  const raw = (hench["models"] ?? {}) as Record<string, unknown>;
  const models: Partial<Record<LLMVendor, string>> = {};
  for (const vendor of VALID_VENDORS) {
    const value = getString(raw, vendor);
    if (value) models[vendor as LLMVendor] = value;
  }
  return models;
}

/**
 * Build the failover chain for the given effective vendor/provider/model.
 * Returns applies=true with a 4-model chain only for Claude + API.
 * For claude (cli), codex, and google, builds the chain even though applies=false.
 * For local, returns applies=false with an empty chain.
 */
function buildFailoverInfo(
  effective: EffectiveAgentConfig,
  llmConfig: LLMConfig,
): FailoverInfo {
  const enabled = llmConfig.autoFailover === true;

  // Failover only applies to Claude + API provider
  const isClaudeApi = effective.vendor === LLM_VENDOR.CLAUDE && effective.provider === "api";

  // For vendors that support failover (claude, codex, google), build the chain
  // but only apply=true for Claude + API
  const supportsFailover =
    effective.vendor === LLM_VENDOR.CLAUDE ||
    effective.vendor === LLM_VENDOR.CODEX ||
    effective.vendor === LLM_VENDOR.GOOGLE;

  if (supportsFailover) {
    // Build the failover chain
    const chain: string[] = [effective.model];

    // Attempts 1-3 represent the next three failover attempts
    // Safe to use vendor directly since we checked supportsFailover above
    // and effective.vendor is never null (it defaults to "claude")
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = getNextFailoverAttempt(
        attempt,
        effective.vendor as "claude" | "codex" | "google",
        llmConfig,
      );
      if (result.isExhausted || !result.model) break;
      chain.push(result.model);
    }

    if (isClaudeApi) {
      // Only Claude + API can actually fire failover
      return {
        enabled,
        applies: true,
        chain,
      };
    }

    // For claude (cli), codex, and google, return the chain but applies=false
    let reason: string;
    if (effective.vendor === LLM_VENDOR.CLAUDE) {
      reason = "Failover is not available for Claude CLI. Only Claude on the API connection supports failover.";
    } else if (effective.vendor === LLM_VENDOR.CODEX) {
      reason = "Failover is not available for Codex. Only Claude on the API connection supports failover.";
    } else {
      // Google
      reason = "Failover is not available for Google Gemini. Only Claude on the API connection supports failover.";
    }

    return {
      enabled,
      applies: false,
      reason,
      chain,
    };
  }

  // For local and other vendors, return applies=false with empty chain
  let reason: string;
  if (effective.vendor === LLM_VENDOR.LOCAL) {
    reason = "Failover is not available for local models. Only Claude on the API connection supports failover.";
  } else {
    reason = "Failover requires a configured vendor.";
  }

  return {
    enabled,
    applies: false,
    reason,
    chain: [],
  };
}

/** The answers a config adds up to, as opposed to the keys it holds. What the preview returns. */
export type LlmResolution = Pick<
  LlmConfigResponse,
  "effective" | "effectiveProblems" | "tiers" | "failover" | "review"
>;

/**
 * Resolve a snapshot to what a run would do. The one function behind both
 * `GET /api/llm/config` (a snapshot read from disk) and
 * `POST /api/llm/config/preview` (that snapshot with unsaved edits applied), so
 * the preview cannot answer differently from the page it previews.
 */
function resolveLlmConfig(snapshot: ConfigSnapshot): LlmResolution {
  const { effective, llmConfig } = resolveEffectiveAgentConfigFrom(snapshot);
  return {
    effective,
    effectiveProblems: findEffectiveProblems(effective),
    tiers: buildTierTable(effective.vendor, llmConfig, effective),
    failover: buildFailoverInfo(effective, llmConfig),
    review: buildReviewInfo(effective, llmConfig, readHenchReviewSettings(snapshot)),
  };
}

function extractLlmConfig(projectDir: string): LlmConfigResponse {
  const snapshot = readConfigSnapshot(projectDir);
  const config = snapshot.ndx;
  const llm = (config["llm"] ?? {}) as Record<string, unknown>;
  const llmCodex = (llm["codex"] ?? {}) as Record<string, unknown>;
  const llmGoogle = (llm["google"] ?? {}) as Record<string, unknown>;
  const llmLocal = (llm["local"] ?? {}) as Record<string, unknown>;
  const llmLocalVerifier = (llmLocal["verifier"] ?? {}) as Record<string, unknown>;

  // Claude resolves per field across `llm.claude.*` and legacy `claude.*` —
  // the same resolution `loadLLMConfig` and `GET /api/ndx-config` use, so the
  // dashboard shows the value the next run will actually use.
  const claude = resolveClaudeConfig(llm["claude"], config["claude"]);

  const result: LlmConfigResponse = {
    vendor: typeof llm["vendor"] === "string" ? llm["vendor"] : null,
    claude: {
      model: claude.config?.model ?? null,
      lightModel: claude.config?.lightModel ?? null,
    },
    codex: {
      model: getString(llmCodex, "model"),
      lightModel: getString(llmCodex, "lightModel"),
    },
    google: {
      model: getString(llmGoogle, "model"),
      lightModel: getString(llmGoogle, "lightModel"),
    },
    local: {
      model: getString(llmLocal, "model"),
      lightModel: getString(llmLocal, "lightModel"),
      host: getString(llmLocal, "host"),
      port: getNumber(llmLocal, "port"),
      maxContextTokens: getNumber(llmLocal, "maxContextTokens"),
      timeoutMs: getNumber(llmLocal, "timeoutMs"),
      verifier: {
        host: getString(llmLocalVerifier, "host"),
        port: getNumber(llmLocalVerifier, "port"),
        model: getString(llmLocalVerifier, "model"),
        maxCycles: getNumber(llmLocalVerifier, "maxCycles"),
      },
    },
    claudeSources: {
      ...(claude.sources.model ? { model: claude.sources.model } : {}),
      ...(claude.sources.lightModel ? { lightModel: claude.sources.lightModel } : {}),
    },
    agentModels: readAgentModels(config),
    ...resolveLlmConfig(snapshot),
  };

  if (typeof llm["autoFailover"] === "boolean") {
    result.autoFailover = llm["autoFailover"];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Local server health probe
// ---------------------------------------------------------------------------

const DEFAULT_LOCAL_HOST = "localhost";
const DEFAULT_LOCAL_PORT = 1234;
const LOCAL_HEALTH_TIMEOUT_MS = 3_000;

interface LocalStatusResponse {
  ok: boolean;
  url: string;
  models: string[];
  error?: string;
}

/**
 * Detect a refused TCP connection from a failed `fetch()`.
 *
 * Node's native `fetch` (undici) never puts "ECONNREFUSED" in `err.message` —
 * a refused connection surfaces as `TypeError: fetch failed`, with the real
 * code nested in `err.cause.code` (or, for a dual-stack connect attempt,
 * inside an AggregateError's `err.cause.errors[]`). Checking `err.message`
 * alone (the previous implementation) could never match the single most
 * common failure here: the local server just isn't running yet.
 */
function isConnectionRefused(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.includes("ECONNREFUSED")) return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    if ((cause as { code?: unknown }).code === "ECONNREFUSED") return true;
    const nested = (cause as { errors?: unknown }).errors;
    if (Array.isArray(nested)) {
      return nested.some(
        (e) => e && typeof e === "object" && (e as { code?: unknown }).code === "ECONNREFUSED",
      );
    }
  }
  return false;
}

async function probeLocalServer(
  host: string,
  port: number,
): Promise<LocalStatusResponse> {
  const url = `http://${host}:${port}/v1/models`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOCAL_HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, url, models: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json() as { data?: Array<{ id: string }> };
    const models = (data.data ?? [])
      .map((m) => (typeof m.id === "string" ? m.id : ""))
      .filter(Boolean);
    return { ok: true, url, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = msg.includes("abort") || msg.includes("Cancel")
      ? "Timed out — is LM Studio running?"
      : isConnectionRefused(err)
        ? "Connection refused — check host/port"
        : msg;
    return { ok: false, url, models: [], error: friendly };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Local inference smoke test
// ---------------------------------------------------------------------------

const SMOKE_TEST_TIMEOUT_MS = 30_000; // local models can be slow to first token
const SMOKE_PROMPT = "Reply with only the word OK.";

interface SmokeTestResponse {
  ok: boolean;
  latencyMs: number;
  tokensPerSecond: number | null;
  outputTokens: number | null;
  reply: string | null;
  error?: string;
  url: string;
}

async function runSmokeTest(
  host: string,
  port: number,
  model: string,
): Promise<SmokeTestResponse> {
  const url = `http://${host}:${port}/v1/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SMOKE_TEST_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: SMOKE_PROMPT }],
      max_tokens: 16,
      temperature: 0,
    };
    if (model) body.model = model;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    const latencyMs = Date.now() - t0;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, latencyMs, tokensPerSecond: null, outputTokens: null, reply: null, error: `HTTP ${res.status}: ${text.slice(0, 120)}`, url };
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { completion_tokens?: number };
    };

    const reply = data.choices?.[0]?.message?.content?.trim() ?? null;
    const outputTokens = data.usage?.completion_tokens ?? null;
    const tokensPerSecond = outputTokens && latencyMs > 0
      ? Math.round((outputTokens / latencyMs) * 1000 * 10) / 10
      : null;

    return { ok: true, latencyMs, tokensPerSecond, outputTokens, reply, url };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = msg.includes("abort") || msg.includes("Cancel")
      ? `Timed out after ${SMOKE_TEST_TIMEOUT_MS / 1000}s — model may still be loading`
      : isConnectionRefused(err)
        ? "Connection refused — is LM Studio running?"
        : msg;
    return { ok: false, latencyMs, tokensPerSecond: null, outputTokens: null, reply: null, error: friendly, url };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Local profiles
// ---------------------------------------------------------------------------

export interface LocalProfile {
  name: string;
  host: string;
  port: number;
  model: string;
}

function readProfiles(projectDir: string): LocalProfile[] {
  const config = readNdxConfig(projectDir);
  const llm = (config["llm"] ?? {}) as Record<string, unknown>;
  const local = (llm["local"] ?? {}) as Record<string, unknown>;
  const raw = local["profiles"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is LocalProfile =>
      typeof p === "object" && p !== null &&
      typeof (p as Record<string, unknown>)["name"] === "string" &&
      typeof (p as Record<string, unknown>)["host"] === "string" &&
      typeof (p as Record<string, unknown>)["port"] === "number",
  ).map((p) => ({
    name: (p as LocalProfile).name,
    host: (p as LocalProfile).host,
    port: (p as LocalProfile).port,
    model: typeof (p as LocalProfile).model === "string" ? (p as LocalProfile).model : "",
  }));
}

function writeProfilesConfig(projectDir: string, profiles: LocalProfile[]): void {
  const config = readNdxConfig(projectDir);
  setByPath(config, "llm.local.profiles", profiles);
  writeNdxConfig(projectDir, config);
}

// ---------------------------------------------------------------------------
// Vendor/provider/model catalog
// ---------------------------------------------------------------------------

/** One cloud vendor's catalog entry: the models to offer and the provider choices hench accepts. */
export interface VendorCatalogEntry {
  models: string[];
  providers: Array<"cli" | "api">;
  /**
   * The model `ndx work` runs for this vendor with no `hench.models.<vendor>`
   * set: `llm.<vendor>.model` (legacy `claude.model` for Claude), else the
   * vendor default.
   */
  defaultModel: string;
  /** `"live"` when `models` came from the vendor's Models API, else the built-in list. */
  source: "live" | "built-in";
  /** ISO time of the live fetch; null when `source` is `"built-in"`. */
  checkedAt: string | null;
  /** Why the built-in list is shown. Present only when `source` is `"built-in"`. */
  reason?: string;
  /** Whether the vendor can run as configured, judged for the provider it would run on. */
  readiness: VendorReadiness;
}

/** A vendor entry whose CLI is installed locally, with what `<binary> --version` reported. */
export interface CliVendorCatalogEntry extends VendorCatalogEntry {
  cli: CliInfo;
}

/**
 * The local vendor's catalog entry. `models` comes from a live probe of the
 * configured local server rather than a static catalog, so an unreachable
 * server answers with an empty list and a `reason` instead of failing the
 * whole response.
 */
export interface LocalCatalogEntry {
  models: string[];
  providers: Array<"cli" | "api">;
  defaultModel: string;
  reachable: boolean;
  reason?: string;
  readiness: VendorReadiness;
}

/** Shape returned by GET /api/llm/catalog. */
export interface LlmCatalogResponse {
  claude: CliVendorCatalogEntry;
  codex: CliVendorCatalogEntry;
  google: VendorCatalogEntry;
  local: LocalCatalogEntry;
}

/**
 * Every model id llm-client's catalog knows for `vendor`: the union of its
 * `TIER_MODELS` (light/standard/heavy) and every `MODEL_COSTS` entry that
 * belongs to the vendor — the same cost table the dashboard's spend views and
 * `ndx usage` price a run against. Sorted for a stable response.
 */
function cloudVendorModels(vendor: LLMVendor): string[] {
  const tierModels = Object.values(TIER_MODELS[vendor]).filter((m): m is string => Boolean(m));
  const catalogModels = Object.keys(MODEL_COSTS).filter((id) => isModelCompatibleWithVendor(vendor, id));
  return [...new Set([...tierModels, ...catalogModels])].sort();
}

/**
 * Refuse a per-run model the active vendor's catalog does not offer — the
 * check behind an execute request's `options.model` / `options.reviewModel`.
 * The catalog is GET /api/llm/catalog's: the built-in list, plus the live
 * list. The live list is fetched (through the catalog's cache) only when the
 * built-in list misses, so a built-in model never waits on a vendor API —
 * while a live-only model the modal offered still passes once the cache has
 * expired, which a peek at the cache alone would refuse. `local` runs
 * whatever its server has loaded, so any id passes there, as it does for a
 * config write. Returns an error, or null.
 */
export async function validateCatalogModel(
  projectDir: string,
  vendor: string | null,
  model: string,
): Promise<string | null> {
  if (vendor === LLM_VENDOR.LOCAL) return null;
  if (vendor !== LLM_VENDOR.CLAUDE && vendor !== LLM_VENDOR.CODEX && vendor !== LLM_VENDOR.GOOGLE) {
    return `No LLM vendor is configured (llm.vendor), so model "${model}" cannot be checked.`;
  }
  if (!isModelCompatibleWithVendor(vendor, model)) return `Model "${model}" is not a ${vendor} model.`;
  if (cloudVendorModels(vendor).includes(model)) return null;
  if (vendor !== LLM_VENDOR.GOOGLE) {
    const live = await getLiveVendorProbe(vendor, projectDir);
    if (live.listing.ok && live.listing.models.includes(model)) return null;
  }
  return `Model "${model}" is not in the ${vendor} catalog.`;
}

/**
 * Build the vendor/model/provider catalog: cloud-vendor models from
 * llm-client's catalog, local models from a live probe of the configured
 * local server, and provider choices from {@link VENDOR_PROVIDERS} — the
 * literal pinned against hench's own table by the cross-package contract
 * test (see that file's doc comment for why web keeps a copy at all).
 */
export async function buildLlmCatalog(projectDir: string, refresh: boolean): Promise<LlmCatalogResponse> {
  const snapshot = readConfigSnapshot(projectDir);
  const config = snapshot.ndx;
  const llmConfig = parseLLMConfig(config);
  // The model `ndx work` would run with no `hench.models.<vendor>` — resolved
  // through the same chain as `effective`, minus the hench override rung.
  const defaultModel = (vendor: LLMVendor): string =>
    resolveEffectiveAgentModel(vendor, undefined, llmConfig).model;
  const [claudeProbe, codexProbe] = await Promise.all([
    getLiveVendorProbe(LLM_VENDOR.CLAUDE, projectDir, { refresh }),
    getLiveVendorProbe(LLM_VENDOR.CODEX, projectDir, { refresh }),
  ]);
  const henchProvider = readHenchAgentSettings(snapshot).provider;
  const cliEntry = (
    vendor: ListableVendor,
    probe: LiveVendorProbe,
    readiness: VendorReadiness,
  ): CliVendorCatalogEntry => {
    const builtIn = cloudVendorModels(vendor);
    const live = probe.listing.ok;
    return {
      models: probe.listing.ok ? probe.listing.models : builtIn,
      providers: [...VENDOR_PROVIDERS[vendor]],
      defaultModel: defaultModel(vendor),
      source: live ? "live" : "built-in",
      checkedAt: live ? probe.checkedAt : null,
      ...(probe.listing.ok ? {} : { reason: probe.listing.reason }),
      readiness,
      cli: probe.cli,
    };
  };
  const llm = (config["llm"] ?? {}) as Record<string, unknown>;
  const llmLocal = (llm["local"] ?? {}) as Record<string, unknown>;
  const host = typeof llmLocal["host"] === "string" && llmLocal["host"]
    ? llmLocal["host"]
    : DEFAULT_LOCAL_HOST;
  const port = typeof llmLocal["port"] === "number" && llmLocal["port"] > 0
    ? llmLocal["port"]
    : DEFAULT_LOCAL_PORT;
  const localStatus = await probeLocalServer(host, port);

  return {
    claude: cliEntry(
      LLM_VENDOR.CLAUDE,
      claudeProbe,
      claudeReadiness(resolveEffectiveProvider(LLM_VENDOR.CLAUDE, henchProvider), claudeProbe.cli, llmConfig),
    ),
    codex: cliEntry(LLM_VENDOR.CODEX, codexProbe, codexReadiness(codexProbe.cli)),
    google: {
      models: cloudVendorModels(LLM_VENDOR.GOOGLE),
      providers: [...VENDOR_PROVIDERS.google],
      defaultModel: defaultModel(LLM_VENDOR.GOOGLE),
      source: "built-in",
      checkedAt: null,
      reason: "No live model list for google",
      readiness: googleReadiness(llmConfig),
    },
    local: {
      models: localStatus.ok ? localStatus.models : [],
      providers: [...VENDOR_PROVIDERS.local],
      defaultModel: defaultModel(LLM_VENDOR.LOCAL),
      reachable: localStatus.ok,
      ...(localStatus.ok ? {} : { reason: localStatus.error ?? "Local server unreachable" }),
      readiness: localReadiness(localStatus.ok, `${host}:${port}`),
    },
  };
}

// ---------------------------------------------------------------------------
// Edits: validation and application, shared by PUT and the preview
// ---------------------------------------------------------------------------

/** The vendor a request leaves active, for judging a reviewer saved alongside `llm.vendor` as a pair. */
function vendorAfter(changes: LlmConfigPutBody["changes"], projectDir: string): string | null {
  if (!("llm.vendor" in changes)) return resolveActiveVendor(projectDir);
  return changes["llm.vendor"] ? String(changes["llm.vendor"]) : null;
}

/**
 * Why one `changes` entry would be refused, or null when it is acceptable.
 * PUT answers 400 on the first refusal; the preview reports every one.
 */
function validateLlmChange(
  path: string,
  value: string | boolean | number | null,
  vendorAfterChanges: string | null,
): string | null {
  // Legacy keys are read until 1.0.0 but never written. Refusing with the
  // replacement named beats the generic "unknown path" below, which would
  // leave a caller guessing that the key it can still *read* is not one
  // it may set.
  const replacement = DEPRECATED_WRITE_PATHS[path];
  if (replacement) {
    return `"${path}" is a deprecated key and is no longer written. Set "${replacement}" instead — ` +
      `the legacy value is still read until 1.0.0 and is left untouched.`;
  }
  if (!isWritablePath(path)) {
    return `Unknown LLM config path: "${path}". Valid paths: ${[...VALID_PATHS].join(", ")}, or llm.tiers.<vendor>.<tier> / llm.routes.<class> / llm.effort.<class>`;
  }
  if (BOOLEAN_PATHS.has(path)) {
    if (value !== null && typeof value !== "boolean") {
      return `Value for "${path}" must be a boolean or null, got ${typeof value}`;
    }
  } else if (NUMERIC_PATHS.has(path)) {
    // Accept a number, or a numeric string that we'll coerce to a number
    if (value !== null && typeof value !== "number" && typeof value !== "string") {
      return `Value for "${path}" must be a number or null, got ${typeof value}`;
    }
    if (value !== null && (PORT_PATHS.has(path) || NON_NEGATIVE_PATHS.has(path))) {
      const n = Number(value);
      const isPort = PORT_PATHS.has(path);
      const valid = isPort
        ? Number.isInteger(n) && n >= 1 && n <= 65535
        : Number.isInteger(n) && n >= 0;
      if (!valid) {
        const expected = isPort ? "a valid port number (1–65535)" : "a non-negative integer";
        return `Value for "${path}" must be ${expected}, got ${JSON.stringify(value)}`;
      }
    }
  } else if (value !== null && typeof value !== "string") {
    return `Value for "${path}" must be a string or null, got ${typeof value}`;
  }
  if (path === "llm.vendor" && value !== null && !VALID_VENDORS.has(value.toString())) {
    return `llm.vendor must be one of: ${[...VALID_VENDORS].join(", ")}; got "${value}"`;
  }
  // Routing paths carry their own shape and enum rules. Skipped for a
  // null/"" value, which is a delete rather than a set.
  if (value !== null && value !== "") {
    const routingError = validateRoutingChange(path, value);
    if (routingError) return routingError;
  }
  return validateModelForVendor(path, value) ?? validateReviewChange(path, value, vendorAfterChanges);
}

/** Apply one validated change to a parsed `.n-dx.json`, in memory. */
function applyLlmChange(
  config: Record<string, unknown>,
  path: string,
  value: string | boolean | number | null,
): void {
  if (value === null || value === "") {
    deleteByPath(config, path);
    if (AGENT_MODEL_PATH.test(path) || HENCH_REVIEW_PATHS.has(path)) pruneEmptyHenchSections(config);
  } else if (NUMERIC_PATHS.has(path)) {
    // Coerce string port values to numbers before persisting
    setByPath(config, path, Number(value));
  } else {
    setByPath(config, path, value);
  }
}

/** Shape expected by POST /api/llm/config/preview: PUT's body, plus the provider the page saves through `/api/hench/config`. */
interface LlmPreviewBody {
  changes?: LlmConfigPutBody["changes"];
  /** `.hench/config.json`'s `provider`; null clears it. */
  provider?: string | null;
}

/** An edit the preview did not apply, with the reason PUT (or `/api/hench/config`) would refuse it. */
export interface EditProblem {
  path: string;
  message: string;
}

/** Shape returned by POST /api/llm/config/preview. */
export interface LlmPreviewResponse extends LlmResolution {
  /** Edits that were refused and so are absent from the resolution above. */
  editProblems: EditProblem[];
}

/**
 * Resolve the saved config with unsaved edits applied in memory.
 *
 * Refused edits are reported and left out rather than failing the request: the
 * page is asking what *would* run, and an edit it is still typing is a
 * question, not an error.
 */
function previewLlmConfig(projectDir: string, body: LlmPreviewBody): LlmPreviewResponse {
  const changes = body.changes ?? {};
  const vendorAfterChanges = vendorAfter(changes, projectDir);

  const editProblems: EditProblem[] = [];
  const accepted: Array<[string, string | boolean | number | null]> = [];
  for (const [path, value] of Object.entries(changes)) {
    const message = validateLlmChange(path, value, vendorAfterChanges);
    if (message) editProblems.push({ path, message });
    else accepted.push([path, value]);
  }
  let provider: string | null | undefined;
  if (body.provider !== undefined) {
    const message = body.provider === null
      ? null
      : validateConfigKeyValue("provider", body.provider, vendorAfterChanges);
    if (message) editProblems.push({ path: "provider", message });
    else provider = body.provider;
  }

  const snapshot = readConfigSnapshot(projectDir, (sources) => {
    for (const [path, value] of accepted) applyLlmChange(sources.shared, path, value);
    if (provider === null) delete sources.hench["provider"];
    else if (provider !== undefined) sources.hench["provider"] = provider;
  });
  return { ...resolveLlmConfig(snapshot), editProblems };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const LLM_PREFIX = "/api/llm/config";
const LLM_PREVIEW = "/api/llm/config/preview";
const LLM_CATALOG = "/api/llm/catalog";
const LLM_LOCAL_STATUS = "/api/llm/local-status";
const LLM_LOCAL_TEST = "/api/llm/local-test";
const LLM_LOCAL_PROFILES = "/api/llm/local-profiles";

/** Handle LLM config API requests. Returns true if the request was handled. */
export async function handleLlmRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";
  // Query-string-free form for exact-equality route matching below — `url`
  // itself is kept intact because the DELETE branch further down still needs
  // its query string (?name=...) to reach `new URL(url, ...)`.
  const pathname = url.split("?")[0];

  // GET /api/llm/local-profiles — list saved local profiles
  if (method === "GET" && pathname === LLM_LOCAL_PROFILES) {
    jsonResponse(res, 200, { profiles: readProfiles(ctx.projectDir) });
    return true;
  }

  // POST /api/llm/local-profiles — create or update a named profile
  if (method === "POST" && pathname === LLM_LOCAL_PROFILES) {
    try {
      const body = await readBody(req, res);
      const data = JSON.parse(body) as Partial<LocalProfile>;
      if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
        errorResponse(res, 400, "Profile 'name' is required");
        return true;
      }
      const profile: LocalProfile = {
        name: data.name.trim(),
        host: typeof data.host === "string" && data.host ? data.host : DEFAULT_LOCAL_HOST,
        port: typeof data.port === "number" && data.port > 0 ? data.port : DEFAULT_LOCAL_PORT,
        model: typeof data.model === "string" ? data.model : "",
      };
      const existing = readProfiles(ctx.projectDir);
      const idx = existing.findIndex((p) => p.name === profile.name);
      const profiles = idx >= 0
        ? existing.map((p, i) => (i === idx ? profile : p))
        : [...existing, profile];
      writeProfilesConfig(ctx.projectDir, profiles);
      jsonResponse(res, 200, { profiles });
    } catch (err) {
      errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
    }
    return true;
  }

  // DELETE /api/llm/local-profiles?name=... — remove a named profile
  if (method === "DELETE" && url.startsWith(LLM_LOCAL_PROFILES)) {
    const parsedUrl = new URL(url, "http://localhost");
    const name = parsedUrl.searchParams.get("name");
    if (!name) {
      errorResponse(res, 400, "Query param 'name' is required");
      return true;
    }
    const profiles = readProfiles(ctx.projectDir).filter((p) => p.name !== name);
    writeProfilesConfig(ctx.projectDir, profiles);
    jsonResponse(res, 200, { profiles });
    return true;
  }

  // POST /api/llm/local-test — run a real inference smoke test.
  // Optional JSON body: { host?, port?, model? } — overrides saved config so
  // the client can test unsaved edit values without saving first.
  if (method === "POST" && pathname === LLM_LOCAL_TEST) {
    const config = readEffectiveNdxConfig(ctx.projectDir);
    const llm = (config["llm"] ?? {}) as Record<string, unknown>;
    const llmLocal = (llm["local"] ?? {}) as Record<string, unknown>;
    // Saved config defaults
    let host = typeof llmLocal["host"] === "string" && llmLocal["host"]
      ? llmLocal["host"] : DEFAULT_LOCAL_HOST;
    let port = typeof llmLocal["port"] === "number" && llmLocal["port"] > 0
      ? llmLocal["port"] : DEFAULT_LOCAL_PORT;
    let model = typeof llmLocal["model"] === "string" ? llmLocal["model"] : "";
    // Allow body overrides for unsaved edit values
    try {
      const rawBody = await readBody(req, res);
      if (rawBody.trim()) {
        const body = JSON.parse(rawBody) as Partial<{ host: string; port: number; model: string }>;
        if (typeof body.host === "string" && body.host) host = body.host;
        if (typeof body.port === "number" && body.port > 0) port = body.port;
        if (typeof body.model === "string") model = body.model;
      }
    } catch {
      // Body is optional — malformed JSON falls back to saved config
    }
    const result = await runSmokeTest(host, port, model);
    jsonResponse(res, 200, result);
    return true;
  }

  // GET /api/llm/local-status — probe the configured local LLM server
  if (method === "GET" && pathname === LLM_LOCAL_STATUS) {
    const config = readEffectiveNdxConfig(ctx.projectDir);
    const llm = (config["llm"] ?? {}) as Record<string, unknown>;
    const llmLocal = (llm["local"] ?? {}) as Record<string, unknown>;
    const host = typeof llmLocal["host"] === "string" && llmLocal["host"]
      ? llmLocal["host"]
      : DEFAULT_LOCAL_HOST;
    const port = typeof llmLocal["port"] === "number" && llmLocal["port"] > 0
      ? llmLocal["port"]
      : DEFAULT_LOCAL_PORT;
    const result = await probeLocalServer(host, port);
    jsonResponse(res, 200, result);
    return true;
  }

  // GET /api/llm/config
  if (method === "GET" && pathname === LLM_PREFIX) {
    jsonResponse(res, 200, extractLlmConfig(ctx.projectDir));
    return true;
  }

  // POST /api/llm/config/preview — what would run with these unsaved edits.
  // Writes nothing; POST only because the body is too structured for a query
  // string. The request gate treats it like any other POST.
  if (method === "POST" && pathname === LLM_PREVIEW) {
    let body: LlmPreviewBody;
    try {
      const raw = await readBody(req, res);
      body = raw.trim() ? JSON.parse(raw) as LlmPreviewBody : {};
    } catch {
      errorResponse(res, 400, "Invalid JSON in request body");
      return true;
    }
    const { changes, provider } = body ?? {};
    if (
      body === null || typeof body !== "object" || Array.isArray(body) ||
      (changes !== undefined && (changes === null || typeof changes !== "object" || Array.isArray(changes))) ||
      (provider !== undefined && provider !== null && typeof provider !== "string")
    ) {
      errorResponse(res, 400, "Request body must be an object with an optional 'changes' object and an optional 'provider' string or null");
      return true;
    }
    jsonResponse(res, 200, previewLlmConfig(ctx.projectDir, body));
    return true;
  }

  // GET /api/llm/catalog — models to offer and provider choices, per vendor
  if (method === "GET" && pathname === LLM_CATALOG) {
    const refresh = new URL(url, "http://localhost").searchParams.get("refresh") === "true";
    jsonResponse(res, 200, await buildLlmCatalog(ctx.projectDir, refresh));
    return true;
  }

  // PUT /api/llm/config
  if (method === "PUT" && pathname === LLM_PREFIX) {
    try {
      const body = await readBody(req, res);
      const parsed = JSON.parse(body) as LlmConfigPutBody;

      if (!parsed.changes || typeof parsed.changes !== "object") {
        errorResponse(res, 400, "Request body must include a 'changes' object");
        return true;
      }

      const vendorAfterChanges = vendorAfter(parsed.changes, ctx.projectDir);
      for (const [path, value] of Object.entries(parsed.changes)) {
        const problem = validateLlmChange(path, value, vendorAfterChanges);
        if (problem) {
          errorResponse(res, 400, problem);
          return true;
        }
      }

      const config = readNdxConfig(ctx.projectDir);
      const applied: string[] = [];
      for (const [path, value] of Object.entries(parsed.changes)) {
        applyLlmChange(config, path, value);
        applied.push(path);
      }

      writeNdxConfig(ctx.projectDir, config);
      // The credential check's answer depends on this config — drop the
      // cached result so the auth chip re-verifies against the new settings.
      invalidateAuthCheckCache();
      // A new key, binary path or model changes what the live probe would see.
      clearLlmCatalogCache(ctx.projectDir);
      jsonResponse(res, 200, { applied, config: extractLlmConfig(ctx.projectDir) });
      return true;
    } catch (err) {
      errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
      return true;
    }
  }

  return false;
}
