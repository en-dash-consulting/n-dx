/**
 * Unit tests for the summarizing history prune.
 *
 * The prune this replaced dropped the oldest turns outright, so the agent lost
 * the record of what it had already tried and paid to rediscover it. These
 * tests pin the three properties that fix costs: the dropped span comes back as
 * a summary, the summarizer runs on the light tier, and the retained window
 * never opens on an orphaned tool result (which the Messages API rejects).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  pruneWithSummary,
  PRUNE_SUMMARY_PREFIX,
} from "../../../../src/agent/lifecycle/context-prune.js";
import { defaultRegistry, TIER_MODELS } from "../../../../src/prd/llm-gateway.js";

interface TestMessage {
  role: string;
  content: string;
}

/** A history of `pairs` (assistant, user) turns behind a brief. */
function buildHistory(pairs: number): TestMessage[] {
  const messages: TestMessage[] = [{ role: "user", content: "brief" }];
  for (let i = 0; i < pairs; i++) {
    messages.push({ role: "assistant", content: `assistant ${i}` });
    messages.push({ role: "user", content: `result ${i}` });
  }
  return messages;
}

const options = {
  render: (m: TestMessage) => `${m.role}: ${m.content}`,
  makeSummaryMessage: (summary: string): TestMessage => ({ role: "user", content: summary }),
};

describe("pruneWithSummary", () => {
  let tmpDir: string;
  let henchDir: string;
  let capturedModels: Array<string | undefined>;
  let capturedPrompts: string[];

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-prune-"));
    henchDir = join(tmpDir, ".hench");
    capturedModels = [];
    capturedPrompts = [];
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue({
      complete: async ({ prompt, model }: { prompt: string; model?: string }) => {
        capturedModels.push(model);
        capturedPrompts.push(prompt);
        return { text: "- read x.ts: exports foo\n- ran tests: 3 failed" };
      },
    } as never);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("leaves a history under the cap untouched", async () => {
    const messages = buildHistory(3); // 7 messages
    const result = await pruneWithSummary(messages, { maxKeep: 21, henchDir, ...options });

    expect(result).toEqual({ pruned: 0, summarized: false });
    expect(messages).toHaveLength(7);
    expect(capturedModels).toEqual([]);
  });

  it("replaces the dropped span with a summary and keeps the brief", async () => {
    const messages = buildHistory(20); // 41 messages
    const result = await pruneWithSummary(messages, { maxKeep: 11, henchDir, ...options });

    expect(result.summarized).toBe(true);
    expect(result.pruned).toBeGreaterThan(0);
    expect(messages[0]).toEqual({ role: "user", content: "brief" });
    expect(messages[1].content).toContain(PRUNE_SUMMARY_PREFIX);
    // One summary message stands in for the whole dropped span.
    expect(messages).toHaveLength(41 - result.pruned + 1);
  });

  it("carries known information from the pruned turns into the summary", async () => {
    const messages = buildHistory(20);
    messages[3] = { role: "assistant", content: "ruled out the regex approach — catastrophic backtracking" };

    await pruneWithSummary(messages, { maxKeep: 11, henchDir, ...options });

    // What the agent had established reaches the summarizer...
    expect(capturedPrompts[0]).toContain("ruled out the regex approach");
    // ...and its digest is what remains in the history.
    expect(messages[1].content).toContain("read x.ts: exports foo");
  });

  it("routes the summarizer to the light tier", async () => {
    await pruneWithSummary(buildHistory(20), { maxKeep: 11, henchDir, ...options });

    expect(capturedModels).toEqual([TIER_MODELS.claude.light]);
  });

  it("honors a configured lightModel override", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", claude: { lightModel: "claude-custom-light" } } }),
      "utf-8",
    );

    await pruneWithSummary(buildHistory(20), { maxKeep: 11, henchDir, ...options });

    expect(capturedModels).toEqual(["claude-custom-light"]);
  });

  it("opens the retained window on an assistant turn, never an orphaned result", async () => {
    // A cut landing mid-pair would leave a `user` tool_result whose `tool_use`
    // was just removed — a 400 from the Messages API.
    for (const maxKeep of [10, 11, 12, 13]) {
      const messages = buildHistory(20);
      await pruneWithSummary(messages, { maxKeep, henchDir, ...options });
      expect(messages[2].role).toBe("assistant");
    }
  });

  it("honors keepPrefix so an inline system message survives", async () => {
    const messages: TestMessage[] = [{ role: "system", content: "you are an agent" }, ...buildHistory(20)];

    await pruneWithSummary(messages, { maxKeep: 12, keepPrefix: 2, henchDir, ...options });

    expect(messages[0]).toEqual({ role: "system", content: "you are an agent" });
    expect(messages[1]).toEqual({ role: "user", content: "brief" });
    expect(messages[2].content).toContain(PRUNE_SUMMARY_PREFIX);
  });

  it("snaps to the caller's assistant role name", async () => {
    // Gemini calls the assistant turn "model".
    const messages: TestMessage[] = [{ role: "user", content: "brief" }];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: "model", content: `model ${i}` });
      messages.push({ role: "user", content: `result ${i}` });
    }

    await pruneWithSummary(messages, { maxKeep: 11, henchDir, assistantRole: "model", ...options });

    expect(messages[2].role).toBe("model");
  });

  it("degrades to a plain drop when the summarizer fails", async () => {
    vi.spyOn(defaultRegistry, "getActiveProvider").mockImplementation(() => {
      throw new Error("no credentials");
    });

    const messages = buildHistory(20);
    const result = await pruneWithSummary(messages, { maxKeep: 11, henchDir, ...options });

    expect(result).toEqual({ pruned: result.pruned, summarized: false });
    expect(result.pruned).toBeGreaterThan(0);
    expect(messages[0]).toEqual({ role: "user", content: "brief" });
    expect(messages[1].content).not.toContain(PRUNE_SUMMARY_PREFIX);
  });

  it("degrades to a plain drop when the summarizer returns nothing usable", async () => {
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue({
      complete: async () => ({ text: "   " }),
    } as never);

    const messages = buildHistory(20);
    const result = await pruneWithSummary(messages, { maxKeep: 11, henchDir, ...options });

    expect(result.summarized).toBe(false);
    expect(result.pruned).toBeGreaterThan(0);
  });
});
