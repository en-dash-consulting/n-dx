/**
 * Unit tests for tolerant Codex model-id matching.
 *
 * OpenAI usage responses report dated deployment ids (e.g.
 * "gpt-5-codex-2025-03-01"), whereas N-DX config carries the undated base id
 * ("gpt-5-codex"). `modelMatches` must treat them as the same model without
 * letting prefix-sharing models (gpt-4o vs gpt-4o-mini) collide.
 */

import { describe, it, expect, vi } from "vitest";
import {
  modelMatches,
  stripModelDateSuffix,
  fetchCodexTokenUsage,
} from "../../../src/quota/codex-token-retrieval.js";

describe("stripModelDateSuffix", () => {
  it("strips a -YYYY-MM-DD deployment suffix", () => {
    expect(stripModelDateSuffix("gpt-4o-2024-08-06")).toBe("gpt-4o");
    expect(stripModelDateSuffix("gpt-5-codex-2025-03-01")).toBe("gpt-5-codex");
  });

  it("strips a -YYYYMMDD deployment suffix", () => {
    expect(stripModelDateSuffix("claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet");
  });

  it("leaves an undated id unchanged", () => {
    expect(stripModelDateSuffix("gpt-5-codex")).toBe("gpt-5-codex");
    expect(stripModelDateSuffix("gpt-5.5")).toBe("gpt-5.5");
  });
});

describe("modelMatches", () => {
  it("matches a base config id against a dated API id", () => {
    expect(modelMatches("gpt-5-codex", "gpt-5-codex-2025-03-01")).toBe(true);
    expect(modelMatches("gpt-4o", "gpt-4o-2024-08-06")).toBe(true);
  });

  it("matches when the config id itself is dated", () => {
    expect(modelMatches("gpt-4o-2024-08-06", "gpt-4o")).toBe(true);
  });

  it("matches identical ids", () => {
    expect(modelMatches("gpt-5.5", "gpt-5.5")).toBe(true);
  });

  it("does not let prefix-sharing models collide", () => {
    expect(modelMatches("gpt-4o", "gpt-4o-mini")).toBe(false);
    expect(modelMatches("gpt-5-codex", "gpt-5-codex-mini")).toBe(false);
  });
});

describe("fetchCodexTokenUsage — dated deployment id resolution", () => {
  it("resolves a dated API model id to the configured base id", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            model: "gpt-5-codex-2025-03-01",
            prompt_tokens: 100,
            completion_tokens: 40,
            created: 1_700_000_000,
          },
        ],
      }),
    });

    const result = await fetchCodexTokenUsage({
      apiKey: "test-key",
      model: "gpt-5-codex",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.input).toBe(100);
      expect(result.tokens.output).toBe(40);
    }
  });

  it("still reports not-found when no entry matches the configured model", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { model: "gpt-4o-mini", prompt_tokens: 10, completion_tokens: 5, created: 1 },
        ],
      }),
    });

    const result = await fetchCodexTokenUsage({
      apiKey: "test-key",
      model: "gpt-5-codex",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not-found");
    }
  });
});
