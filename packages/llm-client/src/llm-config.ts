/**
 * Vendor-neutral configuration loader.
 *
 * Reads `.n-dx.json` and returns an `LLMConfig` object that supports both
 * a new `llm` section and legacy `claude` settings.
 */

import { join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { deepMerge } from "./project-config.js";
import {
  LLM_VENDOR,
  isLLMVendor,
  type LLMConfig,
  type LLMVendor,
  type CodexConfig,
  type GoogleConfig,
  type LocalConfig,
  type LocalVerifierConfig,
} from "./llm-types.js";
import type { ClaudeConfig } from "./types.js";
import { normalizeCodexModel } from "./config.js";

const PROJECT_CONFIG_FILE = ".n-dx.json";
const LOCAL_CONFIG_FILE = ".n-dx.local.json";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function extractVendor(value: unknown): LLMVendor | undefined {
  return isLLMVendor(value) ? value : undefined;
}

function extractLocalVerifierConfig(value: unknown): LocalVerifierConfig | undefined {
  const v = asRecord(value);
  if (!v) return undefined;

  const cfg: LocalVerifierConfig = {};
  if (typeof v.host === "string" && v.host) cfg.host = v.host;
  if (typeof v.port === "number" && v.port > 0) cfg.port = v.port;
  if (typeof v.model === "string" && v.model) cfg.model = v.model;
  if (typeof v.maxCycles === "number" && v.maxCycles >= 0) cfg.maxCycles = v.maxCycles;
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

function extractLocalConfig(value: unknown): LocalConfig | undefined {
  const v = asRecord(value);
  if (!v) return undefined;

  // This function whitelists keys — a key it does not copy never reaches
  // runtime no matter what .n-dx.json says. It previously copied only
  // host/port/model/lightModel, which silently disabled every other
  // documented llm.local setting (timeoutMs, maxContextTokens, reviewModel,
  // verifier): operators set them, the loader dropped them, and the loop saw
  // its defaults.
  const cfg: LocalConfig = {};
  if (typeof v.host === "string" && v.host) cfg.host = v.host;
  if (typeof v.port === "number" && v.port > 0) cfg.port = v.port;
  if (typeof v.model === "string" && v.model) cfg.model = v.model;
  if (typeof v.lightModel === "string" && v.lightModel) cfg.lightModel = v.lightModel;
  if (typeof v.reviewModel === "string" && v.reviewModel) cfg.reviewModel = v.reviewModel;
  if (typeof v.maxContextTokens === "number" && v.maxContextTokens > 0) {
    cfg.maxContextTokens = v.maxContextTokens;
  }
  // 0 is meaningful for timeoutMs (= wait indefinitely), so accept >= 0.
  if (typeof v.timeoutMs === "number" && v.timeoutMs >= 0) cfg.timeoutMs = v.timeoutMs;
  const verifier = extractLocalVerifierConfig(v.verifier);
  if (verifier) cfg.verifier = verifier;
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

function extractGoogleConfig(value: unknown): GoogleConfig | undefined {
  const v = asRecord(value);
  if (!v) return undefined;

  const cfg: GoogleConfig = {};
  if (typeof v.api_key === "string" && v.api_key) cfg.api_key = v.api_key;
  if (typeof v.api_endpoint === "string" && v.api_endpoint) cfg.api_endpoint = v.api_endpoint;
  if (typeof v.model === "string" && v.model) cfg.model = v.model;
  if (typeof v.lightModel === "string" && v.lightModel) cfg.lightModel = v.lightModel;
  if (typeof v.reviewModel === "string" && v.reviewModel) cfg.reviewModel = v.reviewModel;
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

function extractClaudeConfig(value: unknown): ClaudeConfig | undefined {
  const v = asRecord(value);
  if (!v) return undefined;

  const cfg: ClaudeConfig = {};
  if (typeof v.cli_path === "string" && v.cli_path) cfg.cli_path = v.cli_path;
  if (typeof v.api_key === "string" && v.api_key) cfg.api_key = v.api_key;
  if (typeof v.api_endpoint === "string" && v.api_endpoint) cfg.api_endpoint = v.api_endpoint;
  if (typeof v.model === "string" && v.model) cfg.model = v.model;
  if (typeof v.lightModel === "string" && v.lightModel) cfg.lightModel = v.lightModel;
  if (typeof v.reviewModel === "string" && v.reviewModel) cfg.reviewModel = v.reviewModel;
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

/** Which of the two config locations a resolved Claude field came from. */
export type ClaudeFieldSource = "llm" | "legacy";

/** The outcome of {@link resolveClaudeConfig}: merged values plus their origins. */
export interface ResolvedClaudeConfig {
  /** Merged config, or undefined when neither location set any field. */
  config: ClaudeConfig | undefined;
  /** Origin of each field that resolved to a value. Absent fields are omitted. */
  sources: Partial<Record<keyof ClaudeConfig, ClaudeFieldSource>>;
}

/** The fields a Claude config carries, and which both locations may set. */
const CLAUDE_FIELDS = ["cli_path", "api_key", "api_endpoint", "model", "lightModel", "reviewModel"] as const;

/**
 * Resolve the modern `llm.claude` block against the legacy top-level `claude`
 * block, **per field**: each field is `new ?? old` on its own.
 *
 * Until 1.0.0 both locations are read. This used to be a block-level choice
 * (`llmClaude ?? legacyClaude`), which meant a modern block setting a single
 * field shadowed every legacy field beside it — a project that set
 * `claude.api_key` once and later pinned `llm.claude.model` silently lost the
 * key, with nothing to say so. Resolving field by field is what
 * `loadLLMConfig`, `GET /api/llm/config` and `GET /api/ndx-config` all share,
 * so the CLI and the dashboard cannot disagree about which value wins.
 *
 * `sources` is what lets the dashboard mark a value as still coming from a
 * deprecated key; writes always go to `llm.claude.*`.
 *
 * Both arguments are raw `.n-dx.json` fragments — anything non-object, and any
 * field that is not a non-empty string, is ignored rather than thrown on.
 */
export function resolveClaudeConfig(modern: unknown, legacy: unknown): ResolvedClaudeConfig {
  const llmBlock = extractClaudeConfig(modern);
  const legacyBlock = extractClaudeConfig(legacy);

  const config: ClaudeConfig = {};
  const sources: Partial<Record<keyof ClaudeConfig, ClaudeFieldSource>> = {};

  for (const field of CLAUDE_FIELDS) {
    const fromLlm = llmBlock?.[field];
    if (fromLlm !== undefined) {
      config[field] = fromLlm;
      sources[field] = "llm";
      continue;
    }
    const fromLegacy = legacyBlock?.[field];
    if (fromLegacy !== undefined) {
      config[field] = fromLegacy;
      sources[field] = "legacy";
    }
  }

  return Object.keys(config).length > 0 ? { config, sources } : { config: undefined, sources: {} };
}

function extractCodexConfig(value: unknown): CodexConfig | undefined {
  const v = asRecord(value);
  if (!v) return undefined;

  const cfg: CodexConfig = {};
  if (typeof v.cli_path === "string" && v.cli_path) cfg.cli_path = v.cli_path;
  if (typeof v.api_key === "string" && v.api_key) cfg.api_key = v.api_key;
  if (typeof v.api_endpoint === "string" && v.api_endpoint) cfg.api_endpoint = v.api_endpoint;
  if (typeof v.model === "string" && v.model) cfg.model = normalizeCodexModel(v.model);
  if (typeof v.lightModel === "string" && v.lightModel) cfg.lightModel = normalizeCodexModel(v.lightModel);
  if (typeof v.reviewModel === "string" && v.reviewModel) cfg.reviewModel = normalizeCodexModel(v.reviewModel);
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

/** Extract a flat string→string map, dropping non-string or empty values. */
function extractStringMap(value: unknown): Record<string, string> | undefined {
  const v = asRecord(value);
  if (!v) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(v)) {
    if (typeof entry === "string" && entry) out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const TASK_TIER_KEYS = new Set(["light", "standard", "heavy", "free"]);

function extractTiers(value: unknown): LLMConfig["tiers"] {
  const v = asRecord(value);
  if (!v) return undefined;
  const out: NonNullable<LLMConfig["tiers"]> = {};
  for (const [vendor, tierValue] of Object.entries(v)) {
    if (!isLLMVendor(vendor)) continue;
    const tierMap = extractStringMap(tierValue);
    if (!tierMap) continue;
    const tiers: Record<string, string> = {};
    for (const [tier, model] of Object.entries(tierMap)) {
      if (TASK_TIER_KEYS.has(tier)) tiers[tier] = model;
    }
    if (Object.keys(tiers).length > 0) {
      out[vendor] = tiers as NonNullable<LLMConfig["tiers"]>[LLMVendor];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function extractEscalation(value: unknown): LLMConfig["escalation"] {
  const v = asRecord(value);
  if (!v) return undefined;
  const out: NonNullable<LLMConfig["escalation"]> = {};
  if (typeof v.enabled === "boolean") out.enabled = v.enabled;
  if (typeof v.maxSteps === "number" && v.maxSteps >= 0) out.maxSteps = v.maxSteps;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Load and parse a JSON file, returning null on failure.
 */
async function loadJSONFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    return asRecord(data) ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract an LLMConfig from a merged root object.
 */
function extractLLMConfig(root: Record<string, unknown>): LLMConfig {
  const llm = asRecord(root.llm);
  const llmVendor = extractVendor(llm?.vendor);
  const claude = resolveClaudeConfig(llm?.claude, root.claude).config;
  const llmCodex = extractCodexConfig(llm?.codex);
  const llmGoogle = extractGoogleConfig(llm?.google);
  const llmLocal = extractLocalConfig(llm?.local);
  const autoFailover =
    typeof llm?.autoFailover === "boolean" ? llm.autoFailover : undefined;
  const rawTopLevelModel =
    typeof llm?.model === "string" && llm.model ? llm.model : undefined;

  const config: LLMConfig = {};
  if (llmVendor) config.vendor = llmVendor;
  if (rawTopLevelModel) {
    // Normalize codex aliases at load time when the active vendor is codex
    // so downstream resolvers see a canonical model id. For claude, the
    // shorthand→full-id expansion happens later in `resolveModel()`.
    config.model =
      llmVendor === LLM_VENDOR.CODEX ? normalizeCodexModel(rawTopLevelModel) : rawTopLevelModel;
  }
  const rawReviewModel =
    typeof llm?.reviewModel === "string" && llm.reviewModel ? llm.reviewModel : undefined;
  if (rawReviewModel) {
    config.reviewModel =
      llmVendor === LLM_VENDOR.CODEX ? normalizeCodexModel(rawReviewModel) : rawReviewModel;
  }
  if (claude) config.claude = claude;
  if (llmCodex) config.codex = llmCodex;
  if (llmGoogle) config.google = llmGoogle;
  if (llmLocal) config.local = llmLocal;
  if (autoFailover !== undefined) config.autoFailover = autoFailover;

  // Routing surfaces for resolveTaskModel. Extracted explicitly — this
  // function whitelists keys, and a key it does not copy never reaches
  // runtime no matter what .n-dx.json says.
  const tiers = extractTiers(llm?.tiers);
  if (tiers) config.tiers = tiers;
  const routes = extractStringMap(llm?.routes);
  if (routes) config.routes = routes;
  const effort = extractStringMap(llm?.effort);
  if (effort) config.effort = effort;
  const escalation = extractEscalation(llm?.escalation);
  if (escalation) config.escalation = escalation;
  return config;
}

/**
 * Load the vendor-neutral LLM config from `.n-dx.json`,
 * with `.n-dx.local.json` overrides merged on top (local wins).
 *
 * Merge behavior:
 * - Reads `llm.vendor` if present.
 * - Reads `llm.claude`/`llm.codex` blocks when present.
 * - Falls back to the legacy top-level `claude` block **per field** — see
 *   {@link resolveClaudeConfig}.
 */
export async function loadLLMConfig(dir: string): Promise<LLMConfig> {
  const projectData = await loadJSONFile(join(dir, PROJECT_CONFIG_FILE));
  const localData = await loadJSONFile(join(dir, LOCAL_CONFIG_FILE));

  // Merge project and local configs (local wins)
  let merged: Record<string, unknown> | null = projectData;
  if (projectData && localData) {
    merged = deepMerge(projectData, localData);
  } else if (localData) {
    merged = localData;
  }

  if (!merged) return {};
  return extractLLMConfig(merged);
}
