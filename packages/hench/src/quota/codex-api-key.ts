/**
 * The OpenAI key Codex quota and token retrieval may send, under `llm.codex.auth`.
 *
 * Resolved like every other Codex API call (`resolveVendorAuth`): `api` reads
 * `llm.codex.api_key`, `OPENAI_API_KEY`, then the credential store; `auto`
 * reads only a configured or exported key; `cli` sends none. When no key may
 * be used, `notice` says what would enable quota. Neither field ever carries
 * the key's value except `key`.
 */

import { LLM_VENDOR, resolveVendorAuth } from "../prd/llm-gateway.js";
import type { LLMConfig } from "../prd/llm-gateway.js";

export type CodexQuotaKey =
  | { readonly key: string; readonly notice?: undefined }
  | { readonly key?: undefined; readonly notice: string };

export function resolveCodexQuotaKey(config: LLMConfig): CodexQuotaKey {
  const decision = resolveVendorAuth(LLM_VENDOR.CODEX, config);
  if (decision.mode === "api" && decision.key) return { key: decision.key.value };

  if (decision.auth === "cli") {
    return {
      notice: "codex login (llm.codex.auth cli) — quota needs an API key: 'ndx config llm.codex.auth api' uses a stored or exported one",
    };
  }
  if (decision.auth === "api") {
    return {
      notice: "llm.codex.auth api, but no key resolves — run 'ndx config credentials.codex' or export OPENAI_API_KEY for quota",
    };
  }
  return {
    notice: decision.storedKeyHeld
      ? "codex login (session auth) — the stored codex key is unused under llm.codex.auth auto; 'ndx config llm.codex.auth api' uses it for quota"
      : "codex login (session auth) — export OPENAI_API_KEY, or run 'ndx config credentials.codex' and 'ndx config llm.codex.auth api', for quota",
  };
}
