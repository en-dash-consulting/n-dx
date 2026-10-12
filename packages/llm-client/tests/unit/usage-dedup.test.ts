import { describe, it, expect } from "vitest";
import { usageMessageId, UsageMessageFilter } from "../../src/usage-dedup.js";

/**
 * One assistant message, counted once.
 *
 * Claude's stream-json emits one `assistant` line per *content block*, and
 * every line repeats the finished message in full — `usage` included. A turn
 * that writes a sentence and calls three tools arrives as four lines carrying
 * one turn's tokens four times. Measured on a real session transcript: 234
 * usage-bearing lines carrying 57 distinct messages, a 4.27x over-count.
 */
describe("usageMessageId", () => {
  it("reads the id off a stream-json assistant line", () => {
    const line = {
      type: "assistant",
      message: { id: "msg_01ABC", usage: { input_tokens: 2, output_tokens: 7 } },
    };
    expect(usageMessageId(line)).toBe("msg_01ABC");
  });

  it("reads a top-level id when the payload is itself usage-bearing", () => {
    expect(usageMessageId({ id: "msg_02", usage: { input_tokens: 1 } })).toBe("msg_02");
  });

  it("ignores a top-level id on a payload with no usage", () => {
    // Plenty of stream lines carry an unrelated `id`. Treating those as
    // message identities would suppress distinct turns that follow them.
    expect(usageMessageId({ id: "tool_use_01", type: "tool_use" })).toBeUndefined();
  });

  it("returns undefined for payloads with no identity", () => {
    expect(usageMessageId({ usage: { input_tokens: 1 } })).toBeUndefined();
    expect(usageMessageId({ message: { usage: {} } })).toBeUndefined();
    expect(usageMessageId(null)).toBeUndefined();
    expect(usageMessageId("not an object")).toBeUndefined();
    expect(usageMessageId({ message: { id: "", usage: {} } })).toBeUndefined();
  });
});

describe("UsageMessageFilter", () => {
  const block = (id: string) => ({
    type: "assistant",
    message: { id, usage: { input_tokens: 2, output_tokens: 7 } },
  });

  it("accepts a message once and refuses its repeats", () => {
    const seen = new UsageMessageFilter();
    expect(seen.accept(block("msg_01"))).toBe(true);
    expect(seen.accept(block("msg_01"))).toBe(false);
    expect(seen.accept(block("msg_01"))).toBe(false);
    expect(seen.size).toBe(1);
  });

  it("accepts each distinct message", () => {
    const seen = new UsageMessageFilter();
    expect(seen.accept(block("msg_01"))).toBe(true);
    expect(seen.accept(block("msg_02"))).toBe(true);
    expect(seen.size).toBe(2);
  });

  it("collapses a multi-block turn to one count", () => {
    // The shape that caused the over-count: text block, then three tool_use
    // blocks, all four lines carrying the same finished message.
    const seen = new UsageMessageFilter();
    const accepted = [block("msg_01"), block("msg_01"), block("msg_01"), block("msg_01")]
      .filter((line) => seen.accept(line));
    expect(accepted).toHaveLength(1);
  });

  it("counts usage that carries no identity rather than dropping it", () => {
    // Vendors other than Claude stamp no message id. Refusing their usage
    // would trade a 4x over-count for a total loss, which is worse.
    const seen = new UsageMessageFilter();
    const anonymous = { usage: { input_tokens: 5, output_tokens: 5 } };
    expect(seen.accept(anonymous)).toBe(true);
    expect(seen.accept(anonymous)).toBe(true);
    expect(seen.size).toBe(0);
  });

  it("reports what it has already counted without recording it", () => {
    const seen = new UsageMessageFilter();
    expect(seen.has("msg_01")).toBe(false);
    seen.accept(block("msg_01"));
    expect(seen.has("msg_01")).toBe(true);
    expect(seen.size).toBe(1);
  });
});
