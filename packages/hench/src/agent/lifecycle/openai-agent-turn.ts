import type Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "../../prd/llm-gateway.js";
import { TOOL_DEFINITIONS_NEUTRAL } from "../../tools/dispatch.js";

type TurnRequest = Parameters<NonNullable<LLMProvider["completeTurn"]>>[0];
type Message = TurnRequest["messages"][number];

/** Adapt the shared guarded loop's history to Responses, without persisting opaque reasoning. */
export class OpenAiAgentTurn {
  private readonly continuations = new WeakMap<object, Message>();

  constructor(private readonly provider: LLMProvider) {
    if (provider.info.mode !== "api" || !provider.completeTurn) {
      throw new Error("n-dx requires a direct OpenAI tool-call provider; CLI/text fallback is unavailable.");
    }
  }

  async call(args: {
    model: string;
    systemPrompt: string;
    messages: Anthropic.MessageParam[];
    effort?: string;
    signal: AbortSignal;
    timeoutMs?: number;
  }) {
    const messages: Message[] = [{ role: "system", content: args.systemPrompt }];
    for (const message of args.messages) {
      if (typeof message.content === "string") {
        messages.push({ role: message.role, content: message.content });
        continue;
      }
      const original = this.continuations.get(message.content);
      if (original) {
        messages.push(original);
        continue;
      }
      const toolCalls = message.content.filter(block => block.type === "tool_use");
      if (toolCalls.length) {
        messages.push({ role: "assistant", content: message.content
          .filter(block => block.type === "text").map(block => block.text).join("\n"),
          toolCalls: toolCalls.map(block => ({ id: block.id, name: block.name,
            arguments: block.input as Record<string, unknown> })),
        });
        continue;
      }
      for (const block of message.content) {
        if (block.type === "text") messages.push({ role: message.role, content: block.text });
        else if (block.type === "tool_result") {
          messages.push({
            role: "tool", toolCallId: block.tool_use_id,
            content: typeof block.content === "string" ? block.content : "",
            isError: block.is_error,
          });
        } else throw new Error("Unsupported OpenAI agent history block");
      }
    }
    const result = await this.provider.completeTurn!({
      model: args.model, messages, tools: TOOL_DEFINITIONS_NEUTRAL,
      effort: args.effort, signal: args.signal, timeoutMs: args.timeoutMs, taskClass: "agent.execute",
    });
    const content: Anthropic.ContentBlock[] = [];
    if (result.message.content) content.push({ type: "text", text: result.message.content, citations: null });
    for (const call of result.message.toolCalls ?? []) {
      content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments, caller: { type: "direct" } });
    }
    this.continuations.set(content, result.message);
    return { content, stop_reason: result.stopReason, accounting: result };
  }
}
