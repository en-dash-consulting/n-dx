/** Responses function-call codec. Official contract verified 2026-11-17:
 * https://developers.openai.com/api/docs/guides/function-calling
 * https://developers.openai.com/api/docs/guides/reasoning
 * Stateless history preserves encrypted reasoning; no hosted tools or execution here.
 */
import { setTimeout as delay } from "node:timers/promises";
import { parseRetryAfterHeader, DEFAULT_AUTO_RETRY_THRESHOLD_MS } from "./rate-limit.js";
import { resolveOpenAiEffort } from "./codex-effort.js";
import { toOpenAiToolDef } from "./tool-schema.js";
import { AuthFailureError, ClaudeClientError, type CompletionResult } from "./types.js";
import type { ProviderMessage, ProviderToolCall, ProviderTurnRequest, ProviderTurnResult, ProviderTurnEvent } from "./provider-interface.js";

type ObjectValue = Record<string, unknown>;
type Accounting = Pick<CompletionResult, "tokenUsage" | "usageStatus">;
const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined;
const invalid = () => new ClaudeClientError("Invalid OpenAI Responses payload or conversation", "unknown", false);

/** Deliberately bounded to verified models; this is protocol support, not account access. */
export function supportsOpenAiTurns(model: string): boolean {
  return ["gpt-6.1-sol", "gpt-6-astra"].includes(model.replace(/-\d{4}-\d{2}-\d{2}$/, ""));
}

function toolCall(raw: ObjectValue): ProviderToolCall {
  if (typeof raw.call_id !== "string" || !raw.call_id || typeof raw.name !== "string" || !raw.name || typeof raw.arguments !== "string") throw invalid();
  let args: unknown;
  try { args = JSON.parse(raw.arguments); } catch { throw invalid(); }
  if (!object(args)) throw invalid();
  return { id: raw.call_id, name: raw.name, arguments: args as ObjectValue };
}

function output(items: unknown, truncated = false, request?: ProviderTurnRequest): { text: string; calls: ProviderToolCall[]; refusal: boolean } {
  if (!Array.isArray(items)) throw invalid();
  let text = "";
  let refusal = false;
  const calls: ProviderToolCall[] = [];
  const ids = new Set(request?.messages.filter(message => message.role === "tool").map(message => message.toolCallId));
  const names = request && new Set(request.tools.map(tool => tool.name));
  for (const value of items) {
    const item = object(value);
    if (!item) throw invalid();
    if (item.status !== undefined && item.status !== "completed" &&
        !(truncated && (item.status === "incomplete" || item.status === "in_progress"))) throw invalid();
    if (item.type === "function_call") {
      if (typeof item.call_id !== "string" || !item.call_id || typeof item.name !== "string" || !item.name || typeof item.arguments !== "string") throw invalid();
      if (ids.has(item.call_id) || (names && !names.has(item.name))) throw invalid();
      ids.add(item.call_id);
      // A partial argument string is expected at the token limit. Validate its
      // envelope, but never parse it into an executable call.
      if (truncated && item.status !== "completed") continue;
      const call = toolCall(item);
      calls.push(call);
    } else if (item.type === "message") {
      if (item.role !== "assistant" || !Array.isArray(item.content)) throw invalid();
      for (const part of item.content) {
        const block = object(part);
        if (block?.type === "output_text" && typeof block.text === "string") text += block.text;
        else if (block?.type === "refusal" && typeof block.refusal === "string") { text += block.refusal; refusal = true; }
        else throw invalid();
      }
    } else if (item.type === "reasoning") {
      if (typeof item.id !== "string" || !Array.isArray(item.summary) ||
          (item.encrypted_content !== undefined && typeof item.encrypted_content !== "string")) throw invalid();
    } else throw invalid(); // No hosted tool execution hidden behind a capability flag.
  }
  if (refusal && calls.length) throw invalid();
  return { text, calls, refusal };
}

function input(request: ProviderTurnRequest): unknown[] {
  const items: unknown[] = [];
  const pending = new Set<string>();
  const seen = new Set<string>();
  for (const message of request.messages) {
    if (typeof message.content !== "string") throw invalid();
    if (message.role === "tool") {
      if (!message.toolCallId || !pending.delete(message.toolCallId)) throw invalid();
      items.push({ type: "function_call_output", call_id: message.toolCallId,
        output: message.isError ? JSON.stringify({ error: message.content }) : message.content });
      continue;
    }
    if (pending.size) throw invalid();
    if (message.role === "assistant") {
      const calls = message.toolCalls ?? [];
      for (const call of calls) {
        if (!call.id || seen.has(call.id) || !call.name || !object(call.arguments)) throw invalid();
        seen.add(call.id); pending.add(call.id);
      }
      if (message.continuation) {
        const state = message.continuation;
        if (state.vendor !== "codex" || state.model !== request.model) throw invalid();
        const parsed = output(state.items);
        if (parsed.text !== message.content || JSON.stringify(parsed.calls) !== JSON.stringify(calls)) throw invalid();
        items.push(...state.items);
      } else {
        if (message.content) items.push({ role: "assistant", content: message.content });
        for (const call of calls) items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
      }
    } else if (message.role === "system" || message.role === "user") {
      if (message.toolCalls?.length || message.continuation) throw invalid();
      items.push({ role: message.role, content: message.content });
    } else throw invalid();
  }
  if (pending.size || !items.length) throw invalid();
  return items;
}

interface Options {
  baseUrl: string;
  headers: Record<string, string>;
  maxTokens: number;
  maxRetries: number;
  baseDelayMs: number;
  parseUsage: (raw: unknown) => Accounting;
}

/** Shared HTTP classification for text completions and agent turns. */
export function responseError(status: number, retryAfterMs?: number): ClaudeClientError {
  // Never echo an upstream body, URL, fetch error or header: any may contain credentials.
  if (status === 401 || status === 403) return new AuthFailureError("OpenAI authentication failed", "codex", status, "Credentials rejected");
  if (status === 404) return new ClaudeClientError("OpenAI model or endpoint unavailable", "not-found", true);
  if (status === 408) return new ClaudeClientError("OpenAI request timed out", "timeout", true);
  if (status === 429) return new ClaudeClientError("OpenAI rate limit exceeded", "rate-limit", true, retryAfterMs);
  return new ClaudeClientError(`OpenAI request failed (HTTP ${status})`, status >= 500 ? "network" : "unknown", status >= 500, retryAfterMs);
}

function eventError(raw: unknown): ClaudeClientError {
  const code = object(raw)?.code;
  if (code === "invalid_api_key" || code === "authentication_error") return responseError(401);
  if (code === "rate_limit_exceeded" || code === "insufficient_quota") return responseError(429);
  if (code === "model_not_found") return responseError(404);
  if (code === "server_error") return responseError(500);
  return new ClaudeClientError("OpenAI response failed", "unknown", false);
}

export function createOpenAiTurns(options: Options) {
  const accounting = (raw: unknown): Accounting => {
    const usage = object(raw);
    return options.parseUsage(usage ? {
      prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens,
      prompt_tokens_details: usage.input_tokens_details,
    } : raw);
  };
  const decode = (raw: unknown, request: ProviderTurnRequest, effort?: string): ProviderTurnResult => {
    const data = object(raw);
    const usage = accounting(data?.usage);
    try {
      if (!data) throw invalid();
      if (data.status === "failed" || data.error) throw eventError(data.error);
      const truncated = data.status === "incomplete" && object(data.incomplete_details)?.reason === "max_output_tokens";
      if (data.status !== "completed" && !truncated) throw new ClaudeClientError("OpenAI response did not complete", "unknown", false);
      const parsed = output(data.output, truncated, request);
      // Summaries must be complete: the caller treats their text as authoritative.
      if (truncated && request.taskClass === "context.summarize") throw new ClaudeClientError("OpenAI summary did not complete", "unknown", false);
      if (!truncated && !parsed.text && !parsed.calls.length && !parsed.refusal) throw invalid();
      // No calls from a truncated turn are executed, even ones marked complete.
      // Drop opaque reasoning with them: it may refer to those unanswered calls.
      // Only visible text is safe to replay with the loop's continuation prompt.
      const message: ProviderMessage = { role: "assistant", content: parsed.text, toolCalls: truncated ? [] : parsed.calls,
        ...(!truncated ? { continuation: { vendor: "codex" as const, model: request.model, items: data.output as unknown[] } } : {}) };
      return { text: parsed.text, message, model: typeof data.model === "string" ? data.model : request.model,
        ...(effort ? { effort } : {}), ...usage,
        stopReason: parsed.refusal ? "refusal" : truncated ? "max_tokens" : parsed.calls.length ? "tool_use" : "end_turn" };
    } catch (error) {
      if (error instanceof ClaudeClientError) Object.assign(error, usage);
      throw error;
    }
  };
  const signalFor = (request: ProviderTurnRequest): AbortSignal => {
    const signals = [request.signal, request.timeoutMs === undefined ? undefined : AbortSignal.timeout(request.timeoutMs)]
      .filter((signal): signal is AbortSignal => signal !== undefined);
    return AbortSignal.any(signals);
  };
  const abortError = (request: ProviderTurnRequest): Error => request.signal?.aborted
    ? new DOMException("OpenAI request cancelled", "AbortError")
    : new ClaudeClientError("OpenAI request timed out", "timeout", true);

  async function post(request: ProviderTurnRequest, stream: boolean, signal: AbortSignal, effort?: string): Promise<Response> {
    if (!supportsOpenAiTurns(request.model)) throw new ClaudeClientError("Model has no verified OpenAI agent-turn support", "unknown", false);
    const body = JSON.stringify({ model: request.model, input: input(request), store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: options.maxTokens, stream,
      ...(effort ? { reasoning: { effort } } : {}),
      // Explicit best-effort mode preserves optional fields in the neutral schemas.
      tools: request.tools.map(tool => ({ type: "function", ...toOpenAiToolDef(tool).function, strict: false })),
    });
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw abortError(request);
      let failure: ClaudeClientError;
      try {
        const response = await fetch(`${options.baseUrl}/responses`, { method: "POST", headers: options.headers, body, signal, redirect: "error" });
        if (response.ok) return response;
        failure = responseError(response.status, parseRetryAfterHeader(response.headers.get("retry-after")));
        await response.body?.cancel();
      } catch (error) {
        if (signal.aborted) throw abortError(request);
        if (error instanceof ClaudeClientError) throw error;
        failure = new ClaudeClientError("OpenAI connection failed", "network", true);
      }
      if (!failure.retryable || attempt >= options.maxRetries ||
          (failure.retryAfterMs ?? 0) > DEFAULT_AUTO_RETRY_THRESHOLD_MS) throw failure;
      try { await delay(failure.retryAfterMs ?? options.baseDelayMs * 2 ** attempt, undefined, { signal }); }
      catch { throw abortError(request); }
    }
  }

  return {
    async completeTurn(request: ProviderTurnRequest): Promise<ProviderTurnResult> {
      const signal = signalFor(request);
      const effort = resolveOpenAiEffort(request.model, request.effort, request.taskClass);
      const response = await post(request, false, signal, effort);
      let data: unknown;
      try { data = await response.json(); }
      catch (error) {
        if (signal.aborted) throw abortError(request);
        if (error instanceof SyntaxError) throw invalid();
        throw new ClaudeClientError("OpenAI response body interrupted", "network", true);
      }
      if (signal.aborted) throw abortError(request);
      return decode(data, request, effort);
    },
    async *streamTurn(request: ProviderTurnRequest): AsyncIterable<ProviderTurnEvent> {
      const signal = signalFor(request);
      const effort = resolveOpenAiEffort(request.model, request.effort, request.taskClass);
      const response = await post(request, true, signal, effort);
      if (!response.body) throw invalid();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let dataLines: string[] = [];
      let usage: Accounting = { usageStatus: "unavailable" };
      let usageSnapshot: ObjectValue = {};
      const observeUsage = (raw: unknown): void => {
        const next = accounting(raw);
        const incoming = object(raw);
        if (next.usageStatus === "measured") {
          usageSnapshot = incoming ?? {};
          usage = next;
          return;
        }
        // Damaged/missing final counters must not erase already observed spend.
        const merge = (previous: ObjectValue, current: ObjectValue, keys: string[]): ObjectValue => {
          const result = { ...previous };
          for (const key of keys) {
            const value = current[key];
            if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
              result[key] = Math.max(typeof previous[key] === "number" ? previous[key] as number : 0, value);
            }
          }
          return result;
        };
        usageSnapshot = {
          ...merge(usageSnapshot, incoming ?? {}, ["input_tokens", "output_tokens"]),
          input_tokens_details: merge(object(usageSnapshot.input_tokens_details) ?? {},
            object(incoming?.input_tokens_details) ?? {}, ["cached_tokens", "cache_write_tokens"]),
        };
        const retained = accounting(usageSnapshot);
        usage = { ...retained, usageStatus: next.usageStatus === "malformed" || retained.usageStatus === "malformed"
          ? "malformed" : retained.tokenUsage ? "partial" : next.usageStatus };
      };
      let text = "";
      let terminalUsage = false;
      let failed = false;
      const calls = new Map<number, { id: string; callId: string; name: string; arguments: string }>();
      const handle = (raw: string): ProviderTurnEvent | undefined => {
        let event: ObjectValue | undefined;
        try { event = object(JSON.parse(raw)); } catch { throw invalid(); }
        if (!event || typeof event.type !== "string") throw invalid();
        const snapshot = object(event.response);
        if (snapshot?.usage != null) observeUsage(snapshot.usage);
        if (["response.completed", "response.failed", "response.incomplete"].includes(event.type)) {
          terminalUsage = snapshot?.usage != null;
          if (!terminalUsage) observeUsage(undefined);
          if (snapshot?.status !== event.type.slice("response.".length)) throw invalid();
        }
        if (event.type === "error") throw eventError(event);
        if (event.type === "response.failed") {
          decode(snapshot, request, effort); throw invalid();
        }
        if (event.type === "response.output_text.delta") {
          if (typeof event.delta !== "string") throw invalid();
          text += event.delta;
          return { type: "text_delta", text: event.delta };
        }
        if (event.type === "response.output_item.added" && object(event.item)?.type === "function_call") {
          const item = object(event.item)!;
          if (!Number.isSafeInteger(event.output_index) || typeof item.id !== "string" || typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string" || calls.has(event.output_index as number)) throw invalid();
          calls.set(event.output_index as number, { id: item.id, callId: item.call_id, name: item.name, arguments: item.arguments });
        }
        if (event.type === "response.function_call_arguments.delta" || event.type === "response.function_call_arguments.done") {
          const call = calls.get(event.output_index as number);
          if (!call || call.id !== event.item_id) throw invalid();
          if (event.type.endsWith(".delta")) {
            if (typeof event.delta !== "string") throw invalid();
            call.arguments += event.delta;
          } else if (call.arguments !== event.arguments) throw invalid();
        }
        if (event.type === "response.completed" || event.type === "response.incomplete") {
          const result = decode(snapshot, request, effort);
          if (text && text !== result.text) throw invalid();
          for (const [index, call] of calls) {
            const item = object((snapshot?.output as unknown[])?.[index]);
            if (item?.id !== call.id || item.call_id !== call.callId || item.name !== call.name || item.arguments !== call.arguments) throw invalid();
          }
          return { type: "completed", result: { ...result, ...usage } };
        }
        return undefined; // Lifecycle, reasoning and content-part events are not executable tools.
      };
      try {
        while (true) {
          if (signal.aborted) throw abortError(request);
          const { value, done } = await reader.read();
          if (signal.aborted) throw abortError(request);
          if (done) throw new ClaudeClientError("OpenAI stream ended before completion", "network", true);
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
          for (const raw of lines) {
            const line = raw.replace(/\r$/, "");
            if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
            else if (!line && dataLines.length) {
              const event = handle(dataLines.join("\n")); dataLines = [];
              if (event) {
                yield event;
                if (event.type === "completed") return;
                if (signal.aborted) throw abortError(request);
              }
            }
          }
        }
      } catch (cause) {
        failed = true;
        if (!terminalUsage && usage.usageStatus === "measured") usage = { ...usage, usageStatus: "partial" };
        const error = signal.aborted ? abortError(request) : cause instanceof ClaudeClientError ? cause
          : new ClaudeClientError("OpenAI stream interrupted", "network", true);
        Object.assign(error, usage);
        throw error;
      } finally {
        // Cancel on early consumer return as well as terminal/error; release the fetch resource.
        try { await reader.cancel(); }
        catch {
          // An errored fetch body rejects cancel too. Preserve the classified primary error.
          if (!failed) throw new ClaudeClientError("OpenAI stream cleanup failed", "network", true);
        } finally { reader.releaseLock(); }
      }
    },
  };
}
