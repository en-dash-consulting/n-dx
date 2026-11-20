/**
 * What the two OpenAI billing reads share: the quota adapter
 * (`codex-quota.ts`) and the per-run token fallback
 * (`codex-token-retrieval.ts`). Each keeps its own fetch, because their error
 * kinds and timeouts differ; the endpoint, the missing-key message and the
 * date format they send are one fact each.
 */

/** The OpenAI API both reads call unless an endpoint is configured. */
export const OPENAI_DEFAULT_ENDPOINT = "https://api.openai.com";

/** The error both reads return when no OpenAI key is available. */
export const MISSING_CODEX_KEY_MESSAGE =
  "No Codex API key available: export OPENAI_API_KEY or store one with 'ndx config credentials.codex' (storing it does not switch modes; 'ndx config llm.codex.auth api' does)";

/** Return an ISO date string (YYYY-MM-DD) for the given Date object. */
export function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
