import Anthropic from "@anthropic-ai/sdk";
import {
  ClaudeClientError, createOpenAiApiProvider, getNextFailoverAttempt,
  type LLMConfig, type LLMProvider,
} from "../../prd/llm-gateway.js";
import { resolveClaudeApiAuth } from "../../store/project-config.js";
import type { HenchConfig } from "../../schema/index.js";
import { TOOL_DEFINITIONS } from "../../tools/dispatch.js";
import { OpenAiAgentTurn } from "./openai-agent-turn.js";
import { buildCachedMessageRequest } from "./prompt-cache.js";
import { resolveAgentApiEffort } from "./agent-effort.js";

// Allow two minutes of setup/reasoning plus output at 10 tokens/second.
// Whole attempts (including retries and body reads) get 10–30 minutes, for
// both vendors. This is a deadline, not a retry delay or an idle timer.
const attemptTimeoutMs = (maxTokens: number): number =>
  Math.min(30 * 60_000, Math.max(10 * 60_000, 120_000 + Math.ceil(maxTokens / 10) * 1000));

type Selection = { vendor: "codex" | "claude"; model: string };
type Request = Parameters<OpenAiAgentTurn["call"]>[0];
type Response = Awaited<ReturnType<OpenAiAgentTurn["call"]>> | Anthropic.Message;
type Call = (request: Request) => Promise<Response>;

/** A run consumes its chain once, including across successful tool turns. */
export class OpenAiFailover {
  selection: Selection;
  private attempt = 0;
  private callTurn: Call;
  private readonly original: Selection;
  private readonly originalCall: Call;

  constructor(
    provider: LLMProvider,
    model: string,
    private readonly llm: LLMConfig,
    private readonly config: HenchConfig,
  ) {
    this.original = { vendor: "codex", model };
    this.selection = this.original;
    const turn = new OpenAiAgentTurn(provider);
    this.originalCall = request => turn.call(request);
    this.callTurn = this.originalCall;
  }

  private createCall(selection: Selection): Call {
    if (selection.vendor === "codex") {
      const provider = createOpenAiApiProvider({
        codexConfig: { ...this.llm.codex, model: selection.model },
        maxTokens: this.config.maxTokens, maxRetries: 0,
      });
      if (!provider.info.capabilities.includes("function-calling")) {
        throw new ClaudeClientError("Fallback model has no verified agent-turn support", "not-found", true);
      }
      const turn = new OpenAiAgentTurn(provider);
      return request => turn.call(request);
    }
    // Use the already trust-filtered config; never inherit OpenAI credentials or endpoint.
    const claude = this.llm.claude ?? {};
    const auth = resolveClaudeApiAuth(claude, this.config.apiKeyEnv);
    if (auth.apiRefusal || !auth.key) {
      throw auth.apiRefusal ?? new ClaudeClientError("Claude API credentials unavailable", "auth", false);
    }
    const client = new Anthropic({ apiKey: auth.key.value, baseURL: claude.api_endpoint,
      maxRetries: 0, timeout: attemptTimeoutMs(this.config.maxTokens) });
    return async request => {
      // The SDK's fetch timeout alone does not bound reading the response body.
      const deadline = AbortSignal.timeout(attemptTimeoutMs(this.config.maxTokens));
      const signal = AbortSignal.any([request.signal, deadline]);
      try {
        const response = await client.messages.create(buildCachedMessageRequest({
          model: request.model, maxTokens: this.config.maxTokens,
          systemPrompt: request.systemPrompt, messages: request.messages, tools: TOOL_DEFINITIONS,
          promptCache: this.config.promptCache, promptCacheTtl: this.config.promptCacheTtl,
          effort: resolveAgentApiEffort(request.model, { ...this.llm, vendor: "claude" }),
        }), { signal });
        signal.throwIfAborted();
        return response;
      } catch (error) {
        if (deadline.aborted && !request.signal.aborted) {
          throw new ClaudeClientError("Claude failover request timed out", "timeout", true);
        }
        if (request.signal.aborted) request.signal.throwIfAborted();
        if (error instanceof Anthropic.APIConnectionTimeoutError) {
          throw new ClaudeClientError("Claude failover request timed out", "timeout", true);
        }
        if (error instanceof Anthropic.APIConnectionError) {
          throw new ClaudeClientError("Claude failover connection failed", "network", true);
        }
        if (error instanceof Anthropic.APIError && error.status !== undefined) {
          throw claudeHttpError(error.status);
        }
        // A malformed success body can also put provider text in a parse error.
        throw new ClaudeClientError("Claude failover request failed", "unknown", false);
      }
    };
  }

  async call(request: Request, hooks: {
    beforeAttempt: () => Promise<void>;
    failed: (error: unknown, selection: Selection) => void;
    switched: (from: Selection, to: Selection, reason: string) => void;
  }): Promise<Response> {
    let originalError: unknown;
    let hasError = false;
    let needsClient = false;
    request.signal.throwIfAborted();
    if (this.llm.autoFailover) await hooks.beforeAttempt();
    for (;;) {
      request.signal.throwIfAborted();
      try {
        if (needsClient) this.callTurn = this.createCall(this.selection);
        return await this.callTurn({ ...request, model: this.selection.model,
          ...(this.llm.autoFailover ? { timeoutMs: attemptTimeoutMs(this.config.maxTokens) } : {}) });
      } catch (error) {
        hooks.failed(error, this.selection);
        if (!hasError) { originalError = error; hasError = true; }
        if (!this.llm.autoFailover || request.signal.aborted) throw error;
        if (!(error instanceof ClaudeClientError) || (!error.retryable && error.reason !== "auth")) throw error;
        const reason = error.reason;
        const next = getNextFailoverAttempt(this.attempt + 1, "codex", this.llm);
        if (next.isExhausted || !next.model || (next.vendor !== "codex" && next.vendor !== "claude")) {
          this.selection = this.original;
          this.callTurn = this.originalCall;
          throw originalError;
        }
        await hooks.beforeAttempt();
        request.signal.throwIfAborted();
        this.attempt++;
        const previous = this.selection;
        this.selection = { vendor: next.vendor, model: next.model };
        hooks.switched(previous, this.selection, reason);
        needsClient = true;
      }
    }
  }
}

/** Classify the status only. SDK messages can include the entire response body. */
function claudeHttpError(status: number): ClaudeClientError {
  const message = `Claude failover request failed (HTTP ${status})`;
  if (status === 401 || status === 403) return new ClaudeClientError(message, "auth", false);
  if (status === 404) return new ClaudeClientError(message, "not-found", true);
  if (status === 408) return new ClaudeClientError(message, "timeout", true);
  if (status === 429) return new ClaudeClientError(message, "rate-limit", true);
  if (status === 409 || status >= 500) return new ClaudeClientError(message, "network", true);
  return new ClaudeClientError(message, "unknown", false);
}
