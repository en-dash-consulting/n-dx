import { describe, expect, it } from "vitest";
import { EMPTY_CURSOR, readUsageDelta, readUsageSinceMark, snapshotTranscriptUsage, takeUsageMark, withClaimExcluded } from "../../../src/store/session-usage.js";
import { parseCodexUsage } from "../../../src/store/codex-session-usage.js";

// Synthetic protocol records only; never copy a user's rollout into fixtures.
const count = (input: number, cached: number, output: number) => JSON.stringify({
  type: "event_msg", payload: { type: "token_count", info: {
    total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: output, total_tokens: input + output },
    last_token_usage: { input_tokens: 999999, output_tokens: 999999 },
  } },
});
const text = (...lines: string[]) => lines.join("\n");

describe("Codex cumulative rollout usage", () => {
  it("validates counters and separates optional cache writes", () => {
    const row = JSON.parse(count(100, 40, 10));
    row.payload.info.total_token_usage.cache_write_input_tokens = 20;
    expect(snapshotTranscriptUsage(JSON.stringify(row)).totals).toEqual({ input: 40, cacheReadInput: 40, cacheCreationInput: 20, output: 10 });
    for (const bad of [-1, "10", null]) {
      row.payload.info.total_token_usage.input_tokens = bad;
      expect(parseCodexUsage(JSON.stringify(row)).status).toBe("unavailable");
    }
    expect(parseCodexUsage(text(count(100, 40, 10), count(50, 20, 5))).status).toBe("unavailable");
  });
  it("uses cumulative totals once, separates cached input, and ignores reasoning and last-turn duplicates", () => {
    const a = count(100, 40, 10), b = count(160, 60, 30);
    expect(snapshotTranscriptUsage(text(a, a, b, a, b)).totals).toEqual({ input: 100, cacheReadInput: 60, output: 30, cacheCreationInput: 0 });
    expect(readUsageSinceMark(text(a, a, b), takeUsageMark(a, "task")).tokenUsage).toEqual({ input: 40, cacheReadInput: 20, output: 20, cacheCreationInput: 0 });
  });

  it("excludes nested claims and repeated records", () => {
    const a = count(100, 40, 10), b = count(160, 60, 30), c = count(200, 80, 40);
    const outer = takeUsageMark(a, "outer"), inner = takeUsageMark(text(a, b), "inner");
    const transcript = text(a, b, c);
    const claim = readUsageSinceMark(transcript, inner);
    const marks = withClaimExcluded(transcript, { outer }, { from: claim.from, to: claim.to });
    expect(readUsageSinceMark(transcript, marks.outer).tokenUsage.input).toBe(40);
    expect(readUsageDelta(transcript, claim.cursor).tokenUsage.input).toBe(0);
  });

  it("resumes from cumulative snapshots after the prefix disappears", () => {
    const a = count(100, 40, 10), b = count(160, 60, 30);
    const first = readUsageDelta(a, EMPTY_CURSOR);
    expect(readUsageDelta(b, first.cursor).tokenUsage.input).toBe(40);
    expect(readUsageSinceMark(b, takeUsageMark(a, "task")).tokenUsage.input).toBe(40);
  });
});
