/**
 * Sourcevision LLM bridge — uses @n-dx/llm-client for vendor-aware access.
 */

import type {
  ClaudeConfig,
  ClaudeClient,
  AuthMode,
  CompletionResult,
  LLMConfig,
  LLMVendor,
} from "@n-dx/llm-client";
import {
  DEFAULT_LLM_VENDOR,
  createLLMClient,
  detectLLMAuthMode,
  ClaudeClientError,
  NEWEST_MODELS,
  resolveVendorModel,
  resolveTaskModel,
} from "@n-dx/llm-client";
import type { TokenUsage } from "../schema/index.js";

export { ClaudeClientError } from "@n-dx/llm-client";

// Derived from the single canonical source in @n-dx/llm-client so that
// updating a vendor's newest model requires only one edit.
export const DEFAULT_MODEL = NEWEST_MODELS.claude;
export const DEFAULT_CODEX_MODEL = NEWEST_MODELS.codex;

// ── Module-level state ────────────────────────────────────────────────────────

let _llmConfig: LLMConfig | undefined;
let _llmClient: ClaudeClient | undefined;

function resolveVendor(): LLMVendor {
  return _llmConfig?.vendor ?? DEFAULT_LLM_VENDOR;
}

function resolveModel(override?: string): string {
  if (override) return override;
  return resolveVendorModel(resolveVendor(), _llmConfig ?? {});
}

/**
 * Resolve the configured "light" tier model for the active vendor. Used by
 * enrichment to send naming-dominant pass 1 prompts to a cheaper/faster
 * model (Haiku for Claude) while keeping analytical pass 2+ on the
 * standard tier. Now a thin wrapper over the `zone.enrich-scan` task class,
 * so `llm.routes`/`llm.tiers` config reroutes it; the legacy
 * `claude.lightModel` / `codex.lightModel` overrides keep working.
 */
export function resolveLightModel(): string {
  return resolveTaskModel("zone.enrich-scan", _llmConfig ?? {}, {
    vendor: resolveVendor(),
  }).model;
}

/**
 * Set the module-level LLM configuration.
 * Call this at CLI entry points before any LLM operations.
 * Resets the cached client so the next call creates a fresh one.
 */
export function setLLMConfig(config: LLMConfig): void {
  _llmConfig = config;
  _llmClient = undefined;
}

/**
 * Legacy compatibility setter for call-sites still passing only claude config.
 */
export function setClaudeConfig(config: ClaudeConfig): void {
  _llmConfig = {
    ...(_llmConfig ?? {}),
    claude: config,
    vendor: _llmConfig?.vendor ?? DEFAULT_LLM_VENDOR,
  };
  _llmClient = undefined;
}

/**
 * Set the module-level LLM client explicitly. This is useful when a
 * client has already been created at the CLI entry point, or for testing.
 */
export function setLLMClient(client: ClaudeClient): void {
  _llmClient = client;
}

/** Legacy compatibility alias. */
export function setClaudeClient(client: ClaudeClient): void {
  setLLMClient(client);
}

/**
 * Get the current authentication mode being used for LLM calls.
 * Returns "api" when using direct API key authentication, "cli" when
 * using CLI execution. Returns undefined if no config has been set yet.
 */
export function getAuthMode(): AuthMode | undefined {
  if (_llmClient) {
    // ClaudeClient.mode is a top-level property for Claude/Codex providers.
    // LLMProvider-shaped clients (e.g. Google) do not expose a top-level mode —
    // fall through to detectLLMAuthMode when mode is absent.
    if (_llmClient.mode) return _llmClient.mode;
  }
  if (_llmConfig) {
    return detectLLMAuthMode({
      vendor: resolveVendor(),
      llmConfig: _llmConfig,
    });
  }
  return undefined;
}

/** Return the active LLM vendor for enrichment/classification calls. */
export function getLLMVendor(): LLMVendor | undefined {
  if (_llmClient) return resolveVendor();
  if (_llmConfig) return resolveVendor();
  return undefined;
}

/**
 * Get or lazily create the module-level LLM client.
 * Falls back to Claude CLI mode when no configuration is available.
 */
function getClient(): ClaudeClient {
  if (_llmClient) return _llmClient;
  const llmConfig = _llmConfig ?? {};
  _llmClient = createLLMClient({
    vendor: resolveVendor(),
    llmConfig,
  });
  return _llmClient;
}

// ── Public call interface ────────────────────────────────────────────────────

export interface CallClaudeResult {
  text: string;
  tokenUsage?: TokenUsage;
}

/**
 * Send a prompt to Claude using the unified client abstraction.
 * Throws ClaudeClientError on failure instead of returning a result object.
 *
 * @param prompt  The prompt to send to Claude
 * @param model   The model to use (defaults to DEFAULT_MODEL)
 * @param opts    `taskClass` routes the call through the class→tier→model
 *                registry (`llm.routes` config included); an explicit `model`
 *                still wins. Callers without a class get the standard tier.
 */
export async function callClaude(
  prompt: string,
  model?: string,
  opts?: { taskClass?: string },
): Promise<CallClaudeResult> {
  const client = getClient();
  const resolved = opts?.taskClass
    ? resolveTaskModel(opts.taskClass, _llmConfig ?? {}, {
        model,
        vendor: resolveVendor(),
      }).model
    : resolveModel(model);
  const result: CompletionResult = await client.complete({
    prompt,
    model: resolved,
  });
  return {
    text: result.text,
    tokenUsage: result.tokenUsage,
  };
}

/** Vendor-neutral alias for call sites migrating away from Claude naming. */
export const callLLM = callClaude;
