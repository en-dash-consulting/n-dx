import type { TokenUsage } from "../schema/index.js";

/** Codex rollout JSONL: session_meta, turn_context, event_msg/token_count.
 * Only total_token_usage is authoritative. last_token_usage repeats the last
 * request; reasoning output is already included in output_tokens.
 * See openai/codex codex-rs/protocol/src/protocol.rs (TokenUsageInfo).
 */
export function parseCodexUsage(transcript: string) {
  const entries: Array<{
    uuid: string; timestamp?: string;
    message: { model?: string; usage: Record<string, number> };
  }> = [];
  let supported = false;
  let sessionId: string | undefined;
  let model: string | undefined;
  let invalid = false;
  let partial = false;
  let previous = { input: 0, output: 0, cacheReadInput: 0, cacheCreationInput: 0 };
  const seen = new Set<string>();
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { partial = true; continue; }
    if (!row || typeof row !== "object") continue;
    if (row.type === "session_meta") {
      supported = true;
      const id = row.payload?.id;
      if (typeof id === "string") {
        if (sessionId && sessionId !== id) invalid = true;
        sessionId = id;
      }
    }
    if (row.type === "turn_context" && typeof row.payload?.model === "string") model = row.payload.model;
    if (row.type !== "event_msg" || row.payload?.type !== "token_count") continue;
    supported = true;
    // A null info record is a rate-limit update, not a usage observation.
    if (row.payload.info == null) continue;
    const u = row.payload.info.total_token_usage;
    const valid = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
    if (!u || !valid(u.input_tokens) || !valid(u.cached_input_tokens) || !valid(u.output_tokens) ||
        (u.cache_write_input_tokens !== undefined && !valid(u.cache_write_input_tokens)) ||
        u.cached_input_tokens + (u.cache_write_input_tokens ?? 0) > u.input_tokens) {
      partial = true;
      continue;
    }
    const totals: Required<TokenUsage> = {
      input: u.input_tokens - u.cached_input_tokens - (u.cache_write_input_tokens ?? 0),
      output: u.output_tokens,
      cacheReadInput: u.cached_input_tokens,
      cacheCreationInput: u.cache_write_input_tokens ?? 0,
    };
    // A stable counter identity survives replay and prefix truncation. No text,
    // timestamps or prompt content is persisted in a cursor.
    const uuid = `codex:${totals.input}:${totals.output}:${totals.cacheReadInput}:${totals.cacheCreationInput}`;
    if (seen.has(uuid)) continue;
    seen.add(uuid);
    if (Object.keys(totals).some((k) => totals[k as keyof TokenUsage] < previous[k as keyof TokenUsage])) {
      // A counter reset has no trustworthy mapping to the previous epoch.
      // Do not guess a new charge, or allow it to rewind an existing watermark.
      invalid = true;
      continue;
    }
    entries.push({ uuid, timestamp: typeof row.timestamp === "string" ? row.timestamp : undefined,
      message: { model, usage: {
        input_tokens: totals.input - previous.input,
        output_tokens: totals.output - previous.output,
        cache_read_input_tokens: totals.cacheReadInput - previous.cacheReadInput,
        cache_creation_input_tokens: totals.cacheCreationInput - previous.cacheCreationInput,
      } },
    });
    previous = totals;
  }
  return { supported, sessionId, entries, totals: previous,
    status: invalid || entries.length === 0 ? "unavailable" as const : partial ? "partial" as const : "complete" as const,
  };
}
