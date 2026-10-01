/**
 * Live model listing from the vendor APIs.
 *
 * Neither the `claude` nor the `codex` CLI can list models, so the only live
 * source is the vendor's own HTTP API, which needs a key. This module asks for
 * that list and reports either the models or why it could not — it never
 * throws, because the caller's fallback (the built-in catalog) is always
 * available and a settings page must not fail on a vendor outage.
 *
 * Key resolution follows the order the rest of llm-client uses: the config
 * value (`llm.<vendor>.api_key`, and for Claude the legacy `claude.api_key`,
 * already folded in by `loadLLMConfig`), then the vendor's environment
 * variable. The key is only ever placed in a request header. Failure reasons
 * are fixed strings or have the key scrubbed out, so no key can reach a log
 * line, an error message or a response.
 */

import { LLM_VENDOR, type LLMConfig } from "./llm-types.js";
import { isChatModelId, isModelCompatibleWithVendor } from "./vendor-model-reset.js";

/** The vendors that have a model-listing API this module can call. */
export type ListableVendor = typeof LLM_VENDOR.CLAUDE | typeof LLM_VENDOR.CODEX;

/** Outcome of {@link listVendorModels}. `reason` never contains the API key. */
export type VendorModelListing =
  | { ok: true; models: string[] }
  | { ok: false; reason: string };

export interface ListVendorModelsOptions {
  /** Environment to read `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Fetch implementation. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Abort the request after this many milliseconds. Defaults to 5000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

/** The configured or environment key for `vendor`, or undefined when neither is set. */
function resolveKey(
  vendor: ListableVendor,
  config: LLMConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const fromConfig = vendor === LLM_VENDOR.CLAUDE ? config.claude?.api_key : config.codex?.api_key;
  const fromEnv = env[vendor === LLM_VENDOR.CLAUDE ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"];
  return fromConfig || fromEnv || undefined;
}

/** Pull `data[].id` out of a vendor response body; undefined when the shape is wrong. */
function extractIds(body: unknown): string[] | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;
  return data
    .map((entry) => (entry && typeof entry === "object" ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * List the models `vendor` offers, filtered to ids the vendor can run in a chat
 * loop ({@link isModelCompatibleWithVendor} and {@link isChatModelId}), sorted
 * and de-duplicated.
 */
export async function listVendorModels(
  vendor: ListableVendor,
  config: LLMConfig,
  options: ListVendorModelsOptions = {},
): Promise<VendorModelListing> {
  const { env = process.env, fetch: fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const key = resolveKey(vendor, config, env);
  if (!key) {
    const envName = vendor === LLM_VENDOR.CLAUDE ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    return { ok: false, reason: `No API key (llm.${vendor}.api_key or ${envName})` };
  }

  const request: { url: string; headers: Record<string, string> } =
    vendor === LLM_VENDOR.CLAUDE
      ? { url: ANTHROPIC_MODELS_URL, headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION } }
      : { url: OPENAI_MODELS_URL, headers: { Authorization: `Bearer ${key}` } };

  try {
    const res = await fetchImpl(request.url, {
      headers: request.headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `Models API answered HTTP ${res.status}` };

    const ids = extractIds(await res.json());
    if (!ids) return { ok: false, reason: "Models API returned an unexpected response" };

    const models = [...new Set(ids.filter((id) => isModelCompatibleWithVendor(vendor, id) && isChatModelId(id)))].sort();
    if (models.length === 0) return { ok: false, reason: "Models API listed no usable chat models" };
    return { ok: true, models };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    if (timedOut) return { ok: false, reason: `Models API did not answer within ${timeoutMs}ms` };
    // The key is in a header, never the URL, but scrub it anyway: a fetch
    // implementation is free to echo request details into its error.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Models API request failed: ${message.split(key).join("[redacted]")}` };
  }
}
