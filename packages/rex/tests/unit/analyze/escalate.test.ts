/**
 * The escalation ladder.
 *
 * The defect it replaces was not "too few retries" — it was three retries that
 * each resent a byte-identical prompt with no indication of what was wrong. A
 * model that emits unparseable JSON once will do it again on identical input,
 * so those were three calls billed for one answer.
 *
 * The properties that matter, in order: every retry differs from its
 * predecessor, the difference is the validation error itself, retries run on
 * the escalated tier, and transport failures never retry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const spawnClaude = vi.fn();

vi.mock("../../../src/analyze/llm-bridge.js", () => ({
  spawnClaude: (...args: unknown[]) => spawnClaude(...args),
}));

const {
  withEscalation,
  buildValidationFeedback,
  getEscalationStats,
  resetEscalationStats,
} = await import("../../../src/analyze/escalate.js");

beforeEach(() => {
  spawnClaude.mockReset();
  resetEscalationStats();
});

afterEach(() => {
  resetEscalationStats();
});

/** Accepts only the literal "good"; rejects anything else by design. */
const strictValidate = (text: string): string => {
  if (text.trim() !== "good") throw new Error(`expected "good", received "${text.trim()}"`);
  return text.trim();
};

describe("withEscalation — the happy path", () => {
  it("accepts the first attempt without escalating", async () => {
    spawnClaude.mockResolvedValue({ text: "good", tokenUsage: { input: 10, output: 5 } });

    const result = await withEscalation({
      prompt: "P",
      taskClass: "prd.rename",
      validate: strictValidate,
    });

    expect(result.value).toBe("good");
    expect(result.escalated).toBe(false);
    expect(result.attempts).toBe(1);
    expect(spawnClaude).toHaveBeenCalledTimes(1);
  });

  it("routes the first attempt by task class", async () => {
    spawnClaude.mockResolvedValue({ text: "good" });

    await withEscalation({ prompt: "P", taskClass: "prd.rename", validate: strictValidate });

    expect(spawnClaude.mock.calls[0][3]).toEqual({ taskClass: "prd.rename" });
  });
});

describe("withEscalation — feedback and escalation", () => {
  it("retries with the validation error appended, never the same prompt twice", async () => {
    spawnClaude
      .mockResolvedValueOnce({ text: "bad" })
      .mockResolvedValueOnce({ text: "good" });

    const result = await withEscalation({
      prompt: "ORIGINAL-PROMPT",
      taskClass: "prd.rename",
      validate: strictValidate,
    });

    expect(result.escalated).toBe(true);
    expect(result.attempts).toBe(2);

    const firstPrompt = spawnClaude.mock.calls[0][0] as string;
    const secondPrompt = spawnClaude.mock.calls[1][0] as string;
    expect(secondPrompt).not.toBe(firstPrompt);
    expect(secondPrompt).toContain("ORIGINAL-PROMPT");
    // The error itself is what the model is told.
    expect(secondPrompt).toContain('expected "good", received "bad"');
  });

  it("escalates retries to the standard tier", async () => {
    spawnClaude
      .mockResolvedValueOnce({ text: "bad" })
      .mockResolvedValueOnce({ text: "good" });

    await withEscalation({ prompt: "P", taskClass: "prd.rename", validate: strictValidate });

    expect(spawnClaude.mock.calls[0][3]).toEqual({ taskClass: "prd.rename" });
    expect(spawnClaude.mock.calls[1][3]).toBe("standard");
  });

  it("keeps the full retry budget — three attempts by default", async () => {
    spawnClaude
      .mockResolvedValueOnce({ text: "bad" })
      .mockResolvedValueOnce({ text: "worse" })
      .mockResolvedValueOnce({ text: "good" });

    const result = await withEscalation({
      prompt: "P",
      taskClass: "prd.rename",
      validate: strictValidate,
    });

    expect(result.attempts).toBe(3);
    expect(spawnClaude).toHaveBeenCalledTimes(3);
  });

  it("differs between consecutive retries even when the error repeats", async () => {
    // The old loop's exact defect: identical input producing identical output.
    spawnClaude.mockResolvedValue({ text: "bad" });

    await expect(
      withEscalation({ prompt: "P", taskClass: "prd.rename", validate: strictValidate }),
    ).rejects.toThrow();

    const prompts = spawnClaude.mock.calls.map((c) => c[0] as string);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it("surfaces the last validation error when every attempt is rejected", async () => {
    spawnClaude.mockResolvedValue({ text: "still-bad" });

    await expect(
      withEscalation({ prompt: "P", taskClass: "prd.rename", validate: strictValidate }),
    ).rejects.toThrow(/still-bad/);
  });

  it("honors a custom attempt budget", async () => {
    spawnClaude.mockResolvedValue({ text: "bad" });

    await expect(
      withEscalation({
        prompt: "P",
        taskClass: "prd.rename",
        validate: strictValidate,
        maxAttempts: 2,
      }),
    ).rejects.toThrow();

    expect(spawnClaude).toHaveBeenCalledTimes(2);
  });

  it("accumulates token usage across every attempt", async () => {
    spawnClaude
      .mockResolvedValueOnce({ text: "bad", tokenUsage: { input: 10, output: 2 } })
      .mockResolvedValueOnce({ text: "good", tokenUsage: { input: 20, output: 4 } });

    const result = await withEscalation({
      prompt: "P",
      taskClass: "prd.rename",
      validate: strictValidate,
    });

    // A rejected attempt was still billed; hiding it would understate cost.
    expect(result.tokenUsage.inputTokens).toBe(30);
    expect(result.tokenUsage.outputTokens).toBe(6);
    expect(result.tokenUsage.calls).toBe(2);
  });

  it("reports each escalation to the caller", async () => {
    spawnClaude.mockResolvedValueOnce({ text: "bad" }).mockResolvedValueOnce({ text: "good" });
    const onEscalate = vi.fn();

    await withEscalation({
      prompt: "P",
      taskClass: "prd.rename",
      validate: strictValidate,
      onEscalate,
    });

    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate.mock.calls[0][0]).toMatchObject({ taskClass: "prd.rename", attempt: 2 });
  });
});

describe("withEscalation — what must not retry", () => {
  it("propagates a transport failure immediately", async () => {
    // Escalating a network or auth failure neither diagnoses nor fixes it.
    spawnClaude.mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      withEscalation({ prompt: "P", taskClass: "prd.rename", validate: strictValidate }),
    ).rejects.toThrow(/ECONNRESET/);
    expect(spawnClaude).toHaveBeenCalledTimes(1);
  });

  it("propagates a validate() error the caller declares non-retryable", async () => {
    spawnClaude.mockResolvedValue({ text: "bad" });

    await expect(
      withEscalation({
        prompt: "P",
        taskClass: "prd.rename",
        validate: strictValidate,
        isValidationError: () => false,
      }),
    ).rejects.toThrow();
    expect(spawnClaude).toHaveBeenCalledTimes(1);
  });
});

describe("escalation statistics", () => {
  it("tracks the rate per class, the signal for a class routed too cheaply", async () => {
    spawnClaude.mockResolvedValueOnce({ text: "good" });
    await withEscalation({ prompt: "P", taskClass: "prd.rename", validate: strictValidate });

    spawnClaude.mockReset();
    spawnClaude.mockResolvedValueOnce({ text: "bad" }).mockResolvedValueOnce({ text: "good" });
    await withEscalation({ prompt: "P", taskClass: "prd.rename", validate: strictValidate });

    const stats = getEscalationStats().find((s) => s.taskClass === "prd.rename");
    expect(stats).toMatchObject({ calls: 2, escalated: 1 });
    expect(stats?.rate).toBe(0.5);
  });

  it("keeps classes separate", async () => {
    spawnClaude.mockResolvedValue({ text: "good" });
    await withEscalation({ prompt: "P", taskClass: "prd.rename", validate: strictValidate });
    await withEscalation({ prompt: "P", taskClass: "prd.merge", validate: strictValidate });

    expect(getEscalationStats()).toHaveLength(2);
  });
});

describe("buildValidationFeedback", () => {
  it("keeps the original prompt and adds the error", () => {
    const out = buildValidationFeedback("ORIGINAL", "it was wrong", 2);
    expect(out).toContain("ORIGINAL");
    expect(out).toContain("it was wrong");
    expect(out).toContain("ATTEMPT 2");
  });

  it("asks for a corrected response, not an explanation", () => {
    const out = buildValidationFeedback("ORIGINAL", "err", 2).toLowerCase();
    expect(out).toMatch(/do not\s+explain/);
  });
});
