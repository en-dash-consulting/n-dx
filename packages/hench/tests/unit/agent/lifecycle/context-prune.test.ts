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
import type { PruneShape } from "../../../../src/agent/lifecycle/context-prune.js";
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
    summarize: async (transcript: string): Promise<string> => {
      seen.push(transcript);
      return transcript
        .split("\n")
        .filter((line) => line.includes(needle))
        .join(" | ");
    },
  };
}

const stubSummarizer = async (): Promise<string> => "earlier turns did some work";

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
      return "compacted";
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
    const pruner = new ConversationPruner(anthropicPruneShape(), async () => "```\n\n```");
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

    expect(await summarize("assistant: touched src/widget.ts")).toBe("compacted");

    const expected = resolveTaskModel(SUMMARY_TASK_CLASS, { vendor: "claude" }, {
      vendor: "claude",
    });
    expect(expected.tier).toBe("light");
    expect(calls[0].model).toBe(expected.model);
    expect(calls[0].prompt).toContain("touched src/widget.ts");
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
