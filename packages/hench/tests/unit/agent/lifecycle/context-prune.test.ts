/**
 * Summarizing conversation prune.
 *
 * Two load-bearing properties, and they pull against each other:
 *
 * 1. **Nothing known is lost.** The old prune dropped the oldest turns with no
 *    record, so the run forgot which files it had touched and which commands
 *    had failed. A pruned turn's facts must reach the summarizer and survive
 *    into the message that replaces the span.
 * 2. **The cached prefix does not move.** Anthropic bills a prompt at the cache
 *    rate only for the byte-identical prefix of the previous request. A prune
 *    that rewrites or shifts anything already sent invalidates the cache, which
 *    is what the front-splice did on every single turn.
 *
 * The failure path matters as much as the happy one: a summary is a nicety and
 * a prune is a necessity, so a dead summarizer must degrade to the plain drop
 * rather than take the run down with it.
 */

import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  ConversationPruner,
  PRUNE_BRIDGE_TEXT,
  PRUNE_RETAIN_PAIRS,
  PRUNE_TRIGGER_PAIRS,
  SUMMARY_CHAR_LIMIT,
  TRANSCRIPT_MESSAGE_CHAR_LIMIT,
  anthropicPruneShape,
  buildPruneSummaryPrompt,
  createContextSummarizer,
  normalizePruneSummary,
  renderAnthropicMessage,
  renderPruneTranscript,
} from "../../../../src/agent/lifecycle/context-prune.js";
import type { PruneShape, PruneSummary } from "../../../../src/agent/lifecycle/context-prune.js";
import {
  geminiPruneShape,
  openAiPruneShape,
  recordPruneUsage,
} from "../../../../src/agent/lifecycle/loop.js";
import type { OpenAiMessage } from "../../../../src/agent/lifecycle/loop.js";
import type { RunRecord } from "../../../../src/schema/index.js";
import type { GeminiContent } from "../../../../src/prd/llm-gateway.js";
import { resolveTaskModel } from "../../../../src/prd/llm-gateway.js";

/** The class the prune summary must route through. */
const SUMMARY_TASK_CLASS = "context.summarize";

const BRIEF = "Implement the widget renderer.";

/** One (assistant, user) turn-pair in Anthropic shape. */
function turnPair(n: number): Anthropic.MessageParam[] {
  return [
    {
      role: "assistant",
      content: [
        { type: "text", text: `Working on step ${n}.` },
        {
          type: "tool_use",
          id: `tool_${n}`,
          name: "read_file",
          input: { path: `src/step-${n}.ts` },
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `tool_${n}`, content: `step ${n} ok` }],
    },
  ];
}

/** A conversation of `pairs` turn-pairs after the brief. */
function conversation(pairs: number): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: BRIEF }];
  for (let n = 1; n <= pairs; n++) messages.push(...turnPair(n));
  return messages;
}

/** Append turn-pairs to an existing conversation. */
function extend(messages: Anthropic.MessageParam[], pairs: number, offset: number): void {
  for (let n = 1; n <= pairs; n++) messages.push(...turnPair(offset + n));
}

/** Summarizer that keeps only transcript lines mentioning `needle`. */
function extractingSummarizer(needle: string) {
  const seen: string[] = [];
  return {
    seen,
    summarize: async (transcript: string): Promise<PruneSummary> => {
      seen.push(transcript);
      return {
        text: transcript
          .split("\n")
          .filter((line) => line.includes(needle))
          .join(" | "),
      };
    },
  };
}

const stubSummarizer = async (): Promise<PruneSummary> => ({
  text: "earlier turns did some work",
});

describe("normalizePruneSummary", () => {
  it("passes plain prose through unchanged", () => {
    expect(normalizePruneSummary("Edited src/a.ts; tests failed on parse().")).toBe(
      "Edited src/a.ts; tests failed on parse().",
    );
  });

  it("unwraps a fenced block rather than feeding backticks back to the model", () => {
    expect(normalizePruneSummary("```\nEdited src/a.ts\n```")).toBe("Edited src/a.ts");
    expect(normalizePruneSummary("```text\nEdited src/a.ts\n```")).toBe("Edited src/a.ts");
  });

  it("strips a leading label line", () => {
    expect(normalizePruneSummary("Summary: edited src/a.ts")).toBe("edited src/a.ts");
    expect(normalizePruneSummary("Here is the summary: edited src/a.ts")).toBe(
      "edited src/a.ts",
    );
  });

  it("declines empty, whitespace-only and undefined output", () => {
    expect(normalizePruneSummary("")).toBeUndefined();
    expect(normalizePruneSummary("   \n\t ")).toBeUndefined();
    expect(normalizePruneSummary("```\n\n```")).toBeUndefined();
    expect(normalizePruneSummary(undefined)).toBeUndefined();
  });

  it("caps an over-long summary so compaction cannot itself blow the window", () => {
    const summary = normalizePruneSummary("x".repeat(SUMMARY_CHAR_LIMIT * 2));
    expect(summary!.length).toBeLessThan(SUMMARY_CHAR_LIMIT + 32);
    expect(summary).toContain("[truncated]");
  });
});

describe("renderAnthropicMessage", () => {
  it("renders tool requests and their results, not just prose", () => {
    const [assistant, user] = turnPair(7);

    expect(renderAnthropicMessage(assistant)).toBe(
      'assistant: Working on step 7.\n→ read_file({"path":"src/step-7.ts"})',
    );
    expect(renderAnthropicMessage(user)).toBe("user: ← step 7 ok");
  });

  it("renders a string-content message with its role", () => {
    expect(renderAnthropicMessage({ role: "user", content: BRIEF })).toBe(`user: ${BRIEF}`);
  });
});

describe("renderPruneTranscript", () => {
  it("truncates a runaway tool result instead of letting it crowd out other turns", () => {
    const huge: Anthropic.MessageParam = {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t", content: "y".repeat(50_000) }],
    };
    const transcript = renderPruneTranscript(
      [huge, { role: "assistant", content: "and then this happened" }],
      renderAnthropicMessage,
    );

    expect(transcript).toContain("[truncated]");
    expect(transcript).toContain("and then this happened");
    expect(transcript.length).toBeLessThan(TRANSCRIPT_MESSAGE_CHAR_LIMIT * 3);
  });
});

describe("ConversationPruner", () => {
  it("leaves a conversation below the trigger completely untouched", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), stubSummarizer);
    const messages = conversation(PRUNE_TRIGGER_PAIRS);
    const before = JSON.stringify(messages);

    expect(await pruner.prune(messages)).toEqual({ dropped: 0, summarized: false });
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("replaces the dropped span with exactly one summary message", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), stubSummarizer);
    const messages = conversation(PRUNE_TRIGGER_PAIRS + 1);

    const outcome = await pruner.prune(messages);

    expect(outcome.summarized).toBe(true);
    expect(messages).toHaveLength(2 + PRUNE_RETAIN_PAIRS * 2);
    expect(messages[0]).toEqual({ role: "user", content: BRIEF });
    expect(messages[1].content).toContain("earlier turns did some work");
    expect(pruner.summaries).toBe(1);
  });

  it("carries a pruned turn's facts into the retained summary", async () => {
    const { seen, summarize } = extractingSummarizer("src/step-2.ts");
    const pruner = new ConversationPruner(anthropicPruneShape(), summarize);
    const messages = conversation(PRUNE_TRIGGER_PAIRS + 1);

    await pruner.prune(messages);

    // The fact was in a turn that is gone from the conversation...
    expect(JSON.stringify(messages.slice(2))).not.toContain("src/step-2.ts");
    // ...it reached the summarizer...
    expect(seen[0]).toContain('read_file({"path":"src/step-2.ts"})');
    // ...and it survives in the one message that replaced the span.
    expect(JSON.stringify(messages[1])).toContain("src/step-2.ts");
  });

  it("keeps the retained tail valid: no tool result without its request", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), stubSummarizer);
    const messages = conversation(PRUNE_TRIGGER_PAIRS + 1);

    await pruner.prune(messages);

    // Everything after the head+summary must open on an assistant turn, or the
    // API rejects the request for an unmatched tool_result.
    expect(messages[2].role).toBe("assistant");
    for (let i = 2; i < messages.length; i += 2) expect(messages[i].role).toBe("assistant");
  });

  it("never mutates the prefix already sent, across repeated prunes", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), stubSummarizer);
    const messages = conversation(PRUNE_TRIGGER_PAIRS + 1);

    await pruner.prune(messages);
    const cachedPrefix = JSON.stringify(messages.slice(0, 2));

    // Turns accumulate; no prune fires until the trigger is crossed again, so
    // every request in between is a pure append onto the cached prefix.
    for (let round = 0; round < PRUNE_TRIGGER_PAIRS; round++) {
      extend(messages, 1, 100 + round);
      await pruner.prune(messages);
      expect(JSON.stringify(messages.slice(0, 2))).toBe(cachedPrefix);
    }

    // The second prune appended a summary rather than rewriting the first.
    expect(pruner.summaries).toBe(2);
    expect(JSON.stringify(messages.slice(0, 2))).toBe(cachedPrefix);
    expect(messages[2].content).toContain("compacted");
  });

  it("prunes rarely rather than on every turn", async () => {
    let calls = 0;
    const pruner = new ConversationPruner(anthropicPruneShape(), async () => {
      calls++;
      return { text: "compacted" };
    });
    const messages = conversation(PRUNE_TRIGGER_PAIRS + 1);

    for (let turn = 0; turn < PRUNE_TRIGGER_PAIRS; turn++) {
      await pruner.prune(messages);
      extend(messages, 1, 200 + turn);
    }

    // Once per (trigger - retain) turns, not once per turn.
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("degrades to the plain drop when the summarizer fails", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), async () => {
      throw new Error("provider unavailable");
    });
    const messages = conversation(PRUNE_TRIGGER_PAIRS + 1);

    const outcome = await pruner.prune(messages);

    expect(outcome).toEqual({ dropped: 22, summarized: false });
    expect(messages).toHaveLength(1 + PRUNE_RETAIN_PAIRS * 2);
    expect(messages[0]).toEqual({ role: "user", content: BRIEF });
    expect(messages[1].role).toBe("assistant");
    expect(pruner.summaries).toBe(0);
  });

  it("treats unusable summarizer output as a declined summary", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), async () => ({
      text: "```\n\n```",
    }));
    const messages = conversation(PRUNE_TRIGGER_PAIRS + 1);

    expect(await pruner.prune(messages)).toEqual({ dropped: 22, summarized: false });
    expect(pruner.summaries).toBe(0);
  });
});

describe("ConversationPruner with an OpenAI-compatible shape", () => {
  interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
  }

  const chatShape: PruneShape<ChatMessage> = {
    headCount: 2,
    isTailStart: (message) => message.role === "assistant",
    render: (message) => `${message.role}: ${message.content ?? ""}`,
    toSummaryMessage: (summary) => ({ role: "user", content: `[context] ${summary}` }),
  };

  it("walks the cut forward past orphan tool messages", async () => {
    const pruner = new ConversationPruner(chatShape, stubSummarizer);
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: BRIEF },
    ];
    // Three tool results per assistant turn — the irregular shape the old
    // `splice(systemEnd, n)` could cut straight through.
    for (let n = 0; n < 20; n++) {
      messages.push({ role: "assistant", content: `call ${n}` });
      messages.push({ role: "tool", content: `result ${n}a` });
      messages.push({ role: "tool", content: `result ${n}b` });
      messages.push({ role: "tool", content: `result ${n}c` });
    }

    const outcome = await pruner.prune(messages);

    expect(outcome.summarized).toBe(true);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toBe(BRIEF);
    expect(messages[2].content).toContain("[context]");
    // The first live message is an assistant turn, so every retained tool
    // result still has the call it answers.
    expect(messages[3].role).toBe("assistant");
  });
});

/**
 * Role alternation, as the strict chat templates enforce it.
 *
 * Anthropic merges consecutive same-role turns, so its shape can put the
 * summary next to the brief. Nothing else does: an OpenAI-compatible server
 * renders the array through the loaded model's Jinja template, and
 * Mistral-Instruct / Gemma / Llama-2-chat raise "Conversation roles must
 * alternate" instead. The one legal repeat is a run of `tool` messages, which
 * those templates handle as a block rather than as turns.
 */
function expectAlternatingRoles(roles: readonly string[]): void {
  for (let i = 1; i < roles.length; i++) {
    if (roles[i] === "tool" && roles[i - 1] === "tool") continue;
    // Reported as an index-tagged transition so a failure names the seam.
    expect(`${i - 1}→${i}: ${roles[i - 1]}, ${roles[i]}`).not.toMatch(
      new RegExp(`: ${roles[i - 1]}, ${roles[i - 1]}$`),
    );
  }
}

describe("openAiPruneShape", () => {
  const SYSTEM = "You are an autonomous coding agent.";

  /** Head plus `pairs` (assistant tool_call, tool result) turn-pairs. */
  function chat(pairs: number): OpenAiMessage[] {
    const messages: OpenAiMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: BRIEF },
    ];
    for (let n = 1; n <= pairs; n++) {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: `call_${n}`,
          type: "function",
          function: { name: "read_file", arguments: `{"path":"src/step-${n}.ts"}` },
        }],
      });
      messages.push({ role: "tool", tool_call_id: `call_${n}`, content: `step ${n} ok` });
    }
    return messages;
  }

  it("keeps the array alternating after a summarizing prune", async () => {
    const pruner = new ConversationPruner(openAiPruneShape(true), stubSummarizer);
    const messages = chat(PRUNE_TRIGGER_PAIRS + 1);

    expect((await pruner.prune(messages)).summarized).toBe(true);

    expectAlternatingRoles(messages.map((m) => m.role));
    // The head is untouched and the summary region follows it.
    expect(messages[0]).toEqual({ role: "system", content: SYSTEM });
    expect(messages[1]).toEqual({ role: "user", content: BRIEF });
    expect(messages[2]).toEqual({ role: "assistant", content: PRUNE_BRIDGE_TEXT });
    expect(messages[3].role).toBe("user");
    expect(messages[3].content).toContain("earlier turns did some work");
    expect(messages[4].role).toBe("assistant");
  });

  it("leaves every tool message anchored to the call it answers", async () => {
    const pruner = new ConversationPruner(openAiPruneShape(true), stubSummarizer);
    const messages = chat(PRUNE_TRIGGER_PAIRS + 1);

    await pruner.prune(messages);

    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== "tool") continue;
      const previous = messages[i - 1];
      expect(previous).toBeDefined();
      const anchored =
        previous.role === "tool" ||
        (previous.role === "assistant" && (previous.tool_calls?.length ?? 0) > 0);
      expect(anchored).toBe(true);
    }
  });

  it("stays alternating with no system prompt, where the head is the brief alone", async () => {
    const pruner = new ConversationPruner(openAiPruneShape(false), stubSummarizer);
    const messages = chat(PRUNE_TRIGGER_PAIRS + 1).slice(1);

    expect((await pruner.prune(messages)).summarized).toBe(true);

    expectAlternatingRoles(messages.map((m) => m.role));
    expect(messages[0]).toEqual({ role: "user", content: BRIEF });
    expect(messages[1].role).toBe("assistant");
  });

  it("stays alternating on the degraded drop, when no summary is available", async () => {
    const pruner = new ConversationPruner(openAiPruneShape(true), async () => {
      throw new Error("provider unavailable");
    });
    const messages = chat(PRUNE_TRIGGER_PAIRS + 1);

    expect((await pruner.prune(messages)).summarized).toBe(false);

    expectAlternatingRoles(messages.map((m) => m.role));
    expect(messages[2].role).toBe("assistant");
    expect(pruner.summaries).toBe(0);
  });

  it("prunes at the same cadence despite the two-message summary", async () => {
    let prunes = 0;
    const pruner = new ConversationPruner(openAiPruneShape(true), async () => {
      prunes++;
      return { text: "compacted" };
    });
    const messages = chat(PRUNE_TRIGGER_PAIRS + 1);

    await pruner.prune(messages);
    expect(prunes).toBe(1);
    // The summary region is two messages wide, so the trigger has to move by
    // two as well — otherwise the next prune fires early and never stops.
    expect(pruner.summaries).toBe(2);
    expect(pruner.triggerLength).toBe(2 + 2 + PRUNE_TRIGGER_PAIRS * 2);

    // The gap between trigger and retain is how many turn-pairs of pure
    // append follow a prune, and it must not shrink because the summary got
    // wider. Same cadence as the one-message Anthropic shape.
    const addPair = (n: number): void => {
      messages.push({ role: "assistant", content: `step ${n}` });
      messages.push({ role: "user", content: `next ${n}` });
    };

    for (let n = 0; n < PRUNE_TRIGGER_PAIRS - PRUNE_RETAIN_PAIRS; n++) {
      addPair(n);
      await pruner.prune(messages);
    }
    expect(prunes).toBe(1);

    addPair(PRUNE_TRIGGER_PAIRS);
    await pruner.prune(messages);
    expect(prunes).toBe(2);
    expect(pruner.summaries).toBe(4);
  });
});

describe("geminiPruneShape", () => {
  /** Brief plus `pairs` (model functionCall, user functionResponse) turn-pairs. */
  function contents(pairs: number): GeminiContent[] {
    const turns: GeminiContent[] = [{ role: "user", parts: [{ text: BRIEF }] }];
    for (let n = 1; n <= pairs; n++) {
      turns.push({
        role: "model",
        parts: [{ functionCall: { name: "read_file", args: { path: `src/step-${n}.ts` } } }],
      });
      turns.push({
        role: "user",
        parts: [{ functionResponse: { name: "read_file", response: { result: `step ${n} ok` } } }],
      });
    }
    return turns;
  }

  it("alternates user/model strictly from the brief onward after a prune", async () => {
    const pruner = new ConversationPruner(geminiPruneShape(), stubSummarizer);
    const turns = contents(PRUNE_TRIGGER_PAIRS + 1);

    expect((await pruner.prune(turns)).summarized).toBe(true);

    expectAlternatingRoles(turns.map((t) => t.role));
    expect(turns[0]).toEqual({ role: "user", parts: [{ text: BRIEF }] });
    expect(turns[1]).toEqual({ role: "model", parts: [{ text: PRUNE_BRIDGE_TEXT }] });
    expect(turns[2].role).toBe("user");
    expect(JSON.stringify(turns[2])).toContain("earlier turns did some work");
    expect(turns[3].role).toBe("model");
  });

  it("stays alternating on the degraded drop, when no summary is available", async () => {
    const pruner = new ConversationPruner(geminiPruneShape(), async () => {
      throw new Error("provider unavailable");
    });
    const turns = contents(PRUNE_TRIGGER_PAIRS + 1);

    expect((await pruner.prune(turns)).summarized).toBe(false);

    expectAlternatingRoles(turns.map((t) => t.role));
    expect(turns[1].role).toBe("model");
    expect(pruner.summaries).toBe(0);
  });
});

describe("PRUNE_BRIDGE_TEXT", () => {
  it("claims no work and stays short — it is protocol padding, not context", () => {
    expect(PRUNE_BRIDGE_TEXT.length).toBeLessThan(120);
    for (const claim of ["I ran", "I edited", "I fixed", "completed", "done"]) {
      expect(PRUNE_BRIDGE_TEXT.toLowerCase()).not.toContain(claim.toLowerCase());
    }
  });
});

describe("createContextSummarizer", () => {
  it("routes the call through the context.summarize task class", async () => {
    const calls: Array<{ prompt: string; model: string }> = [];
    const summarize = createContextSummarizer({
      provider: {
        complete: async (request) => {
          calls.push({ prompt: request.prompt, model: request.model });
          return { text: "compacted" };
        },
      },
      llmConfig: { vendor: "claude" },
      vendor: "claude",
      taskTitle: "Implement the widget renderer",
    });

    const expected = resolveTaskModel(SUMMARY_TASK_CLASS, { vendor: "claude" }, {
      vendor: "claude",
    });
    expect(expected.tier).toBe("light");
    expect(await summarize("assistant: touched src/widget.ts")).toEqual({
      text: "compacted",
      model: expected.model,
    });
    expect(calls[0].model).toBe(expected.model);
    expect(calls[0].prompt).toContain("touched src/widget.ts");
  });

  it("reports what the call cost, so the prune's spend is not silently dropped", async () => {
    const summarize = createContextSummarizer({
      provider: {
        complete: async () => ({
          text: "compacted",
          tokenUsage: { input: 4200, output: 310 },
        }),
      },
      llmConfig: { vendor: "claude" },
      vendor: "claude",
      taskTitle: "task",
    });

    const result = await summarize("assistant: something");

    expect(result.tokenUsage).toEqual({ input: 4200, output: 310 });
    // Attributed to the model that actually ran, which is the light tier —
    // not whatever model the run itself is using.
    expect(result.model).toBe(
      resolveTaskModel(SUMMARY_TASK_CLASS, { vendor: "claude" }, { vendor: "claude" }).model,
    );
  });

  it("falls back to the configured vendor for an unrecognized vendor string", async () => {
    const calls: string[] = [];
    const summarize = createContextSummarizer({
      provider: {
        complete: async (request) => {
          calls.push(request.model);
          return { text: "compacted" };
        },
      },
      llmConfig: { vendor: "claude" },
      vendor: "not-a-vendor",
      taskTitle: "task",
    });

    await summarize("assistant: something");

    expect(calls[0]).toBe(
      resolveTaskModel(SUMMARY_TASK_CLASS, { vendor: "claude" }).model,
    );
  });
});

/**
 * Compaction spend is spend.
 *
 * A prune sends up to 20,000 characters of transcript to a real model and gets
 * real tokens back. Before this, `createContextSummarizer` destructured
 * only `text` from the completion and threw the usage away, so `hench show`,
 * `rex usage`, the dashboard and `get_token_usage` all under-reported every run
 * that pruned — and on a locally-served model the same loaded weights did the
 * extra work with no record at all. The pruner stays vendor-neutral: it reports
 * what the summary cost, and the loop is what folds it into the run.
 */
describe("prune summarizer accounting", () => {
  const usage = { input: 4200, output: 310 };

  /** Summarizer that reports a cost, as the real one now does. */
  const costedSummarizer = async (): Promise<PruneSummary> => ({
    text: "earlier turns did some work",
    tokenUsage: usage,
    model: "claude-haiku-light",
  });

  it("carries the summarizer's cost out on the outcome", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), costedSummarizer);
    const messages = conversation(PRUNE_TRIGGER_PAIRS + 1);

    const outcome = await pruner.prune(messages);

    expect(outcome.summarized).toBe(true);
    expect(outcome.summaryUsage).toEqual(usage);
    expect(outcome.summaryModel).toBe("claude-haiku-light");
  });

  it("still reports the cost when the summary itself was unusable", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), async () => ({
      text: "```\n\n```",
      tokenUsage: usage,
      model: "claude-haiku-light",
    }));
    const messages = conversation(PRUNE_TRIGGER_PAIRS + 1);

    const outcome = await pruner.prune(messages);

    // The text was thrown away; the tokens were spent regardless.
    expect(outcome.summarized).toBe(false);
    expect(outcome.summaryUsage).toEqual(usage);
  });

  it("reports no cost when no prune fired and no call was made", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), costedSummarizer);

    const outcome = await pruner.prune(conversation(PRUNE_TRIGGER_PAIRS));

    expect(outcome.summaryUsage).toBeUndefined();
    expect(outcome.summaryModel).toBeUndefined();
  });

  it("reports no cost when the summarizer threw", async () => {
    const pruner = new ConversationPruner(anthropicPruneShape(), async () => {
      throw new Error("provider unavailable");
    });

    const outcome = await pruner.prune(conversation(PRUNE_TRIGGER_PAIRS + 1));

    expect(outcome.dropped).toBe(22);
    expect(outcome.summaryUsage).toBeUndefined();
  });
});

describe("recordPruneUsage", () => {
  function newRun(): RunRecord {
    return {
      id: "run-1",
      taskId: "task-1",
      taskTitle: "Implement the widget renderer",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "running",
      turns: 0,
      tokenUsage: { input: 1000, output: 200 },
      turnTokenUsage: [],
      toolCalls: [],
      model: "claude-primary",
      vendor: "claude",
    };
  }

  it("adds the summarizer's tokens to the run totals", () => {
    const run = newRun();

    recordPruneUsage(
      run,
      { dropped: 22, summarized: true, summaryUsage: { input: 4200, output: 310 } },
      7,
      "claude",
      "claude-primary",
    );

    expect(run.tokenUsage.input).toBe(5200);
    expect(run.tokenUsage.output).toBe(510);
  });

  it("attributes the turn to the light-tier model, not the run's model", () => {
    const run = newRun();

    recordPruneUsage(
      run,
      {
        dropped: 22,
        summarized: true,
        summaryUsage: { input: 4200, output: 310 },
        summaryModel: "claude-haiku-light",
      },
      7,
      "claude",
      "claude-primary",
    );

    expect(run.turnTokenUsage).toEqual([
      { turn: 7, input: 4200, output: 310, vendor: "claude", model: "claude-haiku-light" },
    ]);
  });

  it("leaves the cache fields alone — compaction is a fresh call, not a cached one", () => {
    const run = newRun();
    run.tokenUsage.cacheCreationInput = 900;
    run.tokenUsage.cacheReadInput = 64_000;

    recordPruneUsage(
      run,
      { dropped: 22, summarized: true, summaryUsage: { input: 4200, output: 310 } },
      7,
      "claude",
      "claude-primary",
    );

    expect(run.tokenUsage.cacheCreationInput).toBe(900);
    expect(run.tokenUsage.cacheReadInput).toBe(64_000);
    expect(run.turnTokenUsage![0].cacheCreationInput).toBeUndefined();
    expect(run.turnTokenUsage![0].cacheReadInput).toBeUndefined();
  });

  it("changes nothing, and does not throw, when the prune reported no usage", () => {
    const run = newRun();

    recordPruneUsage(run, { dropped: 22, summarized: false }, 7, "claude", "claude-primary");
    recordPruneUsage(run, { dropped: 0, summarized: false }, 1, "claude", "claude-primary");

    expect(run.tokenUsage).toEqual({ input: 1000, output: 200 });
    expect(run.turnTokenUsage).toEqual([]);
  });
});

describe("buildPruneSummaryPrompt", () => {
  it("asks for the facts a dropped turn is the only record of", () => {
    const prompt = buildPruneSummaryPrompt("assistant: ran the tests", "Fix the parser");

    expect(prompt).toContain("Fix the parser");
    expect(prompt).toContain("assistant: ran the tests");
    expect(prompt).toContain("file path");
    expect(prompt).toContain("command");
    expect(prompt).toContain("ruled out");
  });
});
