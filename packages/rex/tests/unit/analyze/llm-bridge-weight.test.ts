/**
 * Unit tests for spawnClaude's weight-aware model resolution at the
 * llm-bridge choke point. Uses an injected fake client (setClaudeClient) so
 * no real LLM process or API call is made.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TIER_MODELS, NEWEST_MODELS } from "@n-dx/llm-client";
import { spawnClaude, setLLMConfig, setClaudeClient } from "../../../src/analyze/llm-bridge.js";

function captureClient(): { models: string[] } {
  const captured = { models: [] as string[] };
  setClaudeClient({
    mode: "cli",
    complete: async ({ model }: { prompt: string; model: string }) => {
      captured.models.push(model);
      return { text: "ok" };
    },
  } as never);
  return captured;
}

describe("spawnClaude weight-aware model resolution", () => {
  beforeEach(() => {
    // Reset module state (also clears any previously injected client).
    setLLMConfig({ vendor: "claude" });
  });

  it("resolves the light-tier model for weight 'light' with no explicit model", async () => {
    const captured = captureClient();

    await spawnClaude("prompt", undefined, undefined, "light");

    expect(captured.models).toEqual([TIER_MODELS.claude.light]);
  });

  it("defaults to the standard-tier model when weight is omitted", async () => {
    const captured = captureClient();

    await spawnClaude("prompt");

    expect(captured.models).toEqual([NEWEST_MODELS.claude]);
  });

  it("lets an explicit model win over the light weight", async () => {
    const captured = captureClient();

    await spawnClaude("prompt", "claude-opus-4-7", undefined, "light");

    expect(captured.models).toEqual(["claude-opus-4-7"]);
  });

  it("honors a configured lightModel for the light weight", async () => {
    setLLMConfig({ vendor: "claude", claude: { lightModel: "claude-custom-light" } });
    const captured = captureClient();

    await spawnClaude("prompt", undefined, undefined, "light");

    expect(captured.models).toEqual(["claude-custom-light"]);
  });
});
