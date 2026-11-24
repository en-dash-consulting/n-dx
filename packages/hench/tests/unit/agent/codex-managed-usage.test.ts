import { describe, expect, it } from "vitest";
import { CodexManagedUsage } from "../../../src/agent/lifecycle/codex-managed-usage.js";

const start = (tracker: CodexManagedUsage, id = "session-a") => tracker.observe({ type: "thread.started", thread_id: id }, 1);
const count = (input: number, output: number, cache: number, write = 0) => ({ type: "turn.completed",
  usage: { input_tokens: input + cache + write, output_tokens: output, cached_input_tokens: cache, cache_write_input_tokens: write } });

// Synthetic envelopes; numeric incident boundaries are supplied in the task brief.
// These tests do not establish the contract of an arbitrary installed binary.
describe("managed Codex cumulative counters", () => {
  it("charges resumed review only once, preserving every token class", () => {
    const tracker = new CodexManagedUsage({ input: 172579, output: 25057, cacheReadInput: 5308160, cacheCreationInput: 0 }, "session-a");
    start(tracker);
    const event = tracker.observe(count(199226, 30209, 7448192), 1)!;
    expect(event.tokenUsage).toEqual({ input: 26647, output: 5152, cacheReadInput: 2140032, cacheCreationInput: 0 });
    expect(Object.values(event.tokenUsage!).reduce((a, b) => a + b, 0)).toBe(2171831);
    expect(tracker.observe(count(199226, 30209, 7448192), 2)).toBeNull();
  });
  it("accounts new-session spend and continuation deltas, including measured failure", () => {
    const tracker = new CodexManagedUsage();
    start(tracker);
    expect(tracker.observe(count(10, 2, 4, 3), 1)?.tokenUsage).toEqual({ input: 10, output: 2, cacheReadInput: 4, cacheCreationInput: 3 });
    expect(tracker.observe({ ...count(15, 5, 8, 4), type: "turn.failed" }, 2)?.tokenUsage)
      .toEqual({ input: 5, output: 3, cacheReadInput: 4, cacheCreationInput: 1 });
    const fresh = new CodexManagedUsage(); start(fresh, "session-b");
    expect(fresh.observe(count(15, 5, 8, 4), 1)?.tokenUsage?.input).toBe(15);
  });
  it("preserves bounded output on partial snapshots and recovers input without replay", () => {
    const tracker = new CodexManagedUsage(); start(tracker);
    tracker.observe(count(10, 2, 4), 1);
    const partial = tracker.observe({ type: "turn.failed", usage: { input_tokens: 30, output_tokens: 5 } }, 2)!;
    expect(partial.tokenUsage).toEqual({ input: 0, output: 3, cacheReadInput: 0, cacheCreationInput: 0 });
    expect(partial.tokenDiagnosticStatus).toBe("partial");
    expect(partial.tokenCacheProvenance).toBe("unavailable");
    expect(tracker.observe(count(20, 7, 10), 3)?.tokenUsage)
      .toEqual({ input: 10, output: 2, cacheReadInput: 6, cacheCreationInput: 0 });
    expect(tracker.observe(count(20, 7, 10), 4)).toBeNull();
  });
  it("ignores replayed partial counters without poisoning later measured spend", () => {
    const tracker = new CodexManagedUsage(); start(tracker);
    const partial = (output: number) => ({ type: "turn.completed", usage: { output_tokens: output } });
    expect(tracker.observe(partial(2), 1)?.tokenUsage?.output).toBe(2);
    expect(tracker.observe(partial(5), 2)?.tokenUsage?.output).toBe(3);
    expect(tracker.observe(partial(2), 3)).toBeNull();
    expect(tracker.observe(count(20, 7, 10), 4)?.tokenUsage)
      .toEqual({ input: 20, output: 2, cacheReadInput: 10, cacheCreationInput: 0 });
  });
  it("still rejects an unseen partial counter regression", () => {
    const tracker = new CodexManagedUsage(); start(tracker);
    tracker.observe({ type: "turn.completed", usage: { output_tokens: 5 } }, 1);
    expect(tracker.observe({ type: "turn.completed", usage: { output_tokens: 1 } }, 2)?.tokenDiagnosticStatus)
      .toBe("unavailable");
    expect(tracker.observe(count(20, 7, 10), 3)?.tokenUsage?.output).toBe(0);
  });
  it("retains measured cache provenance when complete counters follow partial output", () => {
    const tracker = new CodexManagedUsage(); start(tracker);
    tracker.observe(count(10, 2, 4), 1);
    tracker.observe({ type: "turn.failed", usage: { output_tokens: 5 } }, 2);
    const recovered = tracker.observe(count(20, 7, 10), 3)!;
    expect(recovered.tokenUsage?.cacheReadInput).toBe(6);
    expect(recovered.tokenCacheProvenance).toBe("measured");
    expect(recovered.tokenDiagnosticStatus).toBe("partial");
  });
  it("refuses reset epochs even after counters exceed the old boundary", () => {
    const tracker = new CodexManagedUsage(); start(tracker);
    tracker.observe(count(10, 2, 4), 1);
    expect(tracker.observe(count(1, 1, 1), 2)?.tokenDiagnosticStatus).toBe("unavailable");
    expect(tracker.observe(count(20, 5, 8), 3)?.tokenUsage?.input).toBe(0);
    expect(tracker.notes.join()).toMatch(/regressed/);
  });
  it("does not lose a late identity mismatch after a measured completion", async () => {
    const tracker = new CodexManagedUsage(); start(tracker);
    tracker.observe(count(10, 2, 4), 1);
    start(tracker, "different-session");
    expect((await tracker.finish({}, 2))?.tokenDiagnosticStatus).toBe("unavailable");
  });
  it("refuses missing, partial and mismatched identity without charging history", () => {
    const tracker = new CodexManagedUsage(undefined, "session-a");
    start(tracker, "wrong");
    expect(tracker.observe(count(10, 2, 4), 1)?.tokenDiagnosticStatus).toBe("unavailable");
    const partial = new CodexManagedUsage(); start(partial);
    expect(partial.observe({ type: "turn.completed", usage: { input_tokens: 10 } }, 1)?.tokenDiagnosticStatus).toBe("unavailable");
    expect(partial.observe({ type: "turn.failed" }, 2)?.tokenDiagnosticStatus).toBe("unavailable");
  });
});
